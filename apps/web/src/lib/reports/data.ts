import { getBillableUsageSummary } from "../billing/usage-summary";
import type { ContactListItem, ConversationListItem } from "../crm/queries";
import { getContactList, getConversationList } from "../crm/queries";
import { getGeneratedDocumentsForWorkspace } from "../documents/generated-documents";
import type { WorkspaceSummary } from "../workspace/bootstrap";
import { getCommunicationSettings } from "../communication/settings";
import type { SupabaseClient } from "@supabase/supabase-js";

export const REPORT_TYPES = [
  {
    value: "communications_log",
    label: "All communications",
    description: "Email, SMS, phone, and recorded CRM conversation history.",
  },
  {
    value: "inbound_communications",
    label: "Inbound communications",
    description: "Customer and supplier messages or calls into the workspace.",
  },
  {
    value: "outbound_communications",
    label: "Outbound communications",
    description: "Replies, outbound SMS, sent emails, and outbound calls.",
  },
  {
    value: "contact_communications",
    label: "Communications by contact",
    description: "A contact-specific audit trail of messages and calls.",
  },
  {
    value: "usage_ledger",
    label: "Usage ledger",
    description: "Billable AI, voice, SMS, and provider usage events.",
  },
  {
    value: "documents_activity",
    label: "Document activity",
    description: "Generated quotes, invoices, PDFs, and saved document records.",
  },
  {
    value: "work_queue_summary",
    label: "Work queue summary",
    description: "Open leads, follow-ups, missing details, and quote readiness.",
  },
  {
    value: "payment_history",
    label: "Payment history",
    description: "Reserved for customer payment reporting after payments ship.",
  },
] as const;

export const REPORT_TIMEFRAMES = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "this_year", label: "This year" },
  { value: "last_week", label: "Last week" },
  { value: "last_month", label: "Last month" },
  { value: "last_year", label: "Last year" },
  { value: "custom", label: "Custom range" },
] as const;

export const REPORT_CHANNELS = [
  { value: "all", label: "All channels" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "phone", label: "Phone" },
  { value: "crm", label: "CRM/manual" },
] as const;

export const REPORT_DIRECTIONS = [
  { value: "all", label: "All directions" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]["value"];
export type ReportTimeframe = (typeof REPORT_TIMEFRAMES)[number]["value"];
export type ReportChannel = (typeof REPORT_CHANNELS)[number]["value"];
export type ReportDirection = (typeof REPORT_DIRECTIONS)[number]["value"];

export type ReportFilters = {
  channel: ReportChannel;
  contactId: string | null;
  direction: ReportDirection;
  end: string | null;
  start: string | null;
  timeframe: ReportTimeframe;
  type: ReportType;
};

export type ReportSummaryCard = {
  detail?: string;
  label: string;
  value: string;
};

export type ReportSection = {
  columns: string[];
  description?: string;
  emptyText?: string;
  rows: string[][];
  title: string;
};

export type ReportBusiness = {
  logoContentBase64: string | null;
  logoContentType: string | null;
  logoDataUrl: string | null;
  logoUrl: string | null;
  name: string;
};

export type WorkspaceReport = {
  business: ReportBusiness;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  notes: string[];
  period: {
    end: string;
    label: string;
    start: string;
  };
  sections: ReportSection[];
  summaryCards: ReportSummaryCard[];
  subtitle: string;
  title: string;
  type: ReportType;
};

type MessageReportRow = {
  body_text: string | null;
  channel:
    | {
        display_name: string | null;
        type: string | null;
      }
    | Array<{
        display_name: string | null;
        type: string | null;
      }>
    | null;
  contact:
    | {
        company: string | null;
        email: string | null;
        id: string;
        name: string | null;
        phone: string | null;
      }
    | Array<{
        company: string | null;
        email: string | null;
        id: string;
        name: string | null;
        phone: string | null;
      }>
    | null;
  contact_id: string | null;
  conversation_id: string | null;
  created_at: string;
  direction: string;
  id: string;
  received_at: string | null;
  sent_at: string | null;
  subject: string | null;
};

type OutboundReportRow = {
  body_text: string | null;
  channel_type: string | null;
  conversation_id: string | null;
  created_at: string;
  failed_at: string | null;
  id: string;
  last_error: string | null;
  provider: string | null;
  recipient: string | null;
  sent_at: string | null;
  status: string | null;
  subject: string | null;
};

type VoiceReportRow = {
  contact_id: string | null;
  created_at: string;
  customer_number: string | null;
  direction: string | null;
  duration_seconds: number | null;
  ended_at: string | null;
  from_number: string | null;
  id: string;
  purpose: string | null;
  recording_url: string | null;
  started_at: string | null;
  status: string | null;
  summary: string | null;
  to_number: string | null;
  transcript: string | null;
};

type UsageReportRow = {
  cost_snapshot: string | number | null;
  created_at: string;
  currency: string | null;
  customer_charge_snapshot: string | number | null;
  id: string;
  model: string | null;
  provider: string | null;
  quantity: string | number | null;
  service: string | null;
  unit: string | null;
  usage_type: string | null;
};

type GeneratedDocumentRow = {
  content_type: string | null;
  document_type: string | null;
  filename: string | null;
  id: string;
  lifecycle_status: string | null;
  size_bytes: number | null;
  title: string | null;
  updated_at: string;
};

type CommunicationEvent = {
  at: string;
  body: string;
  channel: ReportChannel;
  contact: string;
  direction: "inbound" | "outbound";
  id: string;
  meta: string;
  source: string;
  status: string;
  subject: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clampText(value: string | null, maxLength = 240) {
  if (!value) {
    return "-";
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
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

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en", {
    currency,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function safeType(value: string | null | undefined): ReportType {
  return REPORT_TYPES.some((type) => type.value === value)
    ? (value as ReportType)
    : "communications_log";
}

function safeTimeframe(value: string | null | undefined): ReportTimeframe {
  return REPORT_TIMEFRAMES.some((timeframe) => timeframe.value === value)
    ? (value as ReportTimeframe)
    : "this_month";
}

function safeChannel(value: string | null | undefined): ReportChannel {
  return REPORT_CHANNELS.some((channel) => channel.value === value)
    ? (value as ReportChannel)
    : "all";
}

function safeDirection(value: string | null | undefined): ReportDirection {
  return REPORT_DIRECTIONS.some((direction) => direction.value === value)
    ? (value as ReportDirection)
    : "all";
}

function dateInputToIso(value: string | null | undefined, endOfDay = false) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  if (endOfDay) {
    date.setDate(date.getDate() + 1);
  }

  return date.toISOString();
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + diff);

  return copy;
}

function resolveReportPeriod(filters: ReportFilters) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (filters.timeframe === "custom") {
    const customStart = dateInputToIso(filters.start);
    const customEnd = dateInputToIso(filters.end, true);

    if (customStart && customEnd && customStart < customEnd) {
      const displayEnd = dateInputToIso(filters.end) ?? customEnd;

      return {
        end: customEnd,
        label: `${formatDateOnly(customStart)} - ${formatDateOnly(displayEnd)}`,
        start: customStart,
      };
    }
  }

  if (filters.timeframe === "this_week") {
    start = startOfWeek(now);
    end = new Date(start);
    end.setDate(start.getDate() + 7);
  } else if (filters.timeframe === "last_week") {
    end = startOfWeek(now);
    start = new Date(end);
    start.setDate(end.getDate() - 7);
  } else if (filters.timeframe === "this_month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else if (filters.timeframe === "last_month") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (filters.timeframe === "this_year") {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
  } else if (filters.timeframe === "last_year") {
    start = new Date(now.getFullYear() - 1, 0, 1);
    end = new Date(now.getFullYear(), 0, 1);
  }

  return {
    end: end.toISOString(),
    label: REPORT_TIMEFRAMES.find((timeframe) => timeframe.value === filters.timeframe)?.label ?? "Report period",
    start: start.toISOString(),
  };
}

function channelFromValue(value: string | null | undefined): ReportChannel {
  const normalized = value?.toLowerCase() ?? "";

  if (normalized.includes("sms") || normalized.includes("text")) {
    return "sms";
  }

  if (
    normalized.includes("phone") ||
    normalized.includes("voice") ||
    normalized.includes("call")
  ) {
    return "phone";
  }

  if (
    normalized.includes("email") ||
    normalized.includes("gmail") ||
    normalized.includes("outlook") ||
    normalized.includes("microsoft")
  ) {
    return "email";
  }

  return "crm";
}

function contactLabel(contact: ContactListItem | null | undefined) {
  return (
    contact?.name ??
    contact?.company ??
    contact?.email ??
    contact?.phone ??
    "Unknown contact"
  );
}

function relationContactLabel(
  contact:
    | {
        company: string | null;
        email: string | null;
        name: string | null;
        phone: string | null;
      }
    | null
    | undefined,
) {
  return (
    textValue(contact?.name) ??
    textValue(contact?.company) ??
    textValue(contact?.email) ??
    textValue(contact?.phone) ??
    "Unknown contact"
  );
}

function messageToCommunicationEvent(row: MessageReportRow): CommunicationEvent {
  const channel = firstRelation(row.channel);
  const contact = firstRelation(row.contact);
  const direction = row.direction === "outbound" ? "outbound" : "inbound";
  const channelKind = channelFromValue(channel?.type ?? channel?.display_name);

  return {
    at:
      direction === "outbound"
        ? (row.sent_at ?? row.created_at)
        : (row.received_at ?? row.created_at),
    body: clampText(row.body_text, 420),
    channel: channelKind,
    contact: relationContactLabel(contact),
    direction,
    id: `message:${row.id}`,
    meta: channelKind.toUpperCase(),
    source: "Conversation",
    status: "recorded",
    subject: textValue(row.subject) ?? (channelKind === "sms" ? "SMS" : "-"),
  };
}

function outboundToCommunicationEvent(row: OutboundReportRow): CommunicationEvent {
  const channelKind = channelFromValue(row.channel_type);
  const failed = row.status === "failed" || Boolean(row.failed_at);

  return {
    at: row.failed_at ?? row.sent_at ?? row.created_at,
    body: failed
      ? clampText(row.last_error, 420)
      : clampText(row.body_text, 420),
    channel: channelKind,
    contact: textValue(row.recipient) ?? "Unknown recipient",
    direction: "outbound",
    id: `outbox:${row.id}`,
    meta: channelKind.toUpperCase(),
    source: "Outbox",
    status: failed ? "failed" : (textValue(row.status) ?? "queued"),
    subject: textValue(row.subject) ?? (channelKind === "sms" ? "SMS" : "-"),
  };
}

function voiceToCommunicationEvent(row: VoiceReportRow): CommunicationEvent {
  const direction = row.direction === "outbound" ? "outbound" : "inbound";
  const counterpart =
    textValue(row.customer_number) ??
    (direction === "outbound" ? textValue(row.to_number) : textValue(row.from_number)) ??
    "Unknown number";

  return {
    at: row.ended_at ?? row.started_at ?? row.created_at,
    body: clampText(row.summary ?? row.transcript, 420),
    channel: "phone",
    contact: counterpart,
    direction,
    id: `voice:${row.id}`,
    meta: textValue(row.purpose) ? formatLabel(row.purpose) : "Phone",
    source: "Voice",
    status: textValue(row.status) ?? "recorded",
    subject: direction === "outbound" ? "Outbound phone call" : "Inbound phone call",
  };
}

function matchesDirection(
  direction: "inbound" | "outbound",
  requested: ReportDirection,
) {
  return requested === "all" || requested === direction;
}

function matchesChannel(channel: ReportChannel, requested: ReportChannel) {
  return requested === "all" || requested === channel;
}

function isUnavailableRelationError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

async function getConversationIdsForContact(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string | null,
) {
  if (!contactId) {
    return null;
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .limit(1000);

  if (error) {
    throw new Error(`Unable to load contact conversations: ${error.message}`);
  }

  return (data ?? []).map((row) => String(row.id));
}

async function loadCommunicationEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: ReportFilters,
  period: { start: string; end: string },
) {
  const conversationIds = await getConversationIdsForContact(
    supabase,
    workspaceId,
    filters.contactId,
  );
  let messagesQuery = supabase
    .from("messages")
    .select(
      "id,direction,subject,body_text,contact_id,conversation_id,created_at,received_at,sent_at,contact:contacts(id,name,company,email,phone),channel:channels(type,display_name)",
    )
    .eq("workspace_id", workspaceId)
    .gte("created_at", period.start)
    .lt("created_at", period.end)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (filters.contactId) {
    messagesQuery = messagesQuery.eq("contact_id", filters.contactId);
  }

  if (filters.direction !== "all") {
    messagesQuery = messagesQuery.eq("direction", filters.direction);
  }

  let outboxQuery = supabase
    .from("outbound_messages")
    .select(
      "id,channel_type,recipient,subject,body_text,status,created_at,sent_at,failed_at,last_error,conversation_id,provider,service",
    )
    .eq("workspace_id", workspaceId)
    .gte("created_at", period.start)
    .lt("created_at", period.end)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (conversationIds) {
    if (conversationIds.length === 0) {
      outboxQuery = outboxQuery.in("conversation_id", ["00000000-0000-0000-0000-000000000000"]);
    } else {
      outboxQuery = outboxQuery.in("conversation_id", conversationIds);
    }
  }

  let voiceQuery = supabase
    .from("voice_calls")
    .select(
      "id,contact_id,direction,purpose,status,from_number,to_number,customer_number,created_at,started_at,ended_at,duration_seconds,summary,transcript,recording_url",
    )
    .eq("workspace_id", workspaceId)
    .gte("created_at", period.start)
    .lt("created_at", period.end)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (filters.contactId) {
    voiceQuery = voiceQuery.eq("contact_id", filters.contactId);
  }

  const [messagesResult, outboxResult, voiceResult] = await Promise.all([
    messagesQuery,
    filters.direction === "inbound" ? Promise.resolve({ data: [], error: null }) : outboxQuery,
    filters.channel !== "all" && filters.channel !== "phone"
      ? Promise.resolve({ data: [], error: null })
      : voiceQuery,
  ]);

  if (messagesResult.error) {
    throw new Error(`Unable to load report messages: ${messagesResult.error.message}`);
  }

  if (outboxResult.error && !isUnavailableRelationError(outboxResult.error)) {
    throw new Error(
      `Unable to load report outbox messages: ${outboxResult.error.message}`,
    );
  }

  if (voiceResult.error && !isUnavailableRelationError(voiceResult.error)) {
    throw new Error(`Unable to load report voice calls: ${voiceResult.error.message}`);
  }

  return [
    ...((messagesResult.data ?? []) as unknown as MessageReportRow[]).map(
      messageToCommunicationEvent,
    ),
    ...((outboxResult.error ? [] : (outboxResult.data ?? [])) as unknown as OutboundReportRow[]).map(
      outboundToCommunicationEvent,
    ),
    ...((voiceResult.error ? [] : (voiceResult.data ?? [])) as unknown as VoiceReportRow[]).map(
      voiceToCommunicationEvent,
    ),
  ]
    .filter((event) => matchesDirection(event.direction, filters.direction))
    .filter((event) => matchesChannel(event.channel, filters.channel))
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

function communicationSummaryCards(events: CommunicationEvent[]) {
  const inbound = events.filter((event) => event.direction === "inbound").length;
  const outbound = events.filter((event) => event.direction === "outbound").length;
  const failed = events.filter((event) => event.status === "failed").length;

  return [
    {
      label: "Total communications",
      value: String(events.length),
      detail: `${pluralize(inbound, "inbound")} - ${pluralize(outbound, "outbound")}`,
    },
    {
      label: "Email",
      value: String(events.filter((event) => event.channel === "email").length),
      detail: "Recorded email activity",
    },
    {
      label: "SMS",
      value: String(events.filter((event) => event.channel === "sms").length),
      detail: "Inbound, outbound, and delivery rows",
    },
    {
      label: "Phone",
      value: String(events.filter((event) => event.channel === "phone").length),
      detail: failed > 0 ? `${failed} failed or incomplete` : "Voice call records",
    },
  ] satisfies ReportSummaryCard[];
}

function communicationSection(events: CommunicationEvent[]): ReportSection {
  return {
    columns: ["Date", "Direction", "Channel", "Contact", "Subject", "Preview", "Status"],
    emptyText: "No communications match this report filter.",
    rows: events.map((event) => [
      formatDateTime(event.at),
      formatLabel(event.direction),
      event.meta,
      event.contact,
      event.subject,
      event.body,
      formatLabel(event.status),
    ]),
    title: "Communication records",
  };
}

function buildCommunicationReport(
  type: ReportType,
  title: string,
  subtitle: string,
  events: CommunicationEvent[],
) {
  return {
    sections: [communicationSection(events)],
    summaryCards: communicationSummaryCards(events),
    subtitle,
    title,
    type,
  };
}

function workflowBucket(conversation: ConversationListItem) {
  if (conversation.followUpIsDue) {
    return "Follow-up due";
  }

  if ((conversation.inquiryFacts?.missingInfo.length ?? 0) > 0) {
    return "Missing info";
  }

  if (conversation.workflowBucket === "ready_to_quote") {
    return "Ready to quote";
  }

  if (conversation.workflowBucket === "needs_reply") {
    return "Needs reply";
  }

  return formatLabel(conversation.workflowBucket);
}

function conversationUpdatedAt(conversation: ConversationListItem) {
  return (
    conversation.lastMessageAt ??
    conversation.originalInquiryAt ??
    new Date(0).toISOString()
  );
}

async function loadWorkQueueReport(
  supabase: SupabaseClient,
  workspaceId: string,
  period: { start: string; end: string },
) {
  const conversations = await getConversationList(supabase, workspaceId, {
    limit: 500,
  });
  const visibleConversations = conversations.filter((conversation) => {
    const at = conversationUpdatedAt(conversation);

    return at >= period.start && at < period.end;
  });
  const needsReply = visibleConversations.filter(
    (conversation) => conversation.workflowBucket === "needs_reply",
  ).length;
  const readyToQuote = visibleConversations.filter(
    (conversation) => conversation.workflowBucket === "ready_to_quote",
  ).length;
  const followUpDue = visibleConversations.filter(
    (conversation) => conversation.followUpIsDue,
  ).length;
  const missingInfo = visibleConversations.filter(
    (conversation) => (conversation.inquiryFacts?.missingInfo.length ?? 0) > 0,
  ).length;

  return {
    sections: [
      {
        columns: ["Updated", "Contact/lead", "Bucket", "Next step", "Missing details"],
        emptyText: "No work queue records match this period.",
        rows: visibleConversations.map((conversation) => [
          formatDateTime(conversationUpdatedAt(conversation)),
          conversation.contactName ??
            conversation.leadTitle ??
            conversation.latestSubject ??
            "Conversation",
          workflowBucket(conversation),
          conversation.nextActionLabel,
          conversation.inquiryFacts?.missingInfo.join(", ") || "-",
        ]),
        title: "Work queue",
      },
    ],
    summaryCards: [
      { label: "Conversations", value: String(visibleConversations.length) },
      { label: "Needs reply", value: String(needsReply) },
      { label: "Ready to quote", value: String(readyToQuote) },
      {
        label: "Follow-up / missing info",
        value: String(followUpDue + missingInfo),
        detail: `${followUpDue} follow-ups - ${missingInfo} missing info`,
      },
    ],
    subtitle: "Open CRM queue, missing details, follow-ups, and quoting state.",
    title: "Work Queue Summary",
    type: "work_queue_summary" as const,
  };
}

async function loadUsageLedgerReport(
  supabase: SupabaseClient,
  workspaceId: string,
  period: { start: string; end: string },
) {
  const summary = await getBillableUsageSummary(supabase, workspaceId, {
    end: period.end,
    period: "custom",
    start: period.start,
  });
  const { data, error } = await supabase
    .from("usage_events")
    .select(
      "id,provider,service,model,usage_type,quantity,unit,currency,cost_snapshot,customer_charge_snapshot,created_at",
    )
    .eq("workspace_id", workspaceId)
    .gte("created_at", period.start)
    .lt("created_at", period.end)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error(`Unable to load report usage events: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as UsageReportRow[];
  const primaryCurrency = summary.totals[0]?.currency ?? "USD";
  const totalCharge = summary.totals.reduce(
    (total, item) => total + item.customerCharge,
    0,
  );
  const totalCost = summary.totals.reduce((total, item) => total + item.providerCost, 0);

  return {
    sections: [
      {
        columns: ["Date", "Provider", "Service", "Model", "Usage", "Cost", "Charge"],
        emptyText: "No usage events match this period.",
        rows: rows.map((row) => [
          formatDateTime(row.created_at),
          textValue(row.provider) ?? "-",
          textValue(row.service) ?? textValue(row.usage_type) ?? "-",
          textValue(row.model) ?? "-",
          `${numberValue(row.quantity)} ${textValue(row.unit) ?? ""}`.trim(),
          formatMoney(numberValue(row.cost_snapshot), textValue(row.currency) ?? primaryCurrency),
          formatMoney(
            numberValue(row.customer_charge_snapshot),
            textValue(row.currency) ?? primaryCurrency,
          ),
        ]),
        title: "Usage events",
      },
    ],
    summaryCards: [
      { label: "Events", value: String(summary.eventCount) },
      { label: "Quantity", value: String(Math.round(summary.quantity * 100) / 100) },
      { label: "Provider cost", value: formatMoney(totalCost, primaryCurrency) },
      { label: "Usage charge", value: formatMoney(totalCharge, primaryCurrency) },
    ],
    subtitle: "Billable provider usage recorded by Kyro.",
    title: "Usage Ledger",
    type: "usage_ledger" as const,
  };
}

async function loadDocumentsReport(
  supabase: SupabaseClient,
  workspaceId: string,
  period: { start: string; end: string },
) {
  const { data, error } = await supabase
    .from("generated_documents")
    .select(
      "id,document_type,lifecycle_status,title,filename,content_type,size_bytes,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .gte("updated_at", period.start)
    .lt("updated_at", period.end)
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (error) {
    if (isUnavailableRelationError(error)) {
      const fallback = await getGeneratedDocumentsForWorkspace(supabase, workspaceId, 100);

      return {
        sections: [
          {
            columns: ["Updated", "Type", "Status", "Title", "Filename"],
            emptyText: "No generated documents match this period.",
            rows: fallback
              .filter((document) => document.updatedAt >= period.start && document.updatedAt < period.end)
              .map((document) => [
                formatDateTime(document.updatedAt),
                formatLabel(document.documentType),
                formatLabel(document.lifecycleStatus),
                document.title,
                document.filename,
              ]),
            title: "Generated documents",
          },
        ],
        summaryCards: [
          { label: "Documents", value: String(fallback.length) },
          {
            label: "Quotes",
            value: String(fallback.filter((document) => document.documentType === "quote").length),
          },
          {
            label: "Invoices",
            value: String(fallback.filter((document) => document.documentType === "invoice").length),
          },
          { label: "Filed/sent", value: String(fallback.filter((document) => document.lifecycleStatus !== "generated").length) },
        ],
        subtitle: "Generated documents and saved PDF records.",
        title: "Document Activity",
        type: "documents_activity" as const,
      };
    }

    throw new Error(`Unable to load generated documents report: ${error.message}`);
  }

  const documents = (data ?? []) as unknown as GeneratedDocumentRow[];

  return {
    sections: [
      {
        columns: ["Updated", "Type", "Status", "Title", "Filename", "Size"],
        emptyText: "No generated documents match this period.",
        rows: documents.map((document) => [
          formatDateTime(document.updated_at),
          formatLabel(document.document_type),
          formatLabel(document.lifecycle_status),
          textValue(document.title) ?? "-",
          textValue(document.filename) ?? "-",
          document.size_bytes ? `${Math.round(document.size_bytes / 102.4) / 10} KB` : "-",
        ]),
        title: "Generated documents",
      },
    ],
    summaryCards: [
      { label: "Documents", value: String(documents.length) },
      {
        label: "Quotes",
        value: String(documents.filter((document) => document.document_type === "quote").length),
      },
      {
        label: "Invoices",
        value: String(documents.filter((document) => document.document_type === "invoice").length),
      },
      {
        label: "Filed/sent",
        value: String(
          documents.filter(
            (document) =>
              document.lifecycle_status === "filed" ||
              document.lifecycle_status === "sent",
          ).length,
        ),
      },
    ],
    subtitle: "Generated documents and saved PDF records.",
    title: "Document Activity",
    type: "documents_activity" as const,
  };
}

function paymentHistoryReport() {
  return {
    sections: [
      {
        columns: ["Date", "Contact", "Reference", "Amount", "Status"],
        emptyText:
          "Payment collection is not connected yet. This report will populate once Stripe/payment records are integrated.",
        rows: [],
        title: "Payment records",
      },
    ],
    summaryCards: [
      { label: "Payments", value: "0", detail: "Payment integration pending" },
      { label: "Collected", value: "-", detail: "Connect payments first" },
      { label: "Outstanding", value: "-", detail: "Connect payments first" },
      { label: "Refunds", value: "-", detail: "Connect payments first" },
    ],
    subtitle:
      "Reserved for customer payment reporting after billing and payment collection are integrated.",
    title: "Payment History",
    type: "payment_history" as const,
  };
}

function reportDefinition(type: ReportType) {
  return REPORT_TYPES.find((reportType) => reportType.value === type) ?? REPORT_TYPES[0];
}

function reportFilterRows(
  filters: ReportFilters,
  contacts: ContactListItem[],
  period: { label: string },
) {
  const contact = filters.contactId
    ? contacts.find((item) => item.id === filters.contactId)
    : null;

  return [
    { label: "Period", value: period.label },
    {
      label: "Channel",
      value:
        REPORT_CHANNELS.find((channel) => channel.value === filters.channel)?.label ??
        "All channels",
    },
    {
      label: "Direction",
      value:
        REPORT_DIRECTIONS.find((direction) => direction.value === filters.direction)
          ?.label ?? "All directions",
    },
    { label: "Contact", value: contact ? contactLabel(contact) : "All contacts" },
  ];
}

async function loadReportBusiness(
  supabase: SupabaseClient,
  workspace: WorkspaceSummary,
): Promise<ReportBusiness> {
  const settings = await getCommunicationSettings(supabase, workspace.id).catch(
    () => null,
  );
  const signature =
    settings?.useSeparateAiSignature && settings.aiGeneratedSignature.logoContentBase64
      ? settings.aiGeneratedSignature
      : settings?.manualSignature.logoContentBase64
        ? settings.manualSignature
        : settings?.aiGeneratedSignature.logoContentBase64
          ? settings.aiGeneratedSignature
          : null;
  const logoContentBase64 = textValue(signature?.logoContentBase64);
  const logoContentType = textValue(signature?.logoContentType);
  const logoDataUrl =
    logoContentBase64 && logoContentType
      ? `data:${logoContentType};base64,${logoContentBase64}`
      : null;

  return {
    logoContentBase64,
    logoContentType,
    logoDataUrl,
    logoUrl: textValue(settings?.manualSignature.logoUrl) ?? textValue(settings?.aiGeneratedSignature.logoUrl),
    name: workspace.name,
  };
}

export function parseReportFilters(
  input: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined,
): ReportFilters {
  const getValue = (key: string) => {
    if (!input) {
      return null;
    }

    if (input instanceof URLSearchParams) {
      return input.get(key);
    }

    const value = input[key];

    return Array.isArray(value) ? value[0] : value ?? null;
  };
  const type = safeType(getValue("type"));
  const defaultDirection =
    type === "inbound_communications"
      ? "inbound"
      : type === "outbound_communications"
        ? "outbound"
        : safeDirection(getValue("direction"));

  return {
    channel: safeChannel(getValue("channel")),
    contactId: textValue(getValue("contactId")),
    direction: defaultDirection,
    end: textValue(getValue("end")),
    start: textValue(getValue("start")),
    timeframe: safeTimeframe(getValue("timeframe")),
    type,
  };
}

export function reportSearchParams(filters: ReportFilters) {
  const params = new URLSearchParams();

  params.set("type", filters.type);
  params.set("timeframe", filters.timeframe);
  params.set("direction", filters.direction);
  params.set("channel", filters.channel);

  if (filters.contactId) {
    params.set("contactId", filters.contactId);
  }

  if (filters.start) {
    params.set("start", filters.start);
  }

  if (filters.end) {
    params.set("end", filters.end);
  }

  return params;
}

export async function getReportContactOptions(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  return getContactList(supabase, workspaceId);
}

export async function buildWorkspaceReport(
  supabase: SupabaseClient,
  workspace: WorkspaceSummary,
  filters: ReportFilters,
): Promise<WorkspaceReport> {
  const [business, contacts] = await Promise.all([
    loadReportBusiness(supabase, workspace),
    getReportContactOptions(supabase, workspace.id),
  ]);
  const period = resolveReportPeriod(filters);
  let reportCore:
    | ReturnType<typeof buildCommunicationReport>
    | Awaited<ReturnType<typeof loadWorkQueueReport>>
    | Awaited<ReturnType<typeof loadUsageLedgerReport>>
    | Awaited<ReturnType<typeof loadDocumentsReport>>
    | ReturnType<typeof paymentHistoryReport>;

  if (
    filters.type === "communications_log" ||
    filters.type === "inbound_communications" ||
    filters.type === "outbound_communications" ||
    filters.type === "contact_communications"
  ) {
    const events = await loadCommunicationEvents(
      supabase,
      workspace.id,
      filters,
      period,
    );
    const definition = reportDefinition(filters.type);
    const title =
      filters.type === "contact_communications" && filters.contactId
        ? `Communications - ${
            contacts.find((contact) => contact.id === filters.contactId)
              ? contactLabel(contacts.find((contact) => contact.id === filters.contactId))
              : "Contact"
          }`
        : definition.label;

    reportCore = buildCommunicationReport(
      filters.type,
      title,
      definition.description,
      events,
    );
  } else if (filters.type === "usage_ledger") {
    reportCore = await loadUsageLedgerReport(supabase, workspace.id, period);
  } else if (filters.type === "documents_activity") {
    reportCore = await loadDocumentsReport(supabase, workspace.id, period);
  } else if (filters.type === "work_queue_summary") {
    reportCore = await loadWorkQueueReport(supabase, workspace.id, period);
  } else {
    reportCore = paymentHistoryReport();
  }

  return {
    business,
    filters: reportFilterRows(filters, contacts, period),
    generatedAt: new Date().toISOString(),
    notes:
      filters.type === "payment_history"
        ? ["Payment reporting is scaffolded but will remain empty until payment processing is connected."]
        : [
            "This report is generated from current Kyro workspace records.",
            "Rows are limited to the most recent 1,000 matching records per source.",
          ],
    period,
    sections: reportCore.sections,
    summaryCards: reportCore.summaryCards,
    subtitle: reportCore.subtitle,
    title: reportCore.title,
    type: reportCore.type,
  };
}
