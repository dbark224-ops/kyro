import { getAssistantRouteMetrics } from "../../../../lib/assistant/route-metrics";
import { getConversationList } from "../../../../lib/crm/queries";
import {
  getContactList,
  getConversationWorkflowCounts,
} from "../../../../lib/crm/queries";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";
import { getPaymentsOverviewData } from "../../../../lib/payments/queries";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function contactLabel(contact: Awaited<ReturnType<typeof getContactList>>[number]) {
  return (
    contact.name ??
    contact.company ??
    contact.email ??
    contact.phone ??
    "Unnamed contact"
  );
}

function contactSublabel(
  contact: Awaited<ReturnType<typeof getContactList>>[number],
) {
  return (
    contact.company ??
    contact.email ??
    contact.phone ??
    (contact.contactType
      ? contact.contactType
          .split(/[_-]+/g)
          .filter(Boolean)
          .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
          .join(" ")
      : null)
  );
}

function conversationTitle(
  conversation: Awaited<ReturnType<typeof getConversationList>>[number],
) {
  return (
    conversation.contactName ??
    conversation.leadTitle ??
    conversation.latestSubject ??
    conversation.latestBody ??
    "Conversation"
  );
}

function conversationPreview(
  conversation: Awaited<ReturnType<typeof getConversationList>>[number],
) {
  return (
    conversation.latestBody ??
    conversation.originalInquiryBody ??
    conversation.latestSubject ??
    null
  );
}

function quoteApprovedOrBookedCount(
  conversations: Awaited<ReturnType<typeof getConversationList>>,
) {
  return conversations.filter((conversation) => {
    if (conversation.approvedActionCount > 0) {
      return true;
    }

    return conversation.completedActionTypes.some((type) =>
      ["book_site_visit", "schedule_job", "mark_job_booked"].includes(type),
    );
  }).length;
}

async function getMobileActivity(supabase: unknown, workspaceId: string) {
  const client = supabase as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (
            column: string,
            options: { ascending: boolean },
          ) => { limit: (count: number) => Promise<{ data: unknown[] | null }> };
        };
      };
    };
  };
  const { data } = await client
    .from("messages")
    .select("id,conversation_id,created_at,direction,subject,body_text")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(12);

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const direction = textValue(record.direction) === "outbound" ? "outbound" : "inbound";
    const id = textValue(record.id) ?? `${direction}:${Math.random()}`;
    const conversationId = textValue(record.conversation_id);

    return {
      at: textValue(record.created_at) ?? new Date().toISOString(),
      href: conversationId
        ? `/inbox?conversationId=${encodeURIComponent(conversationId)}`
        : null,
      id: `message:${id}`,
      meta: direction === "outbound" ? "Outbound" : "Inbound",
      preview:
        textValue(record.body_text)?.replace(/\s+/g, " ").slice(0, 180) ??
        "No message body recorded",
      subject: textValue(record.subject),
      title: direction === "outbound" ? "Outbound message" : "Inbound message",
      tone: direction,
    };
  });
}

export async function GET(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const [
      metrics,
      workflowCounts,
      conversations,
      contacts,
      activity,
      paymentsOverview,
    ] = await Promise.all([
      getAssistantRouteMetrics(supabase, workspace.id),
      getConversationWorkflowCounts(supabase, workspace.id),
      getConversationList(supabase, workspace.id, { limit: 36 }),
      getContactList(supabase, workspace.id),
      getMobileActivity(supabase, workspace.id).catch(() => []),
      getPaymentsOverviewData(supabase, workspace.id).catch(() => null),
    ]);
    const quoteApprovedOrBooked = quoteApprovedOrBookedCount(conversations);
    const paymentStats = paymentsOverview?.stats ?? {
      currency: "AUD",
      overdueAmountCents: 0,
      overdueCount: 0,
      outstandingAmountCents: 0,
      outstandingCount: 0,
      paidThisMonthCents: 0,
      paidThisWeekCents: 0,
      totalPaidCents: 0,
    };
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

    return Response.json({
      commandCenter: {
        activity,
        generatedDocuments: [],
        payments: {
          currency: paymentStats.currency,
          overdueAmountCents: paymentStats.overdueAmountCents,
          overdueCount: paymentStats.overdueCount,
          outstandingAmountCents: paymentStats.outstandingAmountCents,
          outstandingCount: paymentStats.outstandingCount,
          paidThisMonthCents: paymentStats.paidThisMonthCents,
          paidThisWeekCents: paymentStats.paidThisWeekCents,
        },
        stats: {
          awaitingCustomer: workflowCounts.awaitingCustomer,
          contactsIndexed: metrics.contactCount,
          followUpDue: conversations.filter((conversation) =>
            conversation.workflowBucket === "awaiting_customer" ||
            conversation.completedActionTypes.includes("schedule_follow_up"),
          ).length,
          missingInfo: workflowCounts.missingInfo,
          needsReply: workflowCounts.needsReply,
          openConversations: workflowCounts.open,
          quoteApprovedOrBooked,
          readyToQuote: workflowCounts.readyToQuote,
          readyToSend: metrics.readyQuotes,
          totalConversations: workflowCounts.total,
        },
        suppliers,
        topContacts,
        workQueue,
        workspace,
      },
      metrics,
      queue: conversations.slice(0, 3),
      user: {
        email: user.email ?? null,
        id: user.id,
      },
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
