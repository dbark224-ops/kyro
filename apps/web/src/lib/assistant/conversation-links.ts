import type { ConversationListItem } from "../crm/queries";
import type { AssistantLink } from "./types";

const LIVE_WORK_QUEUE_BUCKETS = [
  "needs_reply",
  "missing_info",
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
