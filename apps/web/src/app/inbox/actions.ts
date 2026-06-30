"use server";

import { parseAddressFormData } from "../../lib/addresses/form";
import { ingestManualConversationFollowUp } from "../../lib/inbound/follow-up";
import {
  getCommunicationSettings,
  isOutboundChannel,
  type SignatureVariant,
} from "../../lib/communication/settings";
import {
  buildSignedEmailBody,
  selectEmailSignature,
} from "../../lib/communication/signatures";
import {
  recordOutboundEventEmail,
  recordOutboundMessage,
  retryOutboundMessage,
  type OutboundAttachment,
} from "../../lib/communication/outbound";
import {
  INBOUND_EMAIL_POLICY_TYPE,
  normalizeInboundEmailSettings,
  senderRuleTargetFromEmail,
  upsertInboundEmailSenderRule,
  type InboundEmailSenderRuleAction,
} from "../../lib/integrations/inbound-email-settings";
import { promoteSkippedEmailEvent } from "../../lib/integrations/inbound-email-sync";
import { runStubAiTriage, type InquiryFacts } from "../../lib/ai/triage";
import {
  approveAction,
  executeAction,
  insertAuditLog,
} from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const CONVERSATION_STATUSES = new Set([
  "open",
  "reply_drafted",
  "replied",
  "resolved",
]);
const URGENCY_OPTIONS = new Set(["low", "normal", "urgent"]);
const FIT_OPTIONS = new Set(["likely_fit", "needs_review", "not_fit"]);
const MAX_LOCAL_ATTACHMENT_COUNT = 5;
const MAX_LOCAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formBoolean(formData: FormData, key: string) {
  return formData.get(key) !== null;
}

function formSignatureVariant(formData: FormData): SignatureVariant {
  return formString(formData, "signatureVariant") === "ai_generated"
    ? "ai_generated"
    : "manual";
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function titleCaseJobType(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[a-zA-Z][a-zA-Z'/-]*/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) {
      return word;
    }

    return word
      .split(/([/-])/)
      .map((part) =>
        part === "/" || part === "-"
          ? part
          : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
      )
      .join("");
  });
}

function parseMissingInfo(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type EditableInquiryFacts = {
  jobType: string | null;
  address: string | null;
  preferredTime: string | null;
  urgency: "low" | "normal" | "urgent";
  budget: string | null;
  fit: "likely_fit" | "needs_review" | "not_fit";
  missingInfo: string[];
};

function quoteLineItems(facts: EditableInquiryFacts) {
  return [
    {
      description: facts.jobType ?? "Trade Service",
      quantity: 1,
      unit: "job",
      unitPrice: null,
      total: null,
      notes: "Draft placeholder. Pricing to be confirmed by the user.",
    },
  ];
}

function quoteNotes(facts: EditableInquiryFacts) {
  return [
    facts.address ? `Job address: ${facts.address}` : null,
    facts.preferredTime ? `Preferred time: ${facts.preferredTime}` : null,
    facts.budget ? `Mentioned budget: ${facts.budget}` : null,
    "Pricing is intentionally blank until the user confirms it.",
  ].filter(Boolean);
}

function factsForJson(facts: EditableInquiryFacts) {
  return {
    address: facts.address,
    budget: facts.budget,
    fit: facts.fit,
    jobType: facts.jobType,
    missingInfo: facts.missingInfo,
    preferredTime: facts.preferredTime,
    urgency: facts.urgency,
  };
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

function toInquiryFacts(input: {
  job_type: unknown;
  address: unknown;
  preferred_time: unknown;
  urgency: unknown;
  budget: unknown;
  fit: unknown;
  missing_info: unknown;
}): InquiryFacts {
  const urgency = String(input.urgency);
  const fit = String(input.fit);

  return {
    address:
      typeof input.address === "string" && input.address.trim()
        ? input.address.trim()
        : null,
    budget:
      typeof input.budget === "string" && input.budget.trim()
        ? input.budget.trim()
        : null,
    fit: FIT_OPTIONS.has(fit) ? (fit as InquiryFacts["fit"]) : "needs_review",
    jobType: titleCaseJobType(
      typeof input.job_type === "string" && input.job_type.trim()
        ? input.job_type.trim()
        : null,
    ),
    missingInfo: Array.isArray(input.missing_info)
      ? input.missing_info
          .map((item) => (typeof item === "string" ? item.trim() : null))
          .filter((item): item is string => Boolean(item))
      : [],
    preferredTime:
      typeof input.preferred_time === "string" && input.preferred_time.trim()
        ? input.preferred_time.trim()
        : null,
    urgency: URGENCY_OPTIONS.has(urgency)
      ? (urgency as InquiryFacts["urgency"])
      : "normal",
  };
}

async function syncPendingActionFacts(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
  conversationId: string,
  facts: EditableInquiryFacts,
  editedByUserId: string,
) {
  const { data: actions, error } = await supabase
    .from("actions")
    .select("id,type,input")
    .eq("workspace_id", workspaceId)
    .eq("target_type", "conversation")
    .eq("target_id", conversationId)
    .in("status", ["pending_approval", "approved"]);

  if (error) {
    throw new Error(`Unable to load actions for fact sync: ${error.message}`);
  }

  const factsJson = factsForJson(facts);
  const editedAt = new Date().toISOString();

  for (const action of actions ?? []) {
    const input = objectRecord(action.input);
    const nextInput: Record<string, unknown> = {
      ...input,
      inquiryFacts: factsJson,
      inquiryFactsEditedAt: editedAt,
      inquiryFactsEditedByUserId: editedByUserId,
    };
    const type = String(action.type);

    if (type === "ask_missing_info") {
      nextInput.missingInfo = facts.missingInfo;
      nextInput.prompt = facts.missingInfo.length
        ? `Ask customer for: ${facts.missingInfo.join(", ")}`
        : "No missing information is currently flagged.";
    }

    if (type === "book_site_visit") {
      nextInput.address = facts.address;
      nextInput.preferredTime = facts.preferredTime;
      nextInput.title = `Site visit for ${facts.jobType ?? "quote inquiry"}`;
    }

    if (type === "create_quote_draft") {
      nextInput.quoteDraft = {
        ...objectRecord(input.quoteDraft),
        title: `${facts.jobType ?? "Trade Service"} quote draft`,
        lineItems: quoteLineItems(facts),
        notes: quoteNotes(facts),
      };
    }

    if (type === "schedule_follow_up") {
      nextInput.reason = facts.missingInfo.length
        ? `Waiting on ${facts.missingInfo.join(", ")}.`
        : "Follow up based on the corrected inquiry facts.";
    }

    const { error: updateError } = await supabase
      .from("actions")
      .update({
        input: nextInput,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", action.id);

    if (updateError) {
      throw new Error(`Unable to sync action facts: ${updateError.message}`);
    }
  }
}

async function cancelStalePlanActions(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
  userId: string,
  conversationId: string,
  leadId?: string | null,
) {
  const now = new Date().toISOString();
  const { data: conversationActions, error } = await supabase
    .from("actions")
    .update({
      status: "cancelled",
      result: {
        cancelledReason: "user_corrected_facts_regenerated",
        cancelledAt: now,
      },
    })
    .eq("workspace_id", workspaceId)
    .eq("target_type", "conversation")
    .eq("target_id", conversationId)
    .in("type", [
      "draft_reply",
      "ask_missing_info",
      "book_site_visit",
      "create_quote_draft",
      "schedule_follow_up",
    ])
    .in("status", ["pending_approval", "approved"])
    .select("id,type,status,target_type,target_id");

  if (error) {
    throw new Error(`Unable to cancel stale actions: ${error.message}`);
  }

  const cancelledActions = [...(conversationActions ?? [])];

  if (leadId) {
    const { data: leadActions, error: leadError } = await supabase
      .from("actions")
      .update({
        status: "cancelled",
        result: {
          cancelledReason: "user_corrected_facts_regenerated",
          cancelledAt: now,
        },
      })
      .eq("workspace_id", workspaceId)
      .eq("target_type", "lead")
      .eq("target_id", leadId)
      .eq("type", "mark_not_fit")
      .in("status", ["pending_approval", "approved"])
      .select("id,type,status,target_type,target_id");

    if (leadError) {
      throw new Error(
        `Unable to cancel stale lead actions: ${leadError.message}`,
      );
    }

    cancelledActions.push(...(leadActions ?? []));
  }

  for (const action of cancelledActions ?? []) {
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "user",
      actorId: userId,
      action: "action.cancelled_due_to_fact_regeneration",
      entityType: "action",
      entityId: String(action.id),
      after: {
        type: action.type,
        status: "cancelled",
      },
      metadata: {
        conversationId,
        previousTargetId: action.target_id,
        previousTargetType: action.target_type,
      },
    });
  }

  return cancelledActions.length;
}

async function cancelIgnoredConversationActions(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
  userId: string,
  conversationId: string,
) {
  const now = new Date().toISOString();
  const { data: cancelledActions, error } = await supabase
    .from("actions")
    .update({
      status: "cancelled",
      result: {
        cancelledAt: now,
        cancelledReason: "user_ignored_notification",
      },
    })
    .eq("workspace_id", workspaceId)
    .eq("target_type", "conversation")
    .eq("target_id", conversationId)
    .in("type", [
      "draft_reply",
      "ask_missing_info",
      "book_site_visit",
      "create_quote_draft",
      "schedule_follow_up",
    ])
    .in("status", ["pending_approval", "approved"])
    .select("id,type,status,target_type,target_id");

  if (error) {
    throw new Error(`Unable to ignore pending actions: ${error.message}`);
  }

  for (const action of cancelledActions ?? []) {
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "user",
      actorId: userId,
      action: "action.cancelled_due_to_ignored_notification",
      entityType: "action",
      entityId: String(action.id),
      after: {
        status: "cancelled",
        type: action.type,
      },
      metadata: {
        conversationId,
        previousTargetId: action.target_id,
        previousTargetType: action.target_type,
      },
    });
  }

  return cancelledActions?.length ?? 0;
}

function conversationPath(conversationId: string) {
  return `/inbox/${encodeURIComponent(conversationId)}`;
}

function safeRedirectPath(value: string, fallback: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function redirectWithConversationMessage(
  conversationId: string,
  key: "engine_error" | "engine_message",
  message: string,
  redirectTo?: string,
): never {
  const target = safeRedirectPath(
    redirectTo ?? "",
    conversationPath(conversationId),
  );
  const separator = target.includes("?") ? "&" : "?";

  redirect(`${target}${separator}${key}=${encodeURIComponent(message)}`);
}

function redirectWithInboxMessage(
  key: "engine_error" | "engine_message",
  message: string,
  redirectTo = "/inbox",
): never {
  const target = safeRedirectPath(redirectTo, "/inbox");
  const separator = target.includes("?") ? "&" : "?";

  redirect(`${target}${separator}${key}=${encodeURIComponent(message)}`);
}

async function assertQuoteDraftBelongsToConversation({
  attachmentQuoteDraftId,
  conversationId,
  redirectTo,
  supabase,
  workspaceId,
}: {
  attachmentQuoteDraftId: string | null;
  conversationId: string;
  redirectTo: string;
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"];
  workspaceId: string;
}) {
  if (!attachmentQuoteDraftId) {
    return;
  }

  const { data: quoteDraft, error } = await supabase
    .from("quote_drafts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("id", attachmentQuoteDraftId)
    .maybeSingle();

  if (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error.message,
      redirectTo,
    );
  }

  if (!quoteDraft) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "That attachment is not linked to this conversation.",
      redirectTo,
    );
  }
}

function isUploadFile(value: FormDataEntryValue): value is File {
  if (typeof value !== "object" || !value) {
    return false;
  }

  const maybeFile = value as {
    arrayBuffer?: unknown;
    name?: unknown;
    size?: unknown;
    type?: unknown;
  };

  return (
    typeof maybeFile.arrayBuffer === "function" &&
    typeof maybeFile.name === "string" &&
    typeof maybeFile.size === "number"
  );
}

async function readLocalAttachments(
  formData: FormData,
  conversationId: string,
  redirectTo: string,
) {
  const uploads = formData
    .getAll("localAttachments")
    .filter(isUploadFile)
    .filter((file) => file.name.trim() && file.size > 0);

  if (uploads.length > MAX_LOCAL_ATTACHMENT_COUNT) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      `Attach up to ${MAX_LOCAL_ATTACHMENT_COUNT} local files at a time.`,
      redirectTo,
    );
  }

  const totalBytes = uploads.reduce((sum, file) => sum + file.size, 0);

  if (totalBytes > MAX_LOCAL_ATTACHMENT_BYTES) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Local attachments are limited to 10 MB total for now.",
      redirectTo,
    );
  }

  const attachments: OutboundAttachment[] = [];

  for (const file of uploads) {
    const buffer = Buffer.from(await file.arrayBuffer());

    attachments.push({
      contentBase64: buffer.toString("base64"),
      contentType: file.type || "application/octet-stream",
      filename: file.name,
      sizeBytes: buffer.byteLength,
      source: "local_upload",
    });
  }

  return attachments;
}

export async function updateInquiryFactsAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const urgency = formString(formData, "urgency") || "normal";
  const fit = formString(formData, "fit") || "needs_review";
  const addressFields = parseAddressFormData(formData, "address");

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  if (!URGENCY_OPTIONS.has(urgency)) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Urgency is invalid.",
    );
  }

  if (!FIT_OPTIONS.has(fit)) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Lead suitability is invalid.",
    );
  }

  const facts: EditableInquiryFacts = {
    address: nullableText(formString(formData, "address")),
    budget: nullableText(formString(formData, "budget")),
    fit: fit as EditableInquiryFacts["fit"],
    jobType: titleCaseJobType(nullableText(formString(formData, "jobType"))),
    missingInfo: parseMissingInfo(formString(formData, "missingInfo")),
    preferredTime: nullableText(formString(formData, "preferredTime")),
    urgency: urgency as EditableInquiryFacts["urgency"],
  };

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,contact_id,lead_id")
    .eq("workspace_id", workspace.id)
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      conversationError.message,
    );
  }

  if (!conversation) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Conversation was not found.",
    );
  }

  const { data: beforeFacts, error: beforeError } = await supabase
    .from("inquiry_facts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (beforeError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      beforeError.message,
    );
  }

  const { data: savedFacts, error: saveError } = await supabase
    .from("inquiry_facts")
    .upsert(
      {
        workspace_id: workspace.id,
        conversation_id: conversationId,
        contact_id: conversation.contact_id ?? null,
        lead_id: conversation.lead_id ?? null,
        job_type: facts.jobType,
        ...(formString(formData, "addressGooglePlaceId") ||
        !beforeFacts ||
        facts.address !== (beforeFacts.address ?? null)
          ? addressFields
          : { address: facts.address }),
        preferred_time: facts.preferredTime,
        urgency: facts.urgency,
        budget: facts.budget,
        fit: facts.fit,
        missing_info: facts.missingInfo,
        source: "user_edit",
        edited_by_user_id: user.id,
        metadata: {
          editedFrom: beforeFacts ? "existing_facts" : "manual_entry",
        },
      },
      {
        onConflict: "workspace_id,conversation_id",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedFacts) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      saveError?.message ?? "Unable to save inquiry facts.",
    );
  }

  try {
    await syncPendingActionFacts(
      supabase,
      workspace.id,
      conversationId,
      facts,
      user.id,
    );
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error ? error.message : "Unable to sync action facts.",
    );
  }

  if (conversation.lead_id && facts.jobType) {
    const { error: leadUpdateError } = await supabase
      .from("leads")
      .update({
        service_type: facts.jobType,
      })
      .eq("workspace_id", workspace.id)
      .eq("id", conversation.lead_id);

    if (leadUpdateError) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        leadUpdateError.message,
      );
    }
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "inquiry_facts.updated",
    entityType: "inquiry_facts",
    entityId: String(savedFacts.id),
    before: beforeFacts ? objectRecord(beforeFacts) : null,
    after: {
      conversationId,
      inquiryFacts: factsForJson(facts),
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Inquiry facts saved.",
  );
}

export async function regenerateAiPlanAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,contact_id,lead_id")
    .eq("workspace_id", workspace.id)
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      conversationError.message,
    );
  }

  if (!conversation) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Conversation was not found.",
    );
  }

  const { data: factsRecord, error: factsError } = await supabase
    .from("inquiry_facts")
    .select("job_type,address,preferred_time,urgency,budget,fit,missing_info")
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (factsError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      factsError.message,
    );
  }

  if (!factsRecord) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Save the inquiry facts before regenerating the plan.",
    );
  }

  const inquiryFacts = toInquiryFacts(factsRecord);
  const { data: threadMessages, error: threadError } = await supabase
    .from("messages")
    .select("direction,subject,body_text")
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (threadError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      threadError.message,
    );
  }

  let cancelledCount = 0;

  try {
    cancelledCount = await cancelStalePlanActions(
      supabase,
      workspace.id,
      user.id,
      conversationId,
      conversation.lead_id ? String(conversation.lead_id) : null,
    );
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to cancel stale actions.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "ai_plan.regeneration_requested",
    entityType: "conversation",
    entityId: conversationId,
    after: {
      cancelledActionCount: cancelledCount,
      inquiryFacts: factsForJson(inquiryFacts),
    },
  });

  try {
    await runStubAiTriage(supabase, user, workspace.id, {
      source: "user_corrected_facts",
      contactId: conversation.contact_id
        ? String(conversation.contact_id)
        : undefined,
      leadId: conversation.lead_id ? String(conversation.lead_id) : undefined,
      conversationId,
      leadTitle: inquiryFacts.jobType ?? undefined,
      serviceType: inquiryFacts.jobType,
      contactAddress: inquiryFacts.address,
      summary: `Regenerate plan from user-corrected inquiry facts for ${
        inquiryFacts.jobType ?? "general inquiry"
      }.`,
      threadMessageCount: threadMessages?.length ?? 0,
      threadSummary: buildThreadSummary(threadMessages ?? []),
      inquiryFactsOverride: inquiryFacts,
    });
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error ? error.message : "Unable to regenerate AI plan.",
    );
  }

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "AI plan regenerated from corrected facts.",
  );
}

export async function updateDraftReplyAction(formData: FormData) {
  const actionId = formString(formData, "actionId");
  const conversationId = formString(formData, "conversationId");
  const subject = formString(formData, "subject") || "Thanks for reaching out";
  const body = formString(formData, "body");
  const attachmentQuoteDraftId = nullableText(
    formString(formData, "attachmentQuoteDraftId"),
  );
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationPath(conversationId),
  );

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  if (!actionId) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Action id is required.",
      redirectTo,
    );
  }

  if (!body) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Reply body is required.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  await assertQuoteDraftBelongsToConversation({
    attachmentQuoteDraftId,
    conversationId,
    redirectTo,
    supabase,
    workspaceId: workspace.id,
  });
  const { data: action, error: loadError } = await supabase
    .from("actions")
    .select("id,type,status,input,target_type,target_id")
    .eq("workspace_id", workspace.id)
    .eq("id", actionId)
    .maybeSingle();

  if (loadError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      loadError.message,
      redirectTo,
    );
  }

  if (!action) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Draft reply action was not found.",
      redirectTo,
    );
  }

  if (
    String(action.type) !== "draft_reply" ||
    String(action.target_type) !== "conversation" ||
    String(action.target_id) !== conversationId
  ) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "That action is not attached to this conversation.",
      redirectTo,
    );
  }

  if (String(action.status) !== "pending_approval") {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Only pending draft replies can be edited.",
      redirectTo,
    );
  }

  const before = objectRecord(action.input);
  const subjectChanged =
    (textValue(before.subject) ?? "Thanks for reaching out") !== subject;
  const bodyChanged = (textValue(before.body) ?? "") !== body;
  const attachmentChanged =
    (textValue(before.attachmentQuoteDraftId) ?? null) !==
    attachmentQuoteDraftId;
  const userEditedDraft =
    Boolean(before.userEditedDraft) ||
    Boolean(before.editedByUserId) ||
    subjectChanged ||
    bodyChanged ||
    attachmentChanged;
  const after = {
    ...before,
    attachmentQuoteDraftId,
    subject,
    body,
    dryRun: true,
    userEditedDraft,
    ...(userEditedDraft
      ? {
          editedAt: new Date().toISOString(),
          editedByUserId: user.id,
        }
      : {}),
  };

  const { error: updateError } = await supabase
    .from("actions")
    .update({
      input: after,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", actionId);

  if (updateError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      updateError.message,
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "draft_reply.updated",
    entityType: "action",
    entityId: actionId,
    before: {
      input: before,
    },
    after: {
      input: after,
    },
    metadata: {
      conversationId,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Draft reply saved.",
    redirectTo,
  );
}

export async function sendDraftReplyAction(formData: FormData) {
  const actionId = formString(formData, "actionId");
  const conversationId = formString(formData, "conversationId");
  const subject = formString(formData, "subject") || "Thanks for reaching out";
  const body = formString(formData, "body");
  const attachmentQuoteDraftId = nullableText(
    formString(formData, "attachmentQuoteDraftId"),
  );
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationPath(conversationId),
  );

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  if (!actionId) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Action id is required.",
      redirectTo,
    );
  }

  if (!body) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Reply body is required.",
      redirectTo,
    );
  }

  const localAttachments = await readLocalAttachments(
    formData,
    conversationId,
    redirectTo,
  );
  const { supabase, user, workspace } = await requireWorkspaceContext();
  await assertQuoteDraftBelongsToConversation({
    attachmentQuoteDraftId,
    conversationId,
    redirectTo,
    supabase,
    workspaceId: workspace.id,
  });
  const { data: action, error: loadError } = await supabase
    .from("actions")
    .select("id,type,status,input,target_type,target_id")
    .eq("workspace_id", workspace.id)
    .eq("id", actionId)
    .maybeSingle();

  if (loadError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      loadError.message,
      redirectTo,
    );
  }

  if (!action) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Draft reply action was not found.",
      redirectTo,
    );
  }

  if (
    String(action.type) !== "draft_reply" ||
    String(action.target_type) !== "conversation" ||
    String(action.target_id) !== conversationId
  ) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "That action is not attached to this conversation.",
      redirectTo,
    );
  }

  if (String(action.status) !== "pending_approval") {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Only pending generated replies can be edited and sent from this form.",
      redirectTo,
    );
  }

  const before = objectRecord(action.input);
  const subjectChanged =
    (textValue(before.subject) ?? "Thanks for reaching out") !== subject;
  const bodyChanged = (textValue(before.body) ?? "") !== body;
  const attachmentChanged =
    (textValue(before.attachmentQuoteDraftId) ?? null) !==
    attachmentQuoteDraftId;
  const localAttachmentChanged = localAttachments.length > 0;
  const userEditedDraft =
    Boolean(before.userEditedDraft) ||
    Boolean(before.editedByUserId) ||
    subjectChanged ||
    bodyChanged ||
    attachmentChanged ||
    localAttachmentChanged;
  const signatureVariant = userEditedDraft ? "manual" : "ai_generated";
  const after = {
    ...before,
    attachmentQuoteDraftId,
    subject,
    body,
    gmailExternalSendEnabled: true,
    settingsSnapshot: {
      ...objectRecord(before.settingsSnapshot),
      localAttachmentCount: localAttachments.length,
      localAttachmentFilenames: localAttachments.map(
        (attachment) => attachment.filename,
      ),
      signatureVariant,
      userEditedDraft,
    },
    signatureVariant,
    userEditedDraft,
    ...(userEditedDraft
      ? {
          editedAt: new Date().toISOString(),
          editedByUserId: user.id,
        }
      : {}),
  };

  const { error: updateError } = await supabase
    .from("actions")
    .update({
      input: after,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", actionId);

  if (updateError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      updateError.message,
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "draft_reply.updated",
    entityType: "action",
    entityId: actionId,
    before: {
      input: before,
    },
    after: {
      input: after,
    },
    metadata: {
      conversationId,
      source: "send_generated_reply",
    },
  });

  try {
    await approveAction(supabase, user, actionId);
    await executeAction(supabase, user, actionId, {
      draftReplyAttachments: localAttachments,
    });
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to send generated reply.",
      redirectTo,
    );
  }

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Generated reply sent.",
    redirectTo,
  );
}

export async function createMockOutboundMessageAction(formData: FormData) {
  const submissionKey =
    formString(formData, "submissionKey") || crypto.randomUUID();
  const conversationId = formString(formData, "conversationId");
  const channelType = formString(formData, "channelType");
  const subject = nullableText(formString(formData, "subject"));
  const body = formString(formData, "body");
  const attachmentQuoteDraftId = nullableText(
    formString(formData, "attachmentQuoteDraftId"),
  );
  const includeSignature = formBoolean(formData, "includeSignature");
  const signatureVariant = formSignatureVariant(formData);

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationPath(conversationId),
  );

  if (!isOutboundChannel(channelType)) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Outbound channel is invalid.",
      redirectTo,
    );
  }

  if (!body) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Outbound message body is required.",
      redirectTo,
    );
  }

  const localAttachments = await readLocalAttachments(
    formData,
    conversationId,
    redirectTo,
  );
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const settings = await getCommunicationSettings(supabase, workspace.id);

  if (!settings.allowedChannels.includes(channelType)) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      `${channelType.toUpperCase()} is disabled in communication settings.`,
      redirectTo,
    );
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,contact_id,lead_id")
    .eq("workspace_id", workspace.id)
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      conversationError.message,
      redirectTo,
    );
  }

  if (!conversation) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Conversation was not found.",
      redirectTo,
    );
  }

  if (attachmentQuoteDraftId) {
    const { data: quoteDraft, error: quoteDraftError } = await supabase
      .from("quote_drafts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("conversation_id", conversationId)
      .eq("id", attachmentQuoteDraftId)
      .maybeSingle();

    if (quoteDraftError) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        quoteDraftError.message,
        redirectTo,
      );
    }

    if (!quoteDraft) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        "That quote draft is not attached to this conversation.",
        redirectTo,
      );
    }
  }

  const shouldApplySignature = channelType === "email" && includeSignature;
  const signedBody = shouldApplySignature
    ? buildSignedEmailBody({
        body,
        signature: selectEmailSignature(settings, signatureVariant),
      })
    : {
        bodyText: body.trim(),
        htmlBody: null,
        inlineAttachments: [],
        signatureApplied: false,
      };
  const settingsSnapshot = {
    approvalRequired: settings.approvalRequired,
    approvalSatisfiedBy: "manual_user_send",
    allowedChannels: settings.allowedChannels,
    defaultTone: settings.defaultTone,
    gmailExternalSendEnabled: channelType === "email",
    localAttachmentCount: localAttachments.length,
    signatureApplied: signedBody.signatureApplied,
    signatureIncluded: shouldApplySignature,
    signatureVariant: shouldApplySignature ? signatureVariant : null,
  };

  let outboundResult: Awaited<ReturnType<typeof recordOutboundMessage>>;

  try {
    outboundResult = await recordOutboundMessage(supabase, {
      workspaceId: workspace.id,
      userId: user.id,
      conversationId,
      channelType,
      subject,
      body: signedBody.bodyText,
      htmlBody: signedBody.htmlBody,
      attachmentQuoteDraftId,
      attachments: [...signedBody.inlineAttachments, ...localAttachments],
      source: "composer.outbound",
      idempotencyKey: `composer.outbound.${conversationId}.${submissionKey}`,
      settingsSnapshot,
    });
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to send outbound message.",
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "system",
    action: outboundResult.externalSend
      ? "message.outbound_sent"
      : "message.outbound_dry_run_recorded",
    entityType: "message",
    entityId: outboundResult.outboundMessageId,
    before: {
      conversationStatus: outboundResult.previousConversationStatus,
    },
    after: {
      attachmentQuoteDraftId: outboundResult.attachmentQuoteDraftId,
      channelType: outboundResult.channelType,
      conversationId: outboundResult.conversationId,
      direction: "outbound",
      dryRun: outboundResult.dryRun,
      externalMessageId: outboundResult.externalMessageId,
      externalSend: outboundResult.externalSend,
      outboundQueueId: outboundResult.outboundQueueId,
      attachments: outboundResult.attachments,
      sentTo: outboundResult.sentTo,
      subject: outboundResult.subject,
    },
    metadata: {
      requestedByUserId: user.id,
      source: "composer.outbound",
    },
  });

  if (
    outboundResult.attachmentQuoteDraftId &&
    outboundResult.quoteDraftStatusAfter
  ) {
    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      actorType: "system",
      action: outboundResult.externalSend
        ? "quote_draft.sent_external"
        : "quote_draft.sent_dry_run",
      entityType: "quote_draft",
      entityId: outboundResult.attachmentQuoteDraftId,
      before: {
        status: outboundResult.quoteDraftStatusBefore,
      },
      after: {
        status: outboundResult.quoteDraftStatusAfter,
        channelType: outboundResult.channelType,
        conversationId: outboundResult.conversationId,
        dryRun: outboundResult.dryRun,
        externalMessageId: outboundResult.externalMessageId,
        externalSend: outboundResult.externalSend,
        outboundMessageId: outboundResult.outboundMessageId,
        outboundQueueId: outboundResult.outboundQueueId,
      },
      metadata: {
        requestedByUserId: user.id,
        source: "composer.outbound",
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath("/files");
  revalidatePath("/documents");
  if (outboundResult.attachmentQuoteDraftId) {
    revalidatePath(`/files/${outboundResult.attachmentQuoteDraftId}`);
    revalidatePath(`/documents/${outboundResult.attachmentQuoteDraftId}`);
  }
  revalidatePath(conversationPath(conversationId));
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    outboundResult.externalSend
      ? "Reply sent and recorded in the thread."
      : "Outbound message recorded in the thread.",
    redirectTo,
  );
}

export async function retryOutboundDeliveryAction(formData: FormData) {
  const outboundQueueId = formString(formData, "outboundQueueId");
  const conversationId = formString(formData, "conversationId");

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationPath(conversationId),
  );

  if (!outboundQueueId) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Outbound delivery id is required.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let result: Awaited<ReturnType<typeof retryOutboundMessage>>;

  try {
    result = await retryOutboundMessage(supabase, {
      workspaceId: workspace.id,
      userId: user.id,
      outboundQueueId,
    });
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to retry outbound delivery.",
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "outbound_message.manual_retry_completed",
    entityType: "outbound_message",
    entityId: outboundQueueId,
    after: {
      externalMessageId: result.externalMessageId,
      externalSend: result.externalSend,
      messageId: result.outboundMessageId,
      sentTo: result.sentTo,
      status: result.outboxStatus,
    },
    metadata: {
      conversationId,
      source: "inbox.retry_outbound_delivery",
    },
  });

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    result.externalSend
      ? "Outbound delivery retried and sent."
      : "Outbound delivery retried and recorded.",
    redirectTo,
  );
}

function defaultSkippedReplySubject(subject: string | null) {
  const value = subject?.trim() || "Follow-up";

  return value.toLowerCase().startsWith("re:") ? value : `Re: ${value}`;
}

export async function promoteSkippedEmailToWorkItemAction(formData: FormData) {
  const eventId = formString(formData, "eventId");

  if (!eventId) {
    redirectWithInboxMessage(
      "engine_error",
      "Skipped email id is required.",
      "/inbox?skipped=1",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    const result = await promoteSkippedEmailEvent({
      eventId,
      supabase,
      user,
      workspaceId: workspace.id,
    });

    revalidatePath("/inbox");
    revalidatePath(conversationPath(result.conversationId));
    redirectWithConversationMessage(
      result.conversationId,
      "engine_message",
      result.duplicate
        ? "That email was already in the work queue."
        : "Promoted filtered-out email into a work item.",
    );
  } catch (error) {
    redirectWithInboxMessage(
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to promote filtered-out email.",
      "/inbox?skipped=1",
    );
  }
}

function formSenderRuleAction(
  value: string,
): InboundEmailSenderRuleAction | null {
  if (value === "always_promote" || value === "always_ignore") {
    return value;
  }

  return null;
}

async function applySkippedEmailSenderRule({
  eventId,
  ruleAction,
}: {
  eventId: string;
  ruleAction: InboundEmailSenderRuleAction;
}) {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,payload")
    .eq("workspace_id", workspace.id)
    .eq("id", eventId)
    .eq("type", "inbound.email.received")
    .maybeSingle();

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (!event) {
    throw new Error("Filtered-out email was not found.");
  }

  const payload = objectRecord(event.payload);
  const fromEmail = textValue(payload.fromEmail);
  const ruleValue = senderRuleTargetFromEmail(fromEmail, "email");

  if (!ruleValue) {
    throw new Error("This email does not have a sender address to learn from.");
  }

  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    throw new Error(beforeError.message);
  }

  const beforeSettings = normalizeInboundEmailSettings(beforePolicy?.settings);
  const settings = upsertInboundEmailSenderRule(beforeSettings, {
    action: ruleAction,
    createdAt: new Date().toISOString(),
    createdFromEventId: eventId,
    match: "email",
    value: ruleValue,
  });
  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: INBOUND_EMAIL_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    throw new Error(saveError?.message ?? "Unable to save sender rule.");
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "inbound_email.sender_rule_updated",
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: {
      senderRules: beforeSettings.senderRules,
    },
    after: {
      senderRules: settings.senderRules,
    },
    metadata: {
      eventId,
      fromEmail,
      ruleAction,
    },
  });

  return {
    ruleAction,
    ruleValue,
  };
}

export type SkippedEmailSenderRuleState = {
  error: string | null;
  message: string | null;
  ruleAction: InboundEmailSenderRuleAction | null;
  ruleValue: string | null;
};

function senderRuleMessage(
  ruleAction: InboundEmailSenderRuleAction,
  ruleValue: string,
) {
  return ruleAction === "always_promote"
    ? `Future emails from ${ruleValue} will be treated as relevant.`
    : `Future emails from ${ruleValue} will be ignored.`;
}

export async function updateSkippedEmailSenderRuleStateAction(
  previousState: SkippedEmailSenderRuleState,
  formData: FormData,
): Promise<SkippedEmailSenderRuleState> {
  const eventId = formString(formData, "eventId");
  const ruleAction = formSenderRuleAction(formString(formData, "ruleAction"));

  if (!eventId || !ruleAction) {
    return {
      ...previousState,
      error: "Sender rule request is invalid.",
      message: null,
    };
  }

  try {
    const result = await applySkippedEmailSenderRule({
      eventId,
      ruleAction,
    });

    revalidatePath("/inbox");
    revalidatePath("/settings");

    return {
      error: null,
      message: senderRuleMessage(result.ruleAction, result.ruleValue),
      ruleAction: result.ruleAction,
      ruleValue: result.ruleValue,
    };
  } catch (error) {
    return {
      ...previousState,
      error:
        error instanceof Error ? error.message : "Unable to save sender rule.",
      message: null,
    };
  }
}

export async function updateSkippedEmailSenderRuleAction(formData: FormData) {
  const eventId = formString(formData, "eventId");
  const ruleAction = formSenderRuleAction(formString(formData, "ruleAction"));
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    "/inbox?skipped=1",
  );

  if (!eventId || !ruleAction) {
    redirectWithInboxMessage(
      "engine_error",
      "Sender rule request is invalid.",
      redirectTo,
    );
  }

  let result: Awaited<ReturnType<typeof applySkippedEmailSenderRule>>;

  try {
    result = await applySkippedEmailSenderRule({
      eventId,
      ruleAction,
    });
  } catch (error) {
    redirectWithInboxMessage(
      "engine_error",
      error instanceof Error ? error.message : "Unable to save sender rule.",
      redirectTo,
    );
  }

  revalidatePath("/inbox");
  revalidatePath("/settings");
  redirectWithInboxMessage(
    "engine_message",
    senderRuleMessage(result.ruleAction, result.ruleValue),
    redirectTo,
  );
}

export async function sendSkippedEmailReplyAction(formData: FormData) {
  const submissionKey =
    formString(formData, "submissionKey") || crypto.randomUUID();
  const eventId = formString(formData, "eventId");
  const subject = nullableText(formString(formData, "subject"));
  const body = formString(formData, "body");
  const includeSignature = formBoolean(formData, "includeSignature");
  const signatureVariant = formSignatureVariant(formData);
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    "/inbox?skipped=1",
  );

  if (!eventId) {
    redirectWithInboxMessage(
      "engine_error",
      "Skipped email id is required.",
      redirectTo,
    );
  }

  if (!body) {
    redirectWithInboxMessage(
      "engine_error",
      "Reply body is required.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,payload")
    .eq("workspace_id", workspace.id)
    .eq("id", eventId)
    .eq("type", "inbound.email.received")
    .eq("status", "processed")
    .maybeSingle();

  if (eventError) {
    redirectWithInboxMessage("engine_error", eventError.message, redirectTo);
  }

  if (!event) {
    redirectWithInboxMessage(
      "engine_error",
      "Skipped email was not found.",
      redirectTo,
    );
  }

  const payload = objectRecord(event.payload);

  if (textValue(payload.stage) !== "observed") {
    redirectWithInboxMessage(
      "engine_error",
      "Only filtered-out emails can be replied to from this panel.",
      redirectTo,
    );
  }

  const to = textValue(payload.fromEmail);

  if (!to) {
    redirectWithInboxMessage(
      "engine_error",
      "This skipped email does not have a sender address.",
      redirectTo,
    );
  }

  const settings = await getCommunicationSettings(supabase, workspace.id);
  const shouldApplySignature = includeSignature;
  const signedBody = shouldApplySignature
    ? buildSignedEmailBody({
        body,
        signature: selectEmailSignature(settings, signatureVariant),
      })
    : {
        bodyText: body.trim(),
        htmlBody: null,
        inlineAttachments: [],
        signatureApplied: false,
      };
  const resolvedSubject =
    subject ?? defaultSkippedReplySubject(textValue(payload.subject));
  let outboundResult: Awaited<ReturnType<typeof recordOutboundEventEmail>>;

  try {
    outboundResult = await recordOutboundEventEmail(supabase, {
      workspaceId: workspace.id,
      userId: user.id,
      eventId,
      recipientEmail: to,
      subject: resolvedSubject,
      body: signedBody.bodyText,
      htmlBody: signedBody.htmlBody,
      attachments: signedBody.inlineAttachments,
      source: "inbox.filtered_email_reply",
      idempotencyKey: `email.filtered_reply.${eventId}.${submissionKey}`,
      settingsSnapshot: {
        approvalRequired: settings.approvalRequired,
        approvalSatisfiedBy: "manual_user_send",
        allowedChannels: settings.allowedChannels,
        signatureApplied: signedBody.signatureApplied,
        signatureIncluded: shouldApplySignature,
        signatureVariant: shouldApplySignature ? signatureVariant : null,
      },
      replyEventPayload: {
        originalEventId: eventId,
        originalExternalMessageId: textValue(payload.externalMessageId),
        originalExternalThreadId: textValue(payload.externalThreadId),
        signatureApplied: signedBody.signatureApplied,
      },
      replyEventType: "outbound.filtered_email.reply_sent",
    });
  } catch (error) {
    redirectWithInboxMessage(
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to send filtered-out email reply.",
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "filtered_email.reply_sent",
    entityType: "event",
    entityId: eventId,
    after: {
      externalMessageId: outboundResult.externalMessageId,
      outboundQueueId: outboundResult.outboundQueueId,
      replyEventId: outboundResult.outboundRecordId,
      sentTo: to,
      subject: resolvedSubject,
    },
    metadata: {
      replyEventId: outboundResult.outboundRecordId,
      source: "skipped_email_dialog",
    },
  });

  revalidatePath("/inbox");
  redirectWithInboxMessage(
    "engine_message",
    "Reply sent from filtered-out email.",
    redirectTo,
  );
}

const TASK_STATUSES = new Set(["open", "completed", "cancelled"]);
const TASK_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const APPOINTMENT_STATUSES = new Set([
  "suggested",
  "scheduled",
  "completed",
  "cancelled",
]);

function optionalIsoDateTime(value: string) {
  if (!value.trim()) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function workflowPriority(value: string) {
  return TASK_PRIORITIES.has(value) ? value : "normal";
}

function workflowStatus(value: string) {
  return TASK_STATUSES.has(value) ? value : "open";
}

function appointmentStatus(value: string, startsAt: string | null) {
  if (APPOINTMENT_STATUSES.has(value)) {
    return value;
  }

  return startsAt ? "scheduled" : "suggested";
}

async function loadWorkflowConversation(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
  conversationId: string,
) {
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("id,contact_id,lead_id,status")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!conversation) {
    throw new Error("Conversation was not found.");
  }

  return conversation;
}

async function loadWorkflowMessage(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
  conversationId: string,
  messageId: string,
) {
  const { data: message, error } = await supabase
    .from("messages")
    .select("id,conversation_id,contact_id,subject,body_text")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!message) {
    throw new Error("Message was not found in this conversation.");
  }

  return message;
}

export async function createConversationTaskAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const messageId = nullableText(formString(formData, "messageId"));
  const title = formString(formData, "title");
  const description = nullableText(formString(formData, "description"));
  const taskType =
    nullableText(formString(formData, "taskType")) ?? "manual_task";
  const dueAt = optionalIsoDateTime(formString(formData, "dueAt"));
  const priority = workflowPriority(formString(formData, "priority"));
  const status = workflowStatus(formString(formData, "status"));
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationId ? conversationPath(conversationId) : "/inbox",
  );

  if (!conversationId) {
    redirectWithInboxMessage("engine_error", "Conversation id is required.");
  }

  if (!title) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Task title is required.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let conversation: Awaited<ReturnType<typeof loadWorkflowConversation>>;

  try {
    conversation = await loadWorkflowConversation(
      supabase,
      workspace.id,
      conversationId,
    );

    if (messageId) {
      await loadWorkflowMessage(
        supabase,
        workspace.id,
        conversationId,
        messageId,
      );
    }
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to load workflow target.",
      redirectTo,
    );
  }

  const { data: task, error } = await supabase
    .from("conversation_tasks")
    .insert({
      workspace_id: workspace.id,
      conversation_id: conversationId,
      message_id: messageId,
      contact_id: conversation.contact_id ?? null,
      lead_id: conversation.lead_id ?? null,
      assigned_to_user_id: user.id,
      created_by_user_id: user.id,
      task_type: taskType,
      title,
      description,
      status,
      priority,
      due_at: dueAt,
      metadata: {
        source: messageId ? "message_control" : "conversation_control",
      },
    })
    .select("id")
    .single();

  if (error || !task) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error?.message ?? "Unable to create task.",
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "conversation_task.created",
    entityType: "conversation_task",
    entityId: String(task.id),
    after: {
      conversationId,
      dueAt,
      messageId,
      priority,
      status,
      taskType,
      title,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Task saved.",
    redirectTo,
  );
}

export async function completeConversationTaskAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const taskId = formString(formData, "taskId");
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationId ? conversationPath(conversationId) : "/inbox",
  );

  if (!conversationId || !taskId) {
    redirectWithInboxMessage("engine_error", "Task request is invalid.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const now = new Date().toISOString();
  const { data: task, error: loadError } = await supabase
    .from("conversation_tasks")
    .select("id,status,title")
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", taskId)
    .maybeSingle();

  if (loadError || !task) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      loadError?.message ?? "Task was not found.",
      redirectTo,
    );
  }

  const { error } = await supabase
    .from("conversation_tasks")
    .update({
      completed_at: now,
      status: "completed",
    })
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", taskId);

  if (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error.message,
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "conversation_task.completed",
    entityType: "conversation_task",
    entityId: taskId,
    before: {
      status: task.status,
    },
    after: {
      completedAt: now,
      status: "completed",
      title: task.title,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Task completed.",
    redirectTo,
  );
}

export async function resolveMessageAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const messageId = formString(formData, "messageId");
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationId ? conversationPath(conversationId) : "/inbox",
  );

  if (!conversationId || !messageId) {
    redirectWithInboxMessage("engine_error", "Message resolution is invalid.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let message: Awaited<ReturnType<typeof loadWorkflowMessage>>;
  let conversation: Awaited<ReturnType<typeof loadWorkflowConversation>>;

  try {
    [conversation, message] = await Promise.all([
      loadWorkflowConversation(supabase, workspace.id, conversationId),
      loadWorkflowMessage(supabase, workspace.id, conversationId, messageId),
    ]);
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error ? error.message : "Unable to load message.",
      redirectTo,
    );
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("conversation_tasks")
    .update({
      completed_at: now,
      status: "completed",
    })
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .eq("message_id", messageId)
    .eq("status", "open");

  if (updateError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      updateError.message,
      redirectTo,
    );
  }

  const { data: existingResolution, error: existingError } = await supabase
    .from("conversation_tasks")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .eq("message_id", messageId)
    .eq("task_type", "message_resolution")
    .maybeSingle();

  if (existingError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      existingError.message,
      redirectTo,
    );
  }

  let resolutionTaskId = existingResolution?.id
    ? String(existingResolution.id)
    : null;

  if (resolutionTaskId) {
    const { error } = await supabase
      .from("conversation_tasks")
      .update({
        completed_at: now,
        status: "completed",
      })
      .eq("workspace_id", workspace.id)
      .eq("id", resolutionTaskId);

    if (error) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        error.message,
        redirectTo,
      );
    }
  } else {
    const { data: resolutionTask, error } = await supabase
      .from("conversation_tasks")
      .insert({
        workspace_id: workspace.id,
        conversation_id: conversationId,
        message_id: messageId,
        contact_id: conversation.contact_id ?? message.contact_id ?? null,
        lead_id: conversation.lead_id ?? null,
        assigned_to_user_id: user.id,
        created_by_user_id: user.id,
        task_type: "message_resolution",
        title: `Resolved: ${
          textValue(message.subject) ??
          preview(textValue(message.body_text), 64) ??
          "message"
        }`,
        status: "completed",
        priority: "normal",
        completed_at: now,
        metadata: {
          source: "message_mark_resolved",
        },
      })
      .select("id")
      .single();

    if (error || !resolutionTask) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        error?.message ?? "Unable to mark message resolved.",
        redirectTo,
      );
    }

    resolutionTaskId = String(resolutionTask.id);
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "message.resolved",
    entityType: "message",
    entityId: messageId,
    after: {
      conversationId,
      resolutionTaskId,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Message marked resolved.",
    redirectTo,
  );
}

export async function createInternalNoteAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const messageId = nullableText(formString(formData, "messageId"));
  const body = formString(formData, "body");
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationId ? conversationPath(conversationId) : "/inbox",
  );

  if (!conversationId) {
    redirectWithInboxMessage("engine_error", "Conversation id is required.");
  }

  if (!body) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Internal note is required.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let conversation: Awaited<ReturnType<typeof loadWorkflowConversation>>;

  try {
    conversation = await loadWorkflowConversation(
      supabase,
      workspace.id,
      conversationId,
    );

    if (messageId) {
      await loadWorkflowMessage(
        supabase,
        workspace.id,
        conversationId,
        messageId,
      );
    }
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error ? error.message : "Unable to load note target.",
      redirectTo,
    );
  }

  const { data: note, error } = await supabase
    .from("conversation_notes")
    .insert({
      workspace_id: workspace.id,
      conversation_id: conversationId,
      message_id: messageId,
      contact_id: conversation.contact_id ?? null,
      lead_id: conversation.lead_id ?? null,
      author_user_id: user.id,
      body,
      visibility: "internal",
      metadata: {
        source: messageId ? "message_control" : "conversation_control",
      },
    })
    .select("id")
    .single();

  if (error || !note) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error?.message ?? "Unable to add internal note.",
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "conversation_note.created",
    entityType: "conversation_note",
    entityId: String(note.id),
    after: {
      conversationId,
      messageId,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Internal note saved.",
    redirectTo,
  );
}

export async function createConversationAppointmentAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const messageId = nullableText(formString(formData, "messageId"));
  const sourceActionId = nullableText(formString(formData, "sourceActionId"));
  const title = formString(formData, "title") || "Site visit";
  const description = nullableText(formString(formData, "description"));
  const location = nullableText(formString(formData, "location"));
  const startsAt = optionalIsoDateTime(formString(formData, "startsAt"));
  const endsAt = optionalIsoDateTime(formString(formData, "endsAt"));
  const status = appointmentStatus(formString(formData, "status"), startsAt);
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationId ? conversationPath(conversationId) : "/inbox",
  );

  if (!conversationId) {
    redirectWithInboxMessage("engine_error", "Conversation id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let conversation: Awaited<ReturnType<typeof loadWorkflowConversation>>;
  let sourceAction: Record<string, unknown> | null = null;

  try {
    conversation = await loadWorkflowConversation(
      supabase,
      workspace.id,
      conversationId,
    );

    if (messageId) {
      await loadWorkflowMessage(
        supabase,
        workspace.id,
        conversationId,
        messageId,
      );
    }
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to load appointment target.",
      redirectTo,
    );
  }

  if (sourceActionId) {
    const { data: action, error } = await supabase
      .from("actions")
      .select("id,type,status,input,result,approved_at")
      .eq("workspace_id", workspace.id)
      .eq("target_type", "conversation")
      .eq("target_id", conversationId)
      .eq("id", sourceActionId)
      .maybeSingle();

    if (error || !action) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        error?.message ?? "Source action was not found.",
        redirectTo,
      );
    }

    sourceAction = action;
  }

  const { data: task, error: taskError } = await supabase
    .from("conversation_tasks")
    .insert({
      workspace_id: workspace.id,
      conversation_id: conversationId,
      message_id: messageId,
      contact_id: conversation.contact_id ?? null,
      lead_id: conversation.lead_id ?? null,
      assigned_to_user_id: user.id,
      created_by_user_id: user.id,
      source_action_id: sourceActionId,
      task_type: "site_visit",
      title: `Arrange ${title}`,
      description:
        description ??
        (location ? `Site visit location: ${location}` : "Site visit task."),
      status: "open",
      priority: "normal",
      due_at: startsAt,
      metadata: {
        source: sourceActionId ? "action_card" : "manual_appointment",
      },
    })
    .select("id")
    .single();

  if (taskError || !task) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      taskError?.message ?? "Unable to create appointment task.",
      redirectTo,
    );
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from("conversation_appointments")
    .insert({
      workspace_id: workspace.id,
      conversation_id: conversationId,
      message_id: messageId,
      contact_id: conversation.contact_id ?? null,
      lead_id: conversation.lead_id ?? null,
      task_id: task.id,
      created_by_user_id: user.id,
      source_action_id: sourceActionId,
      appointment_type: "site_visit",
      title,
      description,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      location,
      metadata: {
        source: sourceActionId ? "action_card" : "manual_appointment",
      },
    })
    .select("id")
    .single();

  if (appointmentError || !appointment) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      appointmentError?.message ?? "Unable to save appointment.",
      redirectTo,
    );
  }

  if (sourceActionId && sourceAction) {
    const now = new Date().toISOString();
    const previousResult = objectRecord(sourceAction.result);
    const { error: actionUpdateError } = await supabase
      .from("actions")
      .update({
        approved_by_user_id: user.id,
        approved_at: sourceAction.approved_at ? sourceAction.approved_at : now,
        executed_at: now,
        result: {
          ...previousResult,
          appointmentId: appointment.id,
          taskId: task.id,
          recordedAs: "conversation_appointment",
        },
        status: "completed",
      })
      .eq("workspace_id", workspace.id)
      .eq("id", sourceActionId);

    if (actionUpdateError) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        actionUpdateError.message,
        redirectTo,
      );
    }
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "conversation_appointment.created",
    entityType: "conversation_appointment",
    entityId: String(appointment.id),
    after: {
      conversationId,
      location,
      sourceActionId,
      startsAt,
      status,
      taskId: task.id,
      title,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Appointment and task saved.",
    redirectTo,
  );
}

export async function completeConversationAppointmentAction(
  formData: FormData,
) {
  const conversationId = formString(formData, "conversationId");
  const appointmentId = formString(formData, "appointmentId");
  const taskId = nullableText(formString(formData, "taskId"));
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    conversationId ? conversationPath(conversationId) : "/inbox",
  );

  if (!conversationId || !appointmentId) {
    redirectWithInboxMessage("engine_error", "Appointment request is invalid.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("conversation_appointments")
    .update({
      status: "completed",
    })
    .eq("workspace_id", workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", appointmentId);

  if (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error.message,
      redirectTo,
    );
  }

  if (taskId) {
    const { error: taskError } = await supabase
      .from("conversation_tasks")
      .update({
        completed_at: now,
        status: "completed",
      })
      .eq("workspace_id", workspace.id)
      .eq("conversation_id", conversationId)
      .eq("id", taskId);

    if (taskError) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        taskError.message,
        redirectTo,
      );
    }
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "conversation_appointment.completed",
    entityType: "conversation_appointment",
    entityId: appointmentId,
    after: {
      conversationId,
      taskId,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(redirectTo.split("?")[0] || "/inbox");
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Appointment completed.",
    redirectTo,
  );
}

export async function updateConversationStatusAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const status = formString(formData, "status");

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  if (!CONVERSATION_STATUSES.has(status)) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Conversation status is invalid.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: conversation, error: loadError } = await supabase
    .from("conversations")
    .select("id,status")
    .eq("workspace_id", workspace.id)
    .eq("id", conversationId)
    .maybeSingle();

  if (loadError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      loadError.message,
    );
  }

  if (!conversation) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Conversation was not found.",
    );
  }

  const beforeStatus = String(conversation.status);
  const { error: updateError } = await supabase
    .from("conversations")
    .update({
      status,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", conversationId);

  if (updateError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      updateError.message,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "conversation.status_updated",
    entityType: "conversation",
    entityId: conversationId,
    before: {
      status: beforeStatus,
    },
    after: {
      status,
    },
  });

  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Conversation status updated.",
  );
}

export async function ignoreConversationNotificationAction(formData: FormData) {
  const conversationId = formString(formData, "conversationId");
  const redirectTo = formString(formData, "redirectTo");

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: conversation, error: loadError } = await supabase
    .from("conversations")
    .select("id,status")
    .eq("workspace_id", workspace.id)
    .eq("id", conversationId)
    .maybeSingle();

  if (loadError) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      loadError.message,
      redirectTo,
    );
  }

  if (!conversation) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Conversation was not found.",
      redirectTo,
    );
  }

  const beforeStatus = String(conversation.status);
  const cancelledActionCount = await cancelIgnoredConversationActions(
    supabase,
    workspace.id,
    user.id,
    conversationId,
  );

  if (beforeStatus !== "resolved") {
    const { error: updateError } = await supabase
      .from("conversations")
      .update({
        status: "resolved",
      })
      .eq("workspace_id", workspace.id)
      .eq("id", conversationId);

    if (updateError) {
      redirectWithConversationMessage(
        conversationId,
        "engine_error",
        updateError.message,
        redirectTo,
      );
    }
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "conversation.notification_ignored",
    entityType: "conversation",
    entityId: conversationId,
    before: {
      status: beforeStatus,
    },
    after: {
      cancelledActionCount,
      status: "resolved",
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  revalidatePath(
    safeRedirectPath(redirectTo, "/inbox").split("?")[0] || "/inbox",
  );
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    "Notification ignored.",
    redirectTo,
  );
}

export async function createManualFollowUpAction(formData: FormData) {
  const submissionKey = formString(formData, "submissionKey");
  const conversationId = formString(formData, "conversationId");
  const message = formString(formData, "message");

  if (!conversationId) {
    redirect("/inbox?engine_error=Conversation id is required.");
  }

  if (!message) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      "Follow-up message is required.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let wasDuplicate = false;

  try {
    const result = await ingestManualConversationFollowUp(
      supabase,
      user,
      workspace.id,
      {
        submissionKey,
        conversationId,
        message,
      },
    );
    wasDuplicate = Boolean(result.duplicate);
  } catch (error) {
    redirectWithConversationMessage(
      conversationId,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to ingest follow-up message.",
    );
  }

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath(conversationPath(conversationId));
  redirectWithConversationMessage(
    conversationId,
    "engine_message",
    wasDuplicate
      ? "Duplicate follow-up ignored. The first message was already recorded."
      : "Follow-up message recorded and triaged.",
  );
}
