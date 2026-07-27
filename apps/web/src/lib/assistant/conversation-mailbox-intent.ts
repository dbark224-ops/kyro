import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getConversationList } from "../crm/queries";
import { insertAuditLog } from "../engine/event-action-audit";
import { writeOrThrow } from "../supabase/write";
import type { AssistantCommandResult, AssistantRecentMessage } from "./types";
import { recentWorkQueueConversationIds } from "./conversation-links";
import { recentInquiryConversationForPrompt } from "./inquiry-intent";
import { rowLink } from "./ui-blocks";

/**
 * Deleting and restoring a conversation from the assistant.
 *
 * Asked over SMS to delete a message it had just listed, Kyro dropped it from
 * its own reply and moved on -- which reads exactly like it was deleted, while
 * the inbox was untouched. There was no tool for it, and the more useful half
 * of that story is that the user had no way to know.
 *
 * This mirrors the delete button in the inbox exactly: a soft delete setting
 * `deleted_at`, reversible, audited. Nothing is destroyed, which is what makes
 * it reasonable to hand to the assistant at all -- a mistaken delete over SMS
 * costs one "put that back", not a lost customer thread.
 */
type MailboxCommandInput = {
  prompt: string;
  recentMessages?: AssistantRecentMessage[];
  supabase: SupabaseClient;
  user: User;
  workspace: { id: string };
};

const RECENT_MENTION_WINDOW_MS = 60 * 60 * 1000;

function conversationLabel(conversation: {
  contactName: string | null;
  leadTitle: string | null;
}) {
  return conversation.leadTitle ?? conversation.contactName ?? "that conversation";
}

/**
 * Which conversation the user means.
 *
 * "delete that one" after Kyro has just read out a list is the normal case, so
 * the conversations Kyro mentioned recently are the candidate set, most recent
 * first. A name in the prompt narrows it; two names matching is reported as
 * ambiguous rather than guessed at, because deleting the wrong thread is a
 * worse outcome than one more question.
 */
async function resolveTargetConversation({
  mailbox,
  prompt,
  recentMessages,
  supabase,
  workspaceId,
}: {
  mailbox: "all" | "inbox";
  prompt: string;
  recentMessages?: AssistantRecentMessage[];
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const mentionedIds = recentWorkQueueConversationIds(recentMessages ?? [], {
    maxAgeMs: RECENT_MENTION_WINDOW_MS,
  });

  if (mentionedIds.length === 0) {
    return { ambiguous: false, conversation: null, mentioned: false };
  }

  const conversations = await getConversationList(supabase, workspaceId, {
    ids: mentionedIds,
    mailbox,
  });
  const resolved = recentInquiryConversationForPrompt({
    conversationIds: mentionedIds,
    conversations,
    prompt,
  });

  if (resolved.ambiguous) {
    return {
      ambiguous: true,
      candidates: conversations.filter((conversation) =>
        resolved.matches.includes(conversation.id),
      ),
      conversation: null,
      mentioned: true,
    };
  }

  return {
    ambiguous: false,
    conversation:
      conversations.find(
        (conversation) => conversation.id === resolved.conversationId,
      ) ?? null,
    mentioned: true,
  };
}

function needsATarget(
  intent: string,
  mentioned: boolean,
  verb: string,
): AssistantCommandResult {
  return {
    context: {
      changed: false,
      reason: mentioned
        ? "The conversation could not be matched from the recent messages."
        : "No conversation was mentioned recently, so there is nothing to act on.",
    },
    fallbackAnswer: `Tell me which conversation to ${verb} -- the customer name or the job -- and I will ${verb} it.`,
    intent,
    links: [rowLink("Inbox", "/inbox", "Open inbox")],
    title: "Which conversation?",
  };
}

function ambiguous(
  intent: string,
  verb: string,
  candidates: Array<{ contactName: string | null; leadTitle: string | null }>,
): AssistantCommandResult {
  const names = candidates.map(conversationLabel);

  return {
    context: { candidates: names, changed: false, reason: "ambiguous" },
    fallbackAnswer: `More than one of those matches: ${names.join(
      ", ",
    )}. Which one should I ${verb}?`,
    intent,
    links: [rowLink("Inbox", "/inbox", "Open inbox")],
    title: "Which one?",
  };
}

export async function deleteConversationCommand({
  prompt,
  recentMessages,
  supabase,
  user,
  workspace,
}: MailboxCommandInput): Promise<AssistantCommandResult> {
  const target = await resolveTargetConversation({
    mailbox: "inbox",
    prompt,
    recentMessages,
    supabase,
    workspaceId: workspace.id,
  });

  if (target.ambiguous) {
    return ambiguous("conversation_delete", "delete", target.candidates ?? []);
  }

  if (!target.conversation) {
    return needsATarget("conversation_delete", target.mentioned, "delete");
  }

  const conversation = target.conversation;
  const label = conversationLabel(conversation);

  if (conversation.deletedAt) {
    return {
      context: { alreadyDeleted: true, changed: false, label },
      fallbackAnswer: `${label} is already in Deleted.`,
      intent: "conversation_delete",
      links: [rowLink(label, "/inbox?mailbox=deleted", "Open Deleted")],
      title: "Already deleted",
    };
  }

  const deletedAt = new Date().toISOString();

  await writeOrThrow(
    supabase
      .from("conversations")
      .update({ deleted_at: deletedAt })
      .eq("workspace_id", workspace.id)
      .eq("id", conversation.id),
    "Unable to move the conversation to Deleted",
  );

  await insertAuditLog(supabase, {
    action: "conversation.moved_to_deleted",
    actorId: user.id,
    actorType: "ai",
    after: { deletedAt },
    before: { deletedAt: null },
    entityId: conversation.id,
    entityType: "conversation",
    metadata: { source: "assistant", instruction: prompt },
    workspaceId: workspace.id,
  });

  return {
    context: {
      changed: true,
      conversationId: conversation.id,
      deletedAt,
      label,
      reversible:
        "Soft delete. It sits in the Deleted mailbox and can be restored.",
    },
    fallbackAnswer: `Moved ${label} to Deleted. Say the word if you want it back.`,
    intent: "conversation_delete",
    links: [rowLink(label, "/inbox?mailbox=deleted", "Open Deleted")],
    mutation: {
      entityId: conversation.id,
      entityType: "conversation",
      label: `Moved ${label} to Deleted`,
    },
    title: "Moved to Deleted",
  };
}

export async function restoreConversationCommand({
  prompt,
  recentMessages,
  supabase,
  user,
  workspace,
}: MailboxCommandInput): Promise<AssistantCommandResult> {
  const target = await resolveTargetConversation({
    mailbox: "all",
    prompt,
    recentMessages,
    supabase,
    workspaceId: workspace.id,
  });

  if (target.ambiguous) {
    return ambiguous("conversation_restore", "restore", target.candidates ?? []);
  }

  if (!target.conversation) {
    return needsATarget("conversation_restore", target.mentioned, "restore");
  }

  const conversation = target.conversation;
  const label = conversationLabel(conversation);

  if (!conversation.deletedAt) {
    return {
      context: { changed: false, label, notDeleted: true },
      fallbackAnswer: `${label} is already in the inbox -- it was never deleted.`,
      intent: "conversation_restore",
      links: [rowLink(label, "/inbox", "Open inbox")],
      title: "Already in the inbox",
    };
  }

  await writeOrThrow(
    supabase
      .from("conversations")
      .update({ deleted_at: null })
      .eq("workspace_id", workspace.id)
      .eq("id", conversation.id),
    "Unable to restore the conversation",
  );

  await insertAuditLog(supabase, {
    action: "conversation.restored",
    actorId: user.id,
    actorType: "ai",
    after: { deletedAt: null },
    before: { deletedAt: conversation.deletedAt },
    entityId: conversation.id,
    entityType: "conversation",
    metadata: { source: "assistant", instruction: prompt },
    workspaceId: workspace.id,
  });

  return {
    context: { changed: true, conversationId: conversation.id, label },
    fallbackAnswer: `Put ${label} back in the inbox.`,
    intent: "conversation_restore",
    links: [rowLink(label, "/inbox", "Open inbox")],
    mutation: {
      entityId: conversation.id,
      entityType: "conversation",
      label: `Restored ${label}`,
    },
    title: "Restored",
  };
}
