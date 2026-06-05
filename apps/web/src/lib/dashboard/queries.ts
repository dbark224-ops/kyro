import type { AssistantExternalActivityItem } from "../assistant/external-activity";
import { getAssistantExternalActivity } from "../assistant/external-activity";
import { getAssistantRouteMetrics } from "../assistant/route-metrics";
import { getBillableUsageSummary } from "../billing/usage-summary";
import type { ContactListItem, ConversationListItem } from "../crm/queries";
import {
  getContactList,
  getConversationList,
  getConversationWorkflowCounts,
} from "../crm/queries";
import {
  getGeneratedDocumentsForWorkspace,
  type GeneratedDocumentRecord,
} from "../documents/generated-documents";
import type { WorkspaceSummary } from "../workspace/bootstrap";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardCommandCenterData = {
  activity: AssistantExternalActivityItem[];
  generatedDocuments: DashboardGeneratedDocumentItem[];
  payments: DashboardPaymentsSummary;
  stats: DashboardStats;
  suppliers: DashboardContactSummary[];
  topContacts: DashboardContactSummary[];
  workQueue: DashboardWorkQueueItem[];
  workspace: WorkspaceSummary;
};

export type DashboardGeneratedDocumentItem = {
  href: string;
  id: string;
  lifecycleStatus: string;
  title: string;
  type: string;
  updatedAt: string;
};

export type DashboardPaymentsSummary = {
  isPlaceholder: boolean;
  note: string;
  quoteApprovedOrBookedCount: number;
  readyToSendCount: number;
  usageCustomerCharge: number;
  usageCurrency: string;
};

export type DashboardStats = {
  awaitingCustomer: number;
  contactsIndexed: number;
  followUpDue: number;
  missingInfo: number;
  needsReply: number;
  openConversations: number;
  quoteApprovedOrBooked: number;
  readyToQuote: number;
  readyToSend: number;
  totalConversations: number;
};

export type DashboardContactSummary = {
  company: string | null;
  contactType: string;
  href: string;
  id: string;
  label: string;
  lastMessageAt: string | null;
  messageCount: number;
  sublabel: string | null;
};

export type DashboardWorkQueueItem = {
  href: string;
  id: string;
  lastMessageAt: string | null;
  missingInfoCount: number;
  nextActionLabel: string;
  preview: string | null;
  priority: string | null;
  status: string;
  title: string;
  workflowBucket: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function currencyValue(
  summary: Awaited<ReturnType<typeof getBillableUsageSummary>>,
) {
  return summary.totals[0]?.currency ?? "USD";
}

function customerChargeValue(
  summary: Awaited<ReturnType<typeof getBillableUsageSummary>>,
) {
  return summary.totals.reduce((total, item) => total + item.customerCharge, 0);
}

function contactLabel(contact: ContactListItem) {
  return (
    contact.name ??
    contact.company ??
    contact.email ??
    contact.phone ??
    "Unnamed contact"
  );
}

function contactSublabel(contact: ContactListItem) {
  return (
    contact.company ??
    contact.email ??
    contact.phone ??
    (contact.contactType ? formatLabel(contact.contactType) : null)
  );
}

function conversationTitle(conversation: ConversationListItem) {
  return (
    conversation.contactName ??
    conversation.leadTitle ??
    conversation.latestSubject ??
    conversation.latestBody ??
    "Conversation"
  );
}

function conversationPreview(conversation: ConversationListItem) {
  return (
    conversation.latestBody ??
    conversation.originalInquiryBody ??
    conversation.latestSubject ??
    null
  );
}

function quoteApprovedOrBookedCount(conversations: ConversationListItem[]) {
  return conversations.filter((conversation) => {
    if (conversation.approvedActionCount > 0) {
      return true;
    }

    return conversation.completedActionTypes.some((type) =>
      ["book_site_visit", "schedule_job", "mark_job_booked"].includes(type),
    );
  }).length;
}

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function generatedDocumentHref(document: GeneratedDocumentRecord) {
  if (document.quoteDraftId) {
    return `/files/${encodeURIComponent(document.quoteDraftId)}`;
  }

  if (document.fileId) {
    return `/api/files/${encodeURIComponent(document.fileId)}`;
  }

  return "/files";
}

export async function getDashboardCommandCenterData(
  supabase: SupabaseClient,
  workspace: WorkspaceSummary,
): Promise<DashboardCommandCenterData> {
  const [
    activity,
    routeMetrics,
    workflowCounts,
    conversations,
    contacts,
    generatedDocuments,
    usageSummary,
  ] = await Promise.all([
    getAssistantExternalActivity(supabase, workspace.id, 18),
    getAssistantRouteMetrics(supabase, workspace.id),
    getConversationWorkflowCounts(supabase, workspace.id),
    getConversationList(supabase, workspace.id, { limit: 36 }),
    getContactList(supabase, workspace.id),
    getGeneratedDocumentsForWorkspace(supabase, workspace.id, 12),
    getBillableUsageSummary(supabase, workspace.id, {
      period: "monthly",
    }).catch(() => null),
  ]);

  const topContacts = contacts
    .filter((contact) => contact.contactType !== "supplier")
    .sort((left, right) => {
      if (right.messageCount !== left.messageCount) {
        return right.messageCount - left.messageCount;
      }

      return (
        new Date(right.lastMessageAt ?? right.updatedAt).getTime() -
        new Date(left.lastMessageAt ?? left.updatedAt).getTime()
      );
    })
    .slice(0, 6)
    .map((contact) => ({
      company: contact.company,
      contactType: contact.contactType,
      href: `/contacts/${encodeURIComponent(contact.id)}`,
      id: contact.id,
      label: contactLabel(contact),
      lastMessageAt: contact.lastMessageAt,
      messageCount: contact.messageCount,
      sublabel: contactSublabel(contact),
    }));

  const suppliers = contacts
    .filter((contact) => contact.contactType === "supplier")
    .sort((left, right) => {
      if (right.messageCount !== left.messageCount) {
        return right.messageCount - left.messageCount;
      }

      return (
        new Date(right.lastMessageAt ?? right.updatedAt).getTime() -
        new Date(left.lastMessageAt ?? left.updatedAt).getTime()
      );
    })
    .slice(0, 6)
    .map((contact) => ({
      company: contact.company,
      contactType: contact.contactType,
      href: `/contacts/${encodeURIComponent(contact.id)}`,
      id: contact.id,
      label: contactLabel(contact),
      lastMessageAt: contact.lastMessageAt,
      messageCount: contact.messageCount,
      sublabel: contactSublabel(contact),
    }));

  const workQueue = conversations.slice(0, 8).map((conversation) => ({
    href: `/inbox?conversationId=${encodeURIComponent(conversation.id)}`,
    id: conversation.id,
    lastMessageAt: conversation.lastMessageAt,
    missingInfoCount: conversation.inquiryFacts?.missingInfo.length ?? 0,
    nextActionLabel: conversation.nextActionLabel,
    preview: conversationPreview(conversation),
    priority: conversation.leadPriority,
    status: conversation.status,
    title: conversationTitle(conversation),
    workflowBucket: conversation.workflowBucket,
  }));

  const quoteApprovedOrBooked = quoteApprovedOrBookedCount(conversations);

  return {
    activity,
    generatedDocuments: generatedDocuments.map((document) => ({
      href: generatedDocumentHref(document),
      id: document.id,
      lifecycleStatus: document.lifecycleStatus,
      title: document.title,
      type: document.documentType,
      updatedAt: document.updatedAt,
    })),
    payments: {
      isPlaceholder: true,
      note: "Customer payments will populate here once billing and collections are integrated.",
      quoteApprovedOrBookedCount: quoteApprovedOrBooked,
      readyToSendCount: routeMetrics.readyQuotes,
      usageCustomerCharge: usageSummary ? customerChargeValue(usageSummary) : 0,
      usageCurrency: usageSummary ? currencyValue(usageSummary) : "USD",
    },
    stats: {
      awaitingCustomer: workflowCounts.awaitingCustomer,
      contactsIndexed: routeMetrics.contactCount,
      followUpDue: workflowCounts.followUpDue,
      missingInfo: workflowCounts.missingInfo,
      needsReply: workflowCounts.needsReply,
      openConversations: workflowCounts.open,
      quoteApprovedOrBooked,
      readyToQuote: workflowCounts.readyToQuote,
      readyToSend: routeMetrics.readyQuotes,
      totalConversations: workflowCounts.total,
    },
    suppliers,
    topContacts,
    workQueue,
    workspace,
  };
}
