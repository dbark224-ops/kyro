import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatLeadTitle,
  formatServiceType,
  titleCaseBusinessText,
} from "../crm/display";
import { getConversationList, type ConversationListItem } from "../crm/queries";

export type AppNotificationItem = {
  id: string;
  source: "inbox";
  title: string;
  detail: string;
  href: string;
  timestamp: string | null;
};

export type AppNotificationSummary = {
  total: number;
  inboxActionCount: number;
  items: AppNotificationItem[];
};

export const EMPTY_NOTIFICATION_SUMMARY: AppNotificationSummary = {
  inboxActionCount: 0,
  items: [],
  total: 0,
};

const ACTIONABLE_INBOX_BUCKETS = new Set([
  "needs_reply",
  "missing_info",
  "needs_review",
  "needs_approval",
  "follow_up_due",
  "ready_to_quote",
  "site_visit_needed",
]);

type NotificationConversation = Pick<
  ConversationListItem,
  | "contactName"
  | "followUpIsDue"
  | "id"
  | "lastMessageAt"
  | "latestSubject"
  | "leadServiceType"
  | "leadTitle"
  | "nextActionLabel"
  | "originalInquiryAt"
  | "pendingApprovalCount"
  | "status"
  | "workflowBucket"
>;

export function isInboxAttentionConversation(
  conversation: NotificationConversation,
) {
  if (conversation.status === "resolved" || conversation.status === "replied") {
    return false;
  }

  if (
    conversation.workflowBucket === "resolved" ||
    conversation.workflowBucket === "awaiting_customer" ||
    conversation.workflowBucket === "open"
  ) {
    return false;
  }

  return (
    conversation.pendingApprovalCount > 0 ||
    conversation.followUpIsDue ||
    ACTIONABLE_INBOX_BUCKETS.has(conversation.workflowBucket)
  );
}

function dateValue(value: string | null) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function notificationTitle(conversation: NotificationConversation) {
  return (
    formatLeadTitle(conversation.leadTitle, conversation.contactName) ??
    formatLeadTitle(conversation.latestSubject, conversation.contactName) ??
    titleCaseBusinessText(conversation.contactName) ??
    "Inbox item"
  );
}

function notificationDetail(conversation: NotificationConversation) {
  const service = formatServiceType(conversation.leadServiceType);
  const status =
    conversation.pendingApprovalCount > 0
      ? conversation.pendingApprovalCount === 1
        ? "1 approval needed"
        : `${conversation.pendingApprovalCount} approvals needed`
      : conversation.nextActionLabel;

  return [status, service].filter(Boolean).join(" - ");
}

export async function getNotificationSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  options: { limit?: number } = {},
): Promise<AppNotificationSummary> {
  const limit = options.limit ?? 8;
  const conversations = await getConversationList(supabase, workspaceId);
  const attentionConversations = conversations
    .filter(isInboxAttentionConversation)
    .sort(
      (left, right) =>
        dateValue(right.lastMessageAt ?? right.originalInquiryAt) -
        dateValue(left.lastMessageAt ?? left.originalInquiryAt),
    );

  return {
    inboxActionCount: attentionConversations.length,
    items: attentionConversations.slice(0, limit).map((conversation) => ({
      detail: notificationDetail(conversation),
      href: `/inbox?conversationId=${encodeURIComponent(conversation.id)}`,
      id: conversation.id,
      source: "inbox",
      timestamp: conversation.lastMessageAt ?? conversation.originalInquiryAt,
      title: notificationTitle(conversation),
    })),
    total: attentionConversations.length,
  };
}
