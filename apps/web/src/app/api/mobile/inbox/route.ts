import {
  getConversationList,
  getConversationWorkflowCounts,
  getSkippedEmailSummaries,
} from "../../../../lib/crm/queries";
import { promoteSkippedEmailEvent } from "../../../../lib/integrations/inbound-email-sync";
import {
  MobileApiError,
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function enrichInboxSearchContext(
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"],
  workspaceId: string,
  items: Awaited<ReturnType<typeof getConversationList>>,
) {
  const conversationIds = uniqueIds(items.map((item) => item.id));

  if (!conversationIds.length) {
    return items;
  }

  const [conversations, messages, quoteDrafts, actions, facts] = await Promise.all([
    supabase
      .from("conversations")
      .select("id,contact_id,lead_id,status")
      .eq("workspace_id", workspaceId)
      .in("id", conversationIds),
    supabase
      .from("messages")
      .select("conversation_id,subject,body_text,direction,channel_type,created_at")
      .eq("workspace_id", workspaceId)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(900),
    supabase
      .from("quote_drafts")
      .select("conversation_id,title,status,notes,line_items")
      .eq("workspace_id", workspaceId)
      .in("conversation_id", conversationIds)
      .limit(500),
    supabase
      .from("actions")
      .select("target_id,type,status,input")
      .eq("workspace_id", workspaceId)
      .eq("target_type", "conversation")
      .in("target_id", conversationIds)
      .limit(500),
    supabase
      .from("inquiry_facts")
      .select("conversation_id,job_type,address,preferred_time,budget,urgency,fit,missing_info")
      .eq("workspace_id", workspaceId)
      .in("conversation_id", conversationIds),
  ]);

  if (conversations.error) {
    throw new Error(`Unable to load inbox search context: ${conversations.error.message}`);
  }

  if (messages.error) {
    throw new Error(`Unable to load inbox message search context: ${messages.error.message}`);
  }

  if (quoteDrafts.error) {
    throw new Error(`Unable to load inbox quote search context: ${quoteDrafts.error.message}`);
  }

  if (actions.error) {
    throw new Error(`Unable to load inbox action search context: ${actions.error.message}`);
  }

  if (facts.error) {
    throw new Error(`Unable to load inbox facts search context: ${facts.error.message}`);
  }

  const contactIds = uniqueIds(
    (conversations.data ?? []).map((conversation) =>
      conversation.contact_id ? String(conversation.contact_id) : null,
    ),
  );
  const leadIds = uniqueIds(
    (conversations.data ?? []).map((conversation) =>
      conversation.lead_id ? String(conversation.lead_id) : null,
    ),
  );
  const [contacts, leads] = await Promise.all([
    contactIds.length
      ? supabase
          .from("contacts")
          .select("id,name,email,phone,company,address,notes")
          .eq("workspace_id", workspaceId)
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? supabase
          .from("leads")
          .select("id,title,description,service_type,next_step,status,priority")
          .eq("workspace_id", workspaceId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contacts.error) {
    throw new Error(`Unable to load inbox contact search context: ${contacts.error.message}`);
  }

  if (leads.error) {
    throw new Error(`Unable to load inbox lead search context: ${leads.error.message}`);
  }

  const conversationById = new Map(
    (conversations.data ?? []).map((conversation) => [
      String(conversation.id),
      conversation,
    ]),
  );
  const contactById = new Map(
    (contacts.data ?? []).map((contact) => [String(contact.id), contact]),
  );
  const leadById = new Map((leads.data ?? []).map((lead) => [String(lead.id), lead]));
  const searchTextByConversation = new Map<string, string[]>();
  const append = (conversationId: string | null | undefined, values: unknown[]) => {
    if (!conversationId) {
      return;
    }

    const current = searchTextByConversation.get(String(conversationId)) ?? [];
    current.push(
      ...values
        .map((value) => textValue(value))
        .filter((value): value is string => Boolean(value)),
    );
    searchTextByConversation.set(String(conversationId), current);
  };

  for (const message of messages.data ?? []) {
    append(message.conversation_id ? String(message.conversation_id) : null, [
      message.subject,
      message.body_text,
      message.direction,
      message.channel_type,
    ]);
  }

  for (const quoteDraft of quoteDrafts.data ?? []) {
    append(quoteDraft.conversation_id ? String(quoteDraft.conversation_id) : null, [
      quoteDraft.title,
      quoteDraft.status,
      quoteDraft.notes,
      JSON.stringify(quoteDraft.line_items ?? []),
    ]);
  }

  for (const action of actions.data ?? []) {
    append(action.target_id ? String(action.target_id) : null, [
      action.type,
      action.status,
      JSON.stringify(action.input ?? {}),
    ]);
  }

  for (const item of facts.data ?? []) {
    append(item.conversation_id ? String(item.conversation_id) : null, [
      item.job_type,
      item.address,
      item.preferred_time,
      item.budget,
      item.urgency,
      item.fit,
      Array.isArray(item.missing_info) ? item.missing_info.join(" ") : null,
    ]);
  }

  return items.map((item) => {
    const conversation = conversationById.get(item.id);
    const contact = conversation?.contact_id
      ? contactById.get(String(conversation.contact_id))
      : null;
    const lead = conversation?.lead_id ? leadById.get(String(conversation.lead_id)) : null;

    return {
      ...item,
      contactEmail: contact?.email ? String(contact.email) : null,
      contactPhone: contact?.phone ? String(contact.phone) : null,
      searchableText: [
        item.contactName,
        item.leadTitle,
        item.latestSubject,
        item.latestBody,
        item.nextActionLabel,
        item.status,
        item.workflowBucket,
        contact?.name,
        contact?.email,
        contact?.phone,
        contact?.company,
        contact?.address,
        contact?.notes,
        lead?.title,
        lead?.description,
        lead?.service_type,
        lead?.next_step,
        lead?.status,
        lead?.priority,
        ...(searchTextByConversation.get(item.id) ?? []),
      ]
        .filter(Boolean)
        .join(" \n ")
        .slice(0, 18000),
    };
  });
}

export async function GET(request: Request) {
  try {
    const { supabase, workspace } = await requireMobileWorkspaceContext(request);
    const [counts, baseItems, skippedEmails] = await Promise.all([
      getConversationWorkflowCounts(supabase, workspace.id),
      getConversationList(supabase, workspace.id, { limit: 160 }),
      getSkippedEmailSummaries(supabase, workspace.id, 12),
    ]);
    const items = await enrichInboxSearchContext(supabase, workspace.id, baseItems);

    return Response.json({
      counts,
      items,
      skippedEmails,
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = objectRecord(await request.json().catch(() => null));
    const operation = textValue(payload.operation);

    if (operation !== "promote_skipped_email") {
      throw new MobileApiError("Inbox operation is invalid.", 400);
    }

    const eventId = textValue(payload.eventId);

    if (!eventId) {
      throw new MobileApiError("Skipped email id is required.", 400);
    }

    const promoted = await promoteSkippedEmailEvent({
      eventId,
      supabase,
      user,
      workspaceId: workspace.id,
    });
    const [counts, baseItems, skippedEmails] = await Promise.all([
      getConversationWorkflowCounts(supabase, workspace.id),
      getConversationList(supabase, workspace.id, { limit: 160 }),
      getSkippedEmailSummaries(supabase, workspace.id, 12),
    ]);
    const items = await enrichInboxSearchContext(supabase, workspace.id, baseItems);

    return Response.json({
      counts,
      items,
      message: promoted.duplicate
        ? "Skipped email was already in the work queue."
        : "Skipped email promoted to the work queue.",
      promotedConversationId: promoted.conversationId,
      skippedEmails,
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
