"use server";

import { runAssistantTurn } from "../../lib/assistant/engine";
import {
  appendAssistantTurnMessage,
  appendUserAssistantMessage,
  archiveAssistantThread,
  createAssistantThread,
  getAssistantThreadState,
  getAssistantTurnContext,
  getOrCreateAssistantThread,
  maybeSuggestAssistantMemory,
  maybeSaveAssistantMemory,
  setAssistantMemorySuggestionStatus,
  updateAssistantThreadSummary,
} from "../../lib/assistant/persistence";
import type {
  AssistantResourcePreviewResult,
  AssistantThreadState,
} from "../../lib/assistant/types";
import {
  appendStoredAttachmentContext,
  storeAssistantAttachmentsFromFormData,
} from "../../lib/assistant/attachments";
import { maybeCompactAssistantThreadContext } from "../../lib/assistant/context-compaction";
import {
  getContactProfile,
  getConversationList,
  getConversationReview,
  getQuoteDraftProfile,
  type ConversationListItem,
} from "../../lib/crm/queries";
import {
  conversationToAssistantLink,
  isConversationInLiveWorkQueue,
} from "../../lib/assistant/conversation-links";
import { recordOutboundMessage } from "../../lib/communication/outbound";
import {
  getCommunicationSettings,
  isOutboundChannel,
} from "../../lib/communication/settings";
import {
  buildSignedEmailBody,
  selectEmailSignature,
} from "../../lib/communication/signatures";
import {
  approveAction,
  executeAction,
  insertAuditLog,
} from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import {
  createOutboundVoiceCall,
  getVoiceCallPreview,
} from "../../lib/voice/calls";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const RELIABLE_ASSISTANT_FALLBACK_INTENTS = new Set([
  "app_help",
  "assistant_history_search",
  "contact_summary",
  "document_template_update",
  "email_sync",
  "image_generation",
  "image_generation_recall",
  "inbound_email_awareness",
  "inquiry_lookup",
  "legislation_lookup",
  "memory_save",
  "overview",
  "outbound_call_prepare",
  "pronunciation_update",
  "quote_create",
  "quote_history",
  "quote_lookup",
  "quote_send_prepare",
  "quote_send_ready_list",
  "settings_update",
  "usage_summary",
  "web_search",
  "work_queue",
]);

const INBOX_PREVIEW_FILTERS = new Set([
  "all",
  "awaiting_customer",
  "follow_up_due",
  "live_queue",
  "missing_info",
  "needs_approval",
  "needs_reply",
  "needs_review",
  "reply_or_approval",
  "ready_to_quote",
  "resolved",
  "site_visit_needed",
]);

const INBOX_PREVIEW_SORTS = new Set(["action", "customer", "recent", "urgent"]);

const INBOX_PREVIEW_WORKFLOW_RANK: Record<string, number> = {
  needs_reply: 1,
  missing_info: 2,
  follow_up_due: 3,
  site_visit_needed: 4,
  ready_to_quote: 5,
  needs_review: 6,
  awaiting_customer: 7,
  open: 8,
  resolved: 9,
};

function primaryAssistantModelRequired(intent: string | undefined) {
  if (!intent) {
    return true;
  }

  return !RELIABLE_ASSISTANT_FALLBACK_INTENTS.has(intent);
}

function normalizeInboxPreviewFilter(value: string | null) {
  return value && INBOX_PREVIEW_FILTERS.has(value) ? value : "live_queue";
}

function normalizeInboxPreviewSort(value: string | null) {
  return value && INBOX_PREVIEW_SORTS.has(value) ? value : "recent";
}

function inboxPreviewFilterLabel(filter: string) {
  if (filter === "live_queue") {
    return "Work queue";
  }

  if (filter === "reply_or_approval") {
    return "Replies or approvals";
  }

  if (filter === "all") {
    return "All inbox items";
  }

  return filter
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function inboxPreviewTitle(filter: string) {
  return filter === "live_queue"
    ? "Live work queue"
    : `${inboxPreviewFilterLabel(filter)} inbox`;
}

function inboxPreviewDateValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function inboxPreviewWorkflowRank(value: string) {
  return INBOX_PREVIEW_WORKFLOW_RANK[value] ?? 99;
}

function inboxPreviewSearchText(conversation: ConversationListItem) {
  return [
    conversation.contactName,
    conversation.leadTitle,
    conversation.leadNextStep,
    conversation.leadServiceType,
    conversation.latestSubject,
    conversation.latestBody,
    conversation.originalInquiryBody,
    conversation.nextActionLabel,
    conversation.followUpIsDue ? "follow-up due" : null,
    conversation.followUpDueAt,
    conversation.status,
    conversation.workflowBucket,
    conversation.inquiryFacts?.jobType,
    conversation.inquiryFacts?.address,
    conversation.inquiryFacts?.preferredTime,
    conversation.inquiryFacts?.urgency,
    conversation.inquiryFacts?.fit,
    conversation.inquiryFacts?.missingInfo.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterInboxPreviewConversations(
  conversations: ConversationListItem[],
  filter: string,
) {
  return conversations.filter((conversation) => {
    if (filter === "live_queue") {
      return isConversationInLiveWorkQueue(conversation);
    }

    if (filter === "all") {
      return true;
    }

    if (filter === "needs_approval") {
      return conversation.pendingApprovalCount > 0;
    }

    if (filter === "reply_or_approval") {
      return (
        conversation.workflowBucket === "needs_reply" ||
        conversation.pendingApprovalCount > 0
      );
    }

    if (filter === "missing_info") {
      return Boolean(conversation.inquiryFacts?.missingInfo.length);
    }

    return conversation.workflowBucket === filter;
  });
}

function sortInboxPreviewConversations(
  conversations: ConversationListItem[],
  sort: string,
) {
  return [...conversations].sort((left, right) => {
    if (sort === "urgent") {
      const urgencyScore = (conversation: ConversationListItem) =>
        (conversation.inquiryFacts?.urgency === "urgent" ? 0 : 10) +
        (conversation.leadPriority === "high" ? 0 : 2) +
        inboxPreviewWorkflowRank(conversation.workflowBucket);

      return (
        urgencyScore(left) - urgencyScore(right) ||
        inboxPreviewDateValue(right.lastMessageAt) -
          inboxPreviewDateValue(left.lastMessageAt)
      );
    }

    if (sort === "action") {
      return (
        inboxPreviewWorkflowRank(left.workflowBucket) -
          inboxPreviewWorkflowRank(right.workflowBucket) ||
        inboxPreviewDateValue(right.lastMessageAt) -
          inboxPreviewDateValue(left.lastMessageAt)
      );
    }

    if (sort === "customer") {
      return (
        (left.contactName ?? "").localeCompare(right.contactName ?? "") ||
        inboxPreviewDateValue(right.lastMessageAt) -
          inboxPreviewDateValue(left.lastMessageAt)
      );
    }

    return (
      inboxPreviewDateValue(right.lastMessageAt) -
      inboxPreviewDateValue(left.lastMessageAt)
    );
  });
}

function assistantPreviewTarget(href: string) {
  let contactIdFromQuery: string | null = null;
  let conversationIdFromQuery: string | null = null;
  let inboxFilter: string | null = null;
  let inboxQuery: string | null = null;
  let inboxSort: string | null = null;
  let pathname = href.split("?")[0] ?? href;

  try {
    const url = new URL(href, "http://kyro.local");
    pathname = url.pathname;
    contactIdFromQuery = textValue(url.searchParams.get("contactId"));
    conversationIdFromQuery = textValue(url.searchParams.get("conversationId"));
    inboxFilter = textValue(url.searchParams.get("filter"));
    inboxQuery = textValue(url.searchParams.get("q"));
    inboxSort = textValue(url.searchParams.get("sort"));
  } catch {
    // Fall through to the path-based parser for relative hrefs.
  }

  const inboxMatch = pathname?.match(/^\/inbox\/([^/]+)$/);
  const quoteMatch = pathname?.match(/^\/(?:documents|files)\/([^/]+)$/);
  const contactMatch = pathname?.match(/^\/contacts\/([^/]+)$/);
  const voiceCallMatch = pathname?.match(/^\/voice\/calls\/([^/]+)$/);

  if (inboxMatch?.[1]) {
    return {
      id: decodeURIComponent(inboxMatch[1]),
      type: "conversation" as const,
    };
  }

  if (pathname === "/inbox" && conversationIdFromQuery) {
    return {
      id: conversationIdFromQuery,
      type: "conversation" as const,
    };
  }

  if (pathname === "/inbox") {
    const filter = normalizeInboxPreviewFilter(inboxFilter);

    return {
      filter,
      query: inboxQuery,
      sort: inboxSort
        ? normalizeInboxPreviewSort(inboxSort)
        : filter === "live_queue"
          ? "action"
          : "recent",
      type: "inbox_queue" as const,
    };
  }

  if (quoteMatch?.[1]) {
    return {
      id: decodeURIComponent(quoteMatch[1]),
      type: "quote" as const,
    };
  }

  if (contactMatch?.[1]) {
    return {
      id: decodeURIComponent(contactMatch[1]),
      type: "contact" as const,
    };
  }

  if (pathname === "/contacts" && contactIdFromQuery) {
    return {
      id: contactIdFromQuery,
      type: "contact" as const,
    };
  }

  if (voiceCallMatch?.[1]) {
    return {
      id: decodeURIComponent(voiceCallMatch[1]),
      type: "voice_call" as const,
    };
  }

  return null;
}

function previewTitle(
  preview: NonNullable<AssistantResourcePreviewResult["preview"]>,
) {
  if (preview.type === "conversation") {
    return (
      preview.profile.lead?.title ??
      preview.profile.contact?.name ??
      preview.profile.contact?.company ??
      "Inquiry"
    );
  }

  if (preview.type === "quote") {
    return preview.profile.quoteDraft.title;
  }

  if (preview.type === "inbox_queue") {
    return preview.title;
  }

  if (preview.type === "voice_call") {
    return preview.profile.contact?.name
      ? `Call with ${preview.profile.contact.name}`
      : preview.profile.call.purpose === "voicemail_overflow"
        ? "Voicemail overflow"
        : preview.profile.call.direction === "outbound"
          ? "Outbound phone call"
          : "Inbound phone call";
  }

  return (
    preview.profile.contact.name ?? preview.profile.contact.company ?? "Contact"
  );
}

async function loadAssistantResourcePreview(
  href: string,
): Promise<AssistantResourcePreviewResult> {
  const target = assistantPreviewTarget(href);

  if (!target) {
    return {
      error: "That Assistant card does not have an inline preview yet.",
    };
  }

  const { supabase, workspace } = await requireWorkspaceContext();

  if (target.type === "conversation") {
    const profile = await getConversationReview(
      supabase,
      workspace.id,
      target.id,
    );

    if (!profile) {
      return { error: "That inquiry could not be found." };
    }

    const preview = {
      href,
      profile,
      title:
        profile.lead?.title ??
        profile.contact?.name ??
        profile.contact?.company ??
        "Inquiry",
      type: "conversation" as const,
    };
    const refreshedConversation = (
      await getConversationList(supabase, workspace.id, { ids: [target.id] })
    )[0];

    return {
      preview: {
        ...preview,
        title: previewTitle(preview),
      },
      refreshedLink: refreshedConversation
        ? conversationToAssistantLink(refreshedConversation)
        : undefined,
    };
  }

  if (target.type === "inbox_queue") {
    const conversations = await getConversationList(supabase, workspace.id, {
      limit: 100,
    });
    const searchedConversations = target.query
      ? conversations.filter((conversation) =>
          inboxPreviewSearchText(conversation).includes(
            target.query!.toLowerCase(),
          ),
        )
      : conversations;
    const filteredConversations = filterInboxPreviewConversations(
      searchedConversations,
      target.filter,
    );
    const preview = {
      href,
      profile: {
        conversations: sortInboxPreviewConversations(
          filteredConversations,
          target.sort,
        ).slice(0, 10),
        filter: target.filter,
        matchedCount: filteredConversations.length,
        query: target.query,
        sort: target.sort,
        totalCount: conversations.length,
      },
      title: inboxPreviewTitle(target.filter),
      type: "inbox_queue" as const,
    };

    return {
      preview: {
        ...preview,
        title: previewTitle(preview),
      },
    };
  }

  if (target.type === "quote") {
    const profile = await getQuoteDraftProfile(
      supabase,
      workspace.id,
      target.id,
    );

    if (!profile) {
      return { error: "That quote draft could not be found." };
    }

    const preview = {
      href,
      profile,
      title: profile.quoteDraft.title,
      type: "quote" as const,
    };

    return {
      preview: {
        ...preview,
        title: previewTitle(preview),
      },
    };
  }

  if (target.type === "voice_call") {
    const profile = await getVoiceCallPreview(
      supabase,
      workspace.id,
      target.id,
    );

    if (!profile) {
      return { error: "That phone call could not be found." };
    }

    const preview = {
      href,
      profile,
      title:
        profile.contact?.name ??
        profile.contact?.company ??
        (profile.call.purpose === "voicemail_overflow"
          ? "Voicemail overflow"
          : profile.call.direction === "outbound"
            ? "Outbound phone call"
            : "Inbound phone call"),
      type: "voice_call" as const,
    };

    return {
      preview: {
        ...preview,
        title: previewTitle(preview),
      },
    };
  }

  const profile = await getContactProfile(supabase, workspace.id, target.id);

  if (!profile) {
    return { error: "That contact could not be found." };
  }

  const preview = {
    href,
    profile,
    title: profile.contact.name ?? profile.contact.company ?? "Contact",
    type: "contact" as const,
  };

  return {
    preview: {
      ...preview,
      title: previewTitle(preview),
    },
  };
}

export async function getAssistantResourcePreviewAction(
  href: string,
): Promise<AssistantResourcePreviewResult> {
  try {
    return await loadAssistantResourcePreview(href);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to load the Assistant preview.",
    };
  }
}

export async function runAssistantResourceActionAction({
  actionId,
  href,
  operation,
}: {
  actionId: string;
  href: string;
  operation: "approve" | "approve_execute" | "execute";
}): Promise<AssistantResourcePreviewResult> {
  try {
    const { supabase, user } = await requireWorkspaceContext();

    if (operation === "approve") {
      await approveAction(supabase, user, actionId);
    } else if (operation === "approve_execute") {
      await approveAction(supabase, user, actionId);
      await executeAction(supabase, user, actionId);
    } else {
      await executeAction(supabase, user, actionId);
    }

    revalidatePath("/");
    revalidatePath("/assistant");
    revalidatePath("/inbox");
    revalidatePath(href);

    return loadAssistantResourcePreview(href);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to update the Assistant preview.",
    };
  }
}

export async function updateAssistantDraftReplyAction({
  actionId,
  body,
  href,
  subject,
}: {
  actionId: string;
  body: string;
  href: string;
  subject: string;
}): Promise<AssistantResourcePreviewResult> {
  try {
    const target = assistantPreviewTarget(href);

    if (target?.type !== "conversation") {
      return {
        error: "Draft replies can only be edited from an inquiry preview.",
      };
    }

    const cleanSubject = subject.trim() || "Thanks for reaching out";
    const cleanBody = body.trim();

    if (!cleanBody) {
      return { error: "Reply body is required." };
    }

    const { supabase, user, workspace } = await requireWorkspaceContext();
    const { data: action, error: loadError } = await supabase
      .from("actions")
      .select("id,type,status,input,target_type,target_id")
      .eq("workspace_id", workspace.id)
      .eq("id", actionId)
      .maybeSingle();

    if (loadError) {
      throw new Error(loadError.message);
    }

    if (!action) {
      return { error: "Draft reply action was not found." };
    }

    if (
      String(action.type) !== "draft_reply" ||
      String(action.target_type) !== "conversation" ||
      String(action.target_id) !== target.id
    ) {
      return { error: "That action is not a draft reply for this inquiry." };
    }

    if (String(action.status) !== "pending_approval") {
      return { error: "Only pending draft replies can be edited." };
    }

    const before = objectRecord(action.input);
    const subjectChanged =
      (textValue(before.subject) ?? "Thanks for reaching out") !== cleanSubject;
    const bodyChanged = (textValue(before.body) ?? "") !== cleanBody;
    const userEditedDraft =
      Boolean(before.userEditedDraft) ||
      Boolean(before.editedByUserId) ||
      subjectChanged ||
      bodyChanged;
    const after = {
      ...before,
      body: cleanBody,
      dryRun: true,
      subject: cleanSubject,
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
      .update({ input: after })
      .eq("workspace_id", workspace.id)
      .eq("id", actionId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "draft_reply.updated",
      entityType: "action",
      entityId: actionId,
      before: { input: before },
      after: {
        input: after,
      },
      metadata: {
        source: "assistant.preview",
      },
    });

    revalidatePath("/assistant");
    revalidatePath("/inbox");
    revalidatePath(href);

    return loadAssistantResourcePreview(href);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the draft reply.",
    };
  }
}

export async function sendAssistantManualReplyAction({
  body,
  channelType,
  href,
  subject,
}: {
  body: string;
  channelType: string;
  href: string;
  subject: string;
}): Promise<AssistantResourcePreviewResult> {
  try {
    const target = assistantPreviewTarget(href);

    if (target?.type !== "conversation") {
      return {
        error: "Manual replies can only be sent from an inquiry preview.",
      };
    }

    const cleanBody = body.trim();

    if (!cleanBody) {
      return { error: "Reply body is required." };
    }

    if (!isOutboundChannel(channelType)) {
      return { error: "Outbound channel is invalid." };
    }

    const { supabase, user, workspace } = await requireWorkspaceContext();
    const settings = await getCommunicationSettings(supabase, workspace.id);

    if (!settings.allowedChannels.includes(channelType)) {
      return {
        error: `${channelType.toUpperCase()} is disabled in communication settings.`,
      };
    }

    const signature = selectEmailSignature(settings, "manual");
    const signedBody = buildSignedEmailBody({
      body: cleanBody,
      signature,
    });
    const settingsSnapshot = {
      approvalRequired: settings.approvalRequired,
      allowedChannels: settings.allowedChannels,
      defaultTone: settings.defaultTone,
      gmailExternalSendEnabled: channelType === "email",
      signatureApplied: signedBody.signatureApplied,
      signatureVariant: "manual",
      userInitiatedFromAssistant: true,
    };

    const outboundResult = await recordOutboundMessage(supabase, {
      workspaceId: workspace.id,
      userId: user.id,
      conversationId: target.id,
      channelType,
      subject: textValue(subject),
      body: signedBody.bodyText,
      htmlBody: signedBody.htmlBody,
      attachments: signedBody.inlineAttachments,
      source: "assistant.manual_reply",
      settingsSnapshot,
    });

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
        channelType: outboundResult.channelType,
        conversationId: outboundResult.conversationId,
        direction: "outbound",
        dryRun: outboundResult.dryRun,
        externalMessageId: outboundResult.externalMessageId,
        externalSend: outboundResult.externalSend,
        sentTo: outboundResult.sentTo,
        subject: outboundResult.subject,
      },
      metadata: {
        requestedByUserId: user.id,
        source: "assistant.manual_reply",
      },
    });

    revalidatePath("/");
    revalidatePath("/assistant");
    revalidatePath("/inbox");
    revalidatePath(href);

    return loadAssistantResourcePreview(href);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to send this manual reply.",
    };
  }
}

export async function startAssistantOutboundCallAction({
  contactId,
  contextSummary,
  conversationId,
  instructions,
  leadId,
  phoneNumber,
  threadId,
}: {
  contactId?: string | null;
  contextSummary?: string | null;
  conversationId?: string | null;
  instructions?: string | null;
  leadId?: string | null;
  phoneNumber: string;
  threadId?: string | null;
}) {
  try {
    const { supabase, user, workspace } = await requireWorkspaceContext();
    const result = await createOutboundVoiceCall({
      contactId: textValue(contactId),
      contextSummary: textValue(contextSummary),
      conversationId: textValue(conversationId),
      instructions: textValue(instructions),
      leadId: textValue(leadId),
      phoneNumber,
      supabase,
      threadId: textValue(threadId),
      user,
      workspaceId: workspace.id,
    });

    revalidatePath("/");
    revalidatePath("/activity");
    revalidatePath("/assistant");
    revalidatePath("/dashboard");
    revalidatePath("/voice");

    return {
      ok: true as const,
      ...result,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to start the call.",
      ok: false as const,
    };
  }
}

export async function sendAssistantMessageAction(
  previousState: AssistantThreadState,
  formData: FormData,
): Promise<AssistantThreadState> {
  const submittedPrompt = formString(formData, "prompt");
  const inputSource =
    formString(formData, "inputSource") === "voice" ? "voice" : "typed";
  const submittedThreadId = formString(formData, "threadId");

  if (!submittedPrompt) {
    return {
      error: "Ask Kyro something first.",
      messages: previousState.messages,
      summary: previousState.summary,
      threadId: previousState.threadId,
      threads: previousState.threads,
    };
  }

  try {
    const { supabase, user, workspace } = await requireWorkspaceContext();
    const storedAttachments = await storeAssistantAttachmentsFromFormData({
      formData,
      supabase,
      user,
      workspaceId: workspace.id,
    });
    const prompt = appendStoredAttachmentContext(
      submittedPrompt,
      storedAttachments,
    );
    const existingThreadId = submittedThreadId || previousState.threadId;
    const thread = existingThreadId
      ? { id: existingThreadId, summary: previousState.summary }
      : await getOrCreateAssistantThread(supabase, workspace, user);
    const threadId = String(thread.id);
    const userMessageId = await appendUserAssistantMessage({
      content: prompt,
      inputSource,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const context = await getAssistantTurnContext({
      prompt,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const assistantMessage = await runAssistantTurn({
      contextSnapshots: context.contextSnapshots,
      memories: context.memories,
      inputSource,
      prompt,
      recentMessages: context.recentMessages,
      supabase,
      threadId,
      threadSummary: context.summary,
      user,
      workspace,
    });

    if (
      assistantMessage.fallbackReason &&
      primaryAssistantModelRequired(assistantMessage.intent)
    ) {
      revalidatePath("/");
      revalidatePath("/assistant");

      return {
        ...(await getAssistantThreadState({
          supabase,
          threadId,
          user,
          workspace,
        })),
        error:
          "Kyro is having trouble reaching the main assistant model right now. This request needs the full assistant, so I have held off rather than guessing. Please try again shortly.",
      };
    }

    const memorySaved = await maybeSaveAssistantMemory({
      prompt,
      sourceMessageId: userMessageId,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const memorySuggestion = memorySaved
      ? null
      : await maybeSuggestAssistantMemory({
          prompt,
          sourceMessageId: userMessageId,
          supabase,
          threadId,
          user,
          workspaceId: workspace.id,
        });

    await appendAssistantTurnMessage({
      memorySaved,
      memorySuggestion,
      result: assistantMessage,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    await updateAssistantThreadSummary({
      prompt,
      result: assistantMessage,
      supabase,
      threadId,
      workspaceId: workspace.id,
    });
    await maybeCompactAssistantThreadContext({
      supabase,
      threadId,
      userId: user.id,
      workspaceId: workspace.id,
    });

    revalidatePath("/");
    revalidatePath("/assistant");
    revalidatePath("/voice");
    revalidatePath("/files");
    revalidatePath("/documents");
    revalidatePath("/inbox");

    return getAssistantThreadState({
      supabase,
      threadId,
      user,
      workspace,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to run the assistant.",
      messages: previousState.messages,
      summary: previousState.summary,
      threadId: previousState.threadId,
      threads: previousState.threads,
    };
  }
}

export async function updateAssistantMemorySuggestionAction({
  memoryId,
  status,
}: {
  memoryId: string;
  status: "active" | "rejected";
}) {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const result = await setAssistantMemorySuggestionStatus({
    memoryId,
    status,
    supabase,
    user,
    workspaceId: workspace.id,
  });

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action:
      status === "active"
        ? "assistant_memory.approved"
        : "assistant_memory.rejected",
    actorId: user.id,
    actorType: "user",
    after: {
      content: result.content,
      status: result.status,
    },
    entityId: memoryId,
    entityType: "assistant_memory",
    metadata: {
      source: "assistant.memory_suggestion",
    },
  });

  revalidatePath("/assistant");

  return result;
}

export async function createAssistantThreadAction() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const threadId = await createAssistantThread({ supabase, user, workspace });

  revalidatePath("/assistant");
  redirect(`/assistant?threadId=${encodeURIComponent(threadId)}`);
}

export async function archiveAssistantThreadAction(formData: FormData) {
  const threadId = formString(formData, "threadId");

  if (!threadId) {
    redirect("/assistant");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  await archiveAssistantThread({
    supabase,
    threadId,
    user,
    workspaceId: workspace.id,
  });

  revalidatePath("/assistant");
  redirect("/assistant");
}
