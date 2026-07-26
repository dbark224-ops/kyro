import type { ConversationListItem } from "../crm/queries";
import { normalized } from "./prompt-text";
import type { AssistantLink, AssistantRecentMessage } from "./types";

const LIVE_WORK_QUEUE_BUCKETS = [
  "needs_reply",
  "missing_info",
  "follow_up_due",
  "ready_to_quote",
  "site_visit_needed",
  "needs_review",
];

export function isConversationInLiveWorkQueue(
  conversation: Pick<ConversationListItem, "workflowBucket">,
) {
  return LIVE_WORK_QUEUE_BUCKETS.includes(conversation.workflowBucket);
}

export function conversationToAssistantLink(
  conversation: Pick<
    ConversationListItem,
    "contactName" | "id" | "leadTitle" | "nextActionLabel" | "workflowBucket"
  >,
): AssistantLink {
  return {
    href: `/inbox/${conversation.id}`,
    label: conversation.contactName ?? conversation.leadTitle ?? "Open inquiry",
    meta: conversation.nextActionLabel,
    refresh: {
      kind: "conversation",
      liveWorkQueueVisible: isConversationInLiveWorkQueue(conversation),
      workflowBucket: conversation.workflowBucket,
    },
  };
}

export function conversationIdFromHref(href: string) {
  try {
    const url = new URL(href, "https://kyro.local");

    if (url.pathname.startsWith("/inbox/")) {
      const id = url.pathname.split("/").filter(Boolean)[1];

      return id || null;
    }

    return url.searchParams.get("conversationId");
  } catch {
    const match = href.match(/^\/inbox\/([^/?#]+)/);

    return match?.[1] ?? null;
  }
}

export function recentWorkQueueConversationIds(
  recentMessages: readonly AssistantRecentMessage[] = [],
  options: { maxAgeMs?: number } = {},
) {
  const ids: string[] = [];
  const now = Date.now();

  for (const message of [...recentMessages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }

    if (options.maxAgeMs && message.createdAt) {
      const createdAt = new Date(message.createdAt).getTime();

      if (
        Number.isFinite(createdAt) &&
        Math.max(0, now - createdAt) > options.maxAgeMs
      ) {
        continue;
      }
    }

    const hasWorkQueueIntent =
      message.intent === "work_queue" ||
      message.intent === "inquiry_owner_question";
    const hasWorkQueueBlock = (message.uiBlocks ?? []).some((block) => {
      if (block.type === "approval_queue") {
        return true;
      }

      if (block.type !== "summary_cards") {
        return false;
      }

      return /\b(queue|work|approval|reply|inbox)\b/i.test(block.title);
    });

    if (!hasWorkQueueIntent && !hasWorkQueueBlock) {
      continue;
    }

    for (const link of message.links ?? []) {
      const conversationId = conversationIdFromHref(link.href);

      if (conversationId && !ids.includes(conversationId)) {
        ids.push(conversationId);
      }
    }

    for (const block of message.uiBlocks ?? []) {
      if (block.type !== "approval_queue") {
        continue;
      }

      for (const item of block.items) {
        const conversationId = item.href
          ? conversationIdFromHref(item.href)
          : null;

        if (conversationId && !ids.includes(conversationId)) {
          ids.push(conversationId);
        }
      }
    }

    if (ids.length > 0) {
      break;
    }
  }

  return ids;
}

export function conversationDisplayName(conversation: ConversationListItem) {
  return conversation.contactName ?? conversation.leadTitle ?? "this inquiry";
}

export function conversationJobLabel(conversation: ConversationListItem) {
  const candidates = [
    conversation.inquiryFacts?.jobType,
    conversation.leadServiceType,
    conversation.leadTitle,
  ];

  return (
    candidates.find(
      (candidate) => candidate && !isGenericInquiryLabel(candidate),
    ) ?? "General inquiry"
  );
}

export function isGenericInquiryLabel(value: string) {
  const label = normalized(value);

  return (
    label.startsWith("new inquiry from ") ||
    label.startsWith("new enquiry from ") ||
    label.startsWith("quote inquiry from ") ||
    label.startsWith("quote enquiry from ") ||
    label === "manual inbound" ||
    label === "manual inbound enquiry"
  );
}
