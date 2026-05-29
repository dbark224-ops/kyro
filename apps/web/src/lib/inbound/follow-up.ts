import type { SupabaseClient, User } from "@supabase/supabase-js";
import { runStubAiTriage } from "../ai/triage";
import { completeOpenCustomerFollowUpReminders } from "../crm/follow-up-reminders";
import { insertAuditLog } from "../engine/event-action-audit";

export type ManualFollowUpInput = {
  submissionKey?: string;
  conversationId: string;
  message: string;
};

function nullableText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function preview(value: string | null, maxLength = 120) {
  if (!value) {
    return "No message body.";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function buildThreadSummary(
  messages: Array<{
    direction: unknown;
    subject: unknown;
    body_text: unknown;
  }>,
) {
  return messages
    .slice(-8)
    .map((message, index) => {
      const direction = String(message.direction);
      const body = preview(
        message.body_text
          ? String(message.body_text)
          : message.subject
            ? String(message.subject)
            : null,
      );

      return `${index + 1}. ${direction}: ${body}`;
    })
    .join("\n");
}

export async function ingestManualConversationFollowUp(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  input: ManualFollowUpInput,
) {
  const messageText = nullableText(input.message);

  if (!messageText) {
    throw new Error("Follow-up message is required.");
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,status,channel_id,contact_id,lead_id")
    .eq("workspace_id", workspaceId)
    .eq("id", input.conversationId)
    .maybeSingle();

  if (conversationError) {
    throw new Error(
      `Unable to load conversation: ${conversationError.message}`,
    );
  }

  if (!conversation) {
    throw new Error("Conversation was not found.");
  }

  const [leadProfile, contactProfile] = await Promise.all([
    conversation.lead_id
      ? supabase
          .from("leads")
          .select("title,service_type")
          .eq("workspace_id", workspaceId)
          .eq("id", conversation.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    conversation.contact_id
      ? supabase
          .from("contacts")
          .select("address")
          .eq("workspace_id", workspaceId)
          .eq("id", conversation.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (leadProfile.error) {
    throw new Error(
      `Unable to load lead context: ${leadProfile.error.message}`,
    );
  }

  if (contactProfile.error) {
    throw new Error(
      `Unable to load contact context: ${contactProfile.error.message}`,
    );
  }

  const idempotencyKey = `manual.follow_up.${input.conversationId}.${
    input.submissionKey ?? crypto.randomUUID()
  }`;
  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      type: "inbound.manual_follow_up.received",
      source: "web.inbox",
      idempotency_key: idempotencyKey,
      payload: {
        stage: "received",
        conversationId: input.conversationId,
        previousConversationStatus: conversation.status,
      },
      status: "processing",
    })
    .select("id,type,status")
    .single();

  if (eventError || !event) {
    if (eventError?.code === "23505") {
      const { data: existingEvent } = await supabase
        .from("events")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      return {
        duplicate: true,
        eventId: existingEvent ? String(existingEvent.id) : null,
      };
    }

    throw new Error(
      `Unable to record follow-up event: ${eventError?.message ?? "unknown error"}`,
    );
  }

  const now = new Date().toISOString();
  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      workspace_id: workspaceId,
      conversation_id: conversation.id,
      channel_id: conversation.channel_id ?? null,
      contact_id: conversation.contact_id ?? null,
      direction: "inbound",
      subject: "Follow-up message",
      body_text: messageText,
      received_at: now,
      metadata: {
        source: "manual_follow_up",
        eventId: event.id,
      },
    })
    .select("id")
    .single();

  if (messageError || !message) {
    throw new Error(
      `Unable to create follow-up message: ${messageError?.message ?? "unknown error"}`,
    );
  }

  const previousStatus = String(conversation.status);
  const { error: conversationUpdateError } = await supabase
    .from("conversations")
    .update({
      status: "open",
      last_message_at: now,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", input.conversationId);

  if (conversationUpdateError) {
    throw new Error(
      `Unable to update conversation: ${conversationUpdateError.message}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action:
      previousStatus === "resolved"
        ? "conversation.reopened_by_inbound"
        : "conversation.follow_up_received",
    entityType: "conversation",
    entityId: input.conversationId,
    before: {
      status: previousStatus,
    },
    after: {
      status: "open",
      messageId: String(message.id),
    },
  });

  const { data: cancelledActions, error: cancelError } = await supabase
    .from("actions")
    .update({
      status: "cancelled",
      result: {
        cancelledReason: "new_inbound_message",
        cancelledByMessageId: String(message.id),
        cancelledAt: now,
      },
    })
    .eq("workspace_id", workspaceId)
    .eq("target_type", "conversation")
    .eq("target_id", input.conversationId)
    .in("type", [
      "draft_reply",
      "ask_missing_info",
      "book_site_visit",
      "create_quote_draft",
      "schedule_follow_up",
    ])
    .in("status", ["pending_approval", "approved"])
    .select("id,status");

  if (cancelError) {
    throw new Error(
      `Unable to cancel stale proposed actions: ${cancelError.message}`,
    );
  }

  for (const action of cancelledActions ?? []) {
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      action: "action.cancelled_due_to_new_inbound",
      entityType: "action",
      entityId: String(action.id),
      after: {
        status: "cancelled",
        messageId: String(message.id),
      },
      metadata: {
        requestedByUserId: user.id,
        conversationId: input.conversationId,
      },
    });
  }

  const completedFollowUpReminderCount =
    await completeOpenCustomerFollowUpReminders(supabase, {
      workspaceId,
      actorType: "system",
      actorId: user.id,
      conversationId: input.conversationId,
      messageId: String(message.id),
      reason: "new_manual_inbound_message",
    });

  if (conversation.lead_id) {
    const { error: leadUpdateError } = await supabase
      .from("leads")
      .update({
        next_step: "Review latest AI proposed reply",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", conversation.lead_id);

    if (leadUpdateError) {
      throw new Error(
        `Unable to update lead next step: ${leadUpdateError.message}`,
      );
    }
  }

  const { error: eventUpdateError } = await supabase
    .from("events")
    .update({
      payload: {
        conversationId: input.conversationId,
        contactId: conversation.contact_id ?? null,
        leadId: conversation.lead_id ?? null,
        messageId: message.id,
        previousConversationStatus: previousStatus,
        cancelledDraftReplyCount: cancelledActions?.length ?? 0,
        cancelledActionCount: cancelledActions?.length ?? 0,
        completedFollowUpReminderCount,
      },
      status: "processed",
      processed_at: now,
    })
    .eq("id", event.id);

  if (eventUpdateError) {
    throw new Error(
      `Unable to update follow-up event: ${eventUpdateError.message}`,
    );
  }

  const { data: threadMessages, error: threadError } = await supabase
    .from("messages")
    .select("direction,subject,body_text")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: true });

  if (threadError) {
    throw new Error(
      `Unable to load conversation thread for AI triage: ${threadError.message}`,
    );
  }

  const threadSummary = buildThreadSummary(threadMessages ?? []);
  const aiResult = await runStubAiTriage(supabase, user, workspaceId, {
    source: "manual_follow_up",
    sourceEventId: String(event.id),
    contactId: conversation.contact_id
      ? String(conversation.contact_id)
      : undefined,
    leadId: conversation.lead_id ? String(conversation.lead_id) : undefined,
    conversationId: input.conversationId,
    messageId: String(message.id),
    leadTitle: leadProfile.data?.title
      ? String(leadProfile.data.title)
      : undefined,
    serviceType: leadProfile.data?.service_type
      ? String(leadProfile.data.service_type)
      : null,
    contactAddress: contactProfile.data?.address
      ? String(contactProfile.data.address)
      : null,
    summary: `Follow-up inbound message received. Full thread now has ${
      threadMessages?.length ?? 1
    } messages.`,
    threadMessageCount: threadMessages?.length ?? 1,
    threadSummary,
  });

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "inbound.manual_follow_up.ingested",
    entityType: "event",
    entityId: String(event.id),
    after: {
      type: event.type,
      status: "processed",
      conversationId: input.conversationId,
      messageId: message.id,
      aiRunId: aiResult.aiRunId,
      actionId: aiResult.actionId,
    },
  });

  return {
    duplicate: false,
    eventId: String(event.id),
    conversationId: input.conversationId,
    messageId: String(message.id),
    aiRunId: aiResult.aiRunId,
    actionId: aiResult.actionId,
  };
}
