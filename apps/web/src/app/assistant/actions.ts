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
} from "../../lib/crm/queries";
import { conversationToAssistantLink } from "../../lib/assistant/conversation-links";
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
import { getVoiceCallPreview } from "../../lib/voice/calls";
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

function primaryAssistantModelRequired(intent: string | undefined) {
  if (!intent) {
    return true;
  }

  return !RELIABLE_ASSISTANT_FALLBACK_INTENTS.has(intent);
}

function assistantPreviewTarget(href: string) {
  let contactIdFromQuery: string | null = null;
  let pathname = href.split("?")[0] ?? href;

  try {
    const url = new URL(href, "http://kyro.local");
    pathname = url.pathname;
    contactIdFromQuery = textValue(url.searchParams.get("contactId"));
  } catch {
    // Fall through to the path-based parser for relative hrefs.
  }

  const inboxMatch = pathname?.match(/^\/inbox\/([^/]+)$/);
  const quoteMatch = pathname?.match(/^\/documents\/([^/]+)$/);
  const contactMatch = pathname?.match(/^\/contacts\/([^/]+)$/);
  const voiceCallMatch = pathname?.match(/^\/voice\/calls\/([^/]+)$/);

  if (inboxMatch?.[1]) {
    return {
      id: decodeURIComponent(inboxMatch[1]),
      type: "conversation" as const,
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
