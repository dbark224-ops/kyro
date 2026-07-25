import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatLeadTitle,
  formatServiceType,
  titleCaseBusinessText,
} from "../crm/display";
import { getConversationList, type ConversationListItem } from "../crm/queries";

export type AppNotificationItem = {
  id: string;
  source: "billing" | "escalation" | "inbox";
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
  const [conversations, escalationStepsResult, billingResult] =
    await Promise.all([
      getConversationList(supabase, workspaceId),
      supabase
        .from("urgent_escalation_steps")
        .select(
          "id,incident_id,status,sent_at,urgent_escalation_incidents!inner(id,title,summary,status,acknowledgement_token,occurred_at)",
        )
        .eq("workspace_id", workspaceId)
        .eq("channel", "app_notification")
        .eq("status", "sent")
        .eq("urgent_escalation_incidents.status", "open")
        .order("sent_at", { ascending: false })
        .limit(20),
      supabase
        .from("workspace_billing_access")
        .select("workspace_id,status,reason,grace_ends_at,latest_failure_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

  if (escalationStepsResult.error) {
    throw new Error(
      `Unable to load escalation notifications: ${escalationStepsResult.error.message}`,
    );
  }

  if (billingResult.error) {
    throw new Error(
      `Unable to load billing notification: ${billingResult.error.message}`,
    );
  }

  const attentionConversations = conversations
    .filter(isInboxAttentionConversation)
    .sort(
      (left, right) =>
        dateValue(right.lastMessageAt ?? right.originalInquiryAt) -
        dateValue(left.lastMessageAt ?? left.originalInquiryAt),
    );

  const inboxItems: AppNotificationItem[] = attentionConversations.map(
    (conversation) => ({
      detail: notificationDetail(conversation),
      href: `/inbox?conversationId=${encodeURIComponent(conversation.id)}`,
      id: conversation.id,
      source: "inbox",
      timestamp: conversation.lastMessageAt ?? conversation.originalInquiryAt,
      title: notificationTitle(conversation),
    }),
  );
  const escalationItems: AppNotificationItem[] = (
    escalationStepsResult.data ?? []
  ).flatMap((step) => {
    const relation = Array.isArray(step.urgent_escalation_incidents)
      ? step.urgent_escalation_incidents[0]
      : step.urgent_escalation_incidents;

    if (!relation) {
      return [];
    }

    return [
      {
        detail: String(
          relation.summary ?? "Urgent customer work needs acknowledgement.",
        ),
        href: `/api/escalations/acknowledge?token=${encodeURIComponent(String(relation.acknowledgement_token))}`,
        id: String(relation.id),
        source: "escalation" as const,
        timestamp: relation.occurred_at ? String(relation.occurred_at) : null,
        title: String(relation.title ?? "Urgent escalation"),
      },
    ];
  });
  const billingStatus = billingResult.data?.status
    ? String(billingResult.data.status)
    : null;
  const billingItems: AppNotificationItem[] =
    billingStatus === "grace" || billingStatus === "restricted"
      ? [
          {
            detail:
              billingStatus === "restricted"
                ? "Paid automation is paused until the payment method is updated."
                : "Update the payment method before the billing grace period ends.",
            href: "/settings?section=usage&panel=payment-method",
            id: `${workspaceId}:${billingStatus}`,
            source: "billing",
            timestamp: billingResult.data?.latest_failure_at
              ? String(billingResult.data.latest_failure_at)
              : null,
            title:
              billingStatus === "restricted"
                ? "Billing needs attention"
                : "Payment could not be collected",
          },
        ]
      : [];
  const items = [...billingItems, ...escalationItems, ...inboxItems]
    .sort(
      (left, right) => dateValue(right.timestamp) - dateValue(left.timestamp),
    )
    .slice(0, limit);

  return {
    inboxActionCount: attentionConversations.length,
    items,
    total:
      attentionConversations.length +
      escalationItems.length +
      billingItems.length,
  };
}
