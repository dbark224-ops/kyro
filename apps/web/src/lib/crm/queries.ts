import type { SupabaseClient } from "@supabase/supabase-js";

const LIST_MESSAGE_LIMIT = 500;
const LIST_ACTION_LIMIT = 500;
const LIST_QUOTE_DRAFT_LIMIT = 250;
const REVIEW_MESSAGE_LIMIT = 120;
const REVIEW_AI_RUN_LIMIT = 30;
const REVIEW_ACTION_LIMIT = 80;
const REVIEW_QUOTE_DRAFT_LIMIT = 30;

export type LeadListItem = {
  id: string;
  contactId: string | null;
  conversationId: string | null;
  title: string;
  description: string | null;
  source: string | null;
  status: string;
  priority: string;
  serviceType: string | null;
  nextStep: string | null;
  estimatedValue: string | null;
  updatedAt: string;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    contactType: string | null;
    address: string | null;
  } | null;
};

export type ContactListItem = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  contactType: string;
  address: string | null;
  source: string | null;
  notes: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
  messageCount: number;
};

export type ConversationListItem = {
  id: string;
  status: string;
  originalInquiryAt: string | null;
  originalInquiryBody: string | null;
  lastMessageAt: string | null;
  contactName: string | null;
  leadTitle: string | null;
  leadPriority: string | null;
  leadNextStep: string | null;
  leadServiceType: string | null;
  latestSubject: string | null;
  latestBody: string | null;
  latestDirection: string | null;
  latestActionType: string | null;
  latestActionStatus: string | null;
  pendingApprovalCount: number;
  approvedActionCount: number;
  activeActionTypes: string[];
  completedActionTypes: string[];
  quoteDraftCount: number;
  inquiryFacts: {
    jobType: string | null;
    address: string | null;
    preferredTime: string | null;
    urgency: string;
    fit: string;
    missingInfo: string[];
  } | null;
  nextActionLabel: string;
  workflowBucket: string;
};

export type SkippedEmailSummaryItem = {
  accountEmail: string | null;
  attachmentCount: number;
  attachmentNames: string[];
  id: string;
  category: string;
  classificationProvider: string | null;
  confidence: number | null;
  externalMessageId: string | null;
  externalThreadId: string | null;
  fromEmail: string | null;
  lastReplySubject: string | null;
  lastRepliedAt: string | null;
  processedAt: string | null;
  provider: string | null;
  reason: string | null;
  receivedAt: string | null;
  replyCount: number;
  source: string;
  subject: string;
  summary: string | null;
};

export type SkippedEmailSummaries = {
  items: SkippedEmailSummaryItem[];
  last24HoursCount: number;
};

export type SkippedEmailEventRow = {
  created_at?: string | null;
  id: string;
  payload: unknown;
  processed_at?: string | null;
  source: string;
};

export type SkippedEmailReplyEventRow = {
  created_at?: string | null;
  id: string;
  payload: unknown;
  processed_at?: string | null;
};

type ConversationListOptions = {
  ids?: string[];
  limit?: number;
};

type ConversationWorkflowCounts = {
  awaitingCustomer: number;
  missingInfo: number;
  needsReply: number;
  needsReview: number;
  open: number;
  readyToQuote: number;
  resolved: number;
  siteVisitNeeded: number;
  total: number;
};

type QuoteDraftSummary = {
  changesRequested: number;
  draft: number;
  ready: number;
  sent: number;
  total: number;
};

type ActionSummary = {
  activeActionTypes: string[];
  approvedActionCount: number;
  completedActionTypes: string[];
  latestActionStatus: string | null;
  latestActionType: string | null;
  pendingApprovalCount: number;
};

function skippedEmailLast24HoursStart() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export function buildSkippedEmailSummaryItems(
  events: SkippedEmailEventRow[],
  replyEvents: SkippedEmailReplyEventRow[] = [],
) {
  const items: SkippedEmailSummaryItem[] = events.map((event) => {
    const payload = objectRecord(event.payload);
    const classification = objectRecord(payload.classification);
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : [];
    const confidence =
      typeof classification.confidence === "number"
        ? classification.confidence
        : null;
    const attachmentNames = attachments
      .map((attachment) => textValue(objectRecord(attachment).filename))
      .filter((filename): filename is string => Boolean(filename));
    const attachmentCount =
      typeof payload.attachmentCount === "number"
        ? payload.attachmentCount
        : attachmentNames.length;

    return {
      accountEmail: textValue(payload.accountEmail),
      attachmentCount,
      attachmentNames,
      id: String(event.id),
      category: textValue(classification.category) ?? "observed",
      classificationProvider: textValue(classification.providerUsed),
      confidence,
      externalMessageId: textValue(payload.externalMessageId),
      externalThreadId: textValue(payload.externalThreadId),
      fromEmail: textValue(payload.fromEmail),
      lastReplySubject: null,
      lastRepliedAt: null,
      processedAt: textValue(event.processed_at),
      provider: textValue(payload.provider),
      reason: textValue(classification.reason),
      receivedAt: textValue(payload.receivedAt),
      replyCount: 0,
      source: String(event.source),
      subject: textValue(payload.subject) ?? "Skipped email",
      summary:
        textValue(payload.summary) ??
        textValue(classification.summary) ??
        textValue(classification.actionHint),
    };
  });
  const itemIds = new Set(items.map((item) => item.id));
  const replyStateByEventId = new Map<
    string,
    {
      count: number;
      lastReplySubject: string | null;
      lastRepliedAt: string | null;
    }
  >();

  for (const replyEvent of replyEvents) {
    const payload = objectRecord(replyEvent.payload);
    const originalEventId = textValue(payload.originalEventId);

    if (!originalEventId || !itemIds.has(originalEventId)) {
      continue;
    }

    const current = replyStateByEventId.get(originalEventId) ?? {
      count: 0,
      lastReplySubject: null,
      lastRepliedAt: null,
    };
    const sentAt =
      textValue(payload.sentAt) ??
      textValue(replyEvent.processed_at) ??
      textValue(replyEvent.created_at);

    replyStateByEventId.set(originalEventId, {
      count: current.count + 1,
      lastReplySubject: current.lastReplySubject ?? textValue(payload.subject),
      lastRepliedAt: current.lastRepliedAt ?? sentAt,
    });
  }

  for (const item of items) {
    const replyState = replyStateByEventId.get(item.id);

    if (!replyState) {
      continue;
    }

    item.replyCount = replyState.count;
    item.lastReplySubject = replyState.lastReplySubject;
    item.lastRepliedAt = replyState.lastRepliedAt;
  }

  return items;
}

type ConversationFactsSummary = {
  fit: string | null;
  missingInfo: string[];
} | null;

export type ConversationReview = {
  conversation: {
    id: string;
    status: string;
    lastMessageAt: string | null;
    createdAt: string;
  };
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    contactType: string;
    address: string | null;
    notes: string | null;
  } | null;
  lead: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    source: string | null;
    serviceType: string | null;
    nextStep: string | null;
    estimatedValue: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    channelId: string | null;
    channelType: string | null;
    channelDisplayName: string | null;
    subject: string | null;
    bodyText: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    receivedAt: string | null;
    sentAt: string | null;
  }>;
  aiRuns: Array<{
    id: string;
    taskType: string;
    status: string;
    provider: string;
    model: string;
    output: Record<string, unknown>;
    usage: Record<string, unknown>;
    actualCost: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
  actions: Array<{
    id: string;
    type: string;
    status: string;
    input: Record<string, unknown>;
    result: Record<string, unknown>;
    createdAt: string;
    approvedAt: string | null;
    executedAt: string | null;
  }>;
  quoteDrafts: Array<{
    id: string;
    title: string;
    status: string;
    lineItems: unknown[];
    notes: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
  inquiryFacts: {
    id: string;
    sourceAiRunId: string | null;
    jobType: string | null;
    address: string | null;
    preferredTime: string | null;
    urgency: string;
    budget: string | null;
    fit: string;
    missingInfo: string[];
    source: string;
    editedByUserId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  } | null;
  routeDecisions: Array<{
    id: string;
    aiRunId: string | null;
    selectedProvider: string;
    selectedModel: string;
    fallbackUsed: boolean;
    decisionReason: string;
    budgetSnapshot: Record<string, unknown>;
    createdAt: string;
  }>;
  usageEvents: Array<{
    id: string;
    aiRunId: string | null;
    usageType: string;
    quantity: string;
    customerChargeSnapshot: string;
    currency: string;
    createdAt: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorType: string;
    entityType: string;
    createdAt: string;
  }>;
};

export type ContactProfile = {
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    contactType: string;
    address: string | null;
    source: string | null;
    notes: string | null;
    updatedAt: string;
  };
  counts: {
    leads: number;
    conversations: number;
    messages: number;
    actions: number;
    quoteDrafts: number;
  };
  leads: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    serviceType: string | null;
    nextStep: string | null;
    updatedAt: string;
  }>;
  conversations: Array<{
    id: string;
    status: string;
    leadTitle: string | null;
    lastMessageAt: string | null;
  }>;
  messages: Array<{
    id: string;
    conversationId: string | null;
    direction: string;
    subject: string | null;
    bodyText: string | null;
    createdAt: string;
    receivedAt: string | null;
    sentAt: string | null;
  }>;
  aiRuns: Array<{
    id: string;
    taskType: string;
    status: string;
    provider: string;
    model: string;
    output: Record<string, unknown>;
    actualCost: string | null;
    createdAt: string;
  }>;
  actions: Array<{
    id: string;
    type: string;
    status: string;
    input: Record<string, unknown>;
    createdAt: string;
  }>;
  quoteDrafts: Array<{
    id: string;
    title: string;
    status: string;
    lineItemCount: number;
    notes: string | null;
    conversationId: string | null;
    leadTitle: string | null;
    updatedAt: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorType: string;
    entityType: string;
    createdAt: string;
  }>;
};

export type QuoteDraftListItem = {
  id: string;
  title: string;
  status: string;
  lineItems: unknown[];
  lineItemCount: number;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    address: string | null;
  } | null;
  lead: {
    id: string;
    title: string;
    status: string;
    serviceType: string | null;
    nextStep: string | null;
  } | null;
  conversation: {
    id: string;
    status: string;
    lastMessageAt: string | null;
  } | null;
  inquiryFacts: {
    jobType: string | null;
    address: string | null;
    preferredTime: string | null;
    budget: string | null;
  } | null;
};

export type ContactSearchResult = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  updatedAt: string;
};

export type QuoteDraftProfile = {
  quoteDraft: QuoteDraftListItem;
  inquiryFacts:
    | (NonNullable<QuoteDraftListItem["inquiryFacts"]> & {
        urgency: string | null;
        fit: string | null;
        missingInfo: string[];
      })
    | null;
  messages: Array<{
    id: string;
    direction: string;
    subject: string | null;
    bodyText: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    receivedAt: string | null;
    sentAt: string | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorType: string;
    entityType: string;
    createdAt: string;
  }>;
};

function uniqueIds(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export async function getLeadList(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id,title,description,source,status,priority,service_type,next_step,estimated_value,contact_id,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Unable to load leads: ${error.message}`);
  }

  const contactIds = uniqueIds(
    (leads ?? []).map((lead) => String(lead.contact_id ?? "")),
  );
  const leadIds = uniqueIds((leads ?? []).map((lead) => String(lead.id)));
  const contactsById = new Map<string, LeadListItem["contact"]>();
  const conversationByLeadId = new Map<string, string>();

  if (contactIds.length > 0) {
    const { data: contacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id,name,email,phone,company,contact_type,address")
      .eq("workspace_id", workspaceId)
      .in("id", contactIds);

    if (contactsError) {
      throw new Error(`Unable to load lead contacts: ${contactsError.message}`);
    }

    for (const contact of contacts ?? []) {
      contactsById.set(String(contact.id), {
        id: String(contact.id),
        name: contact.name ? String(contact.name) : null,
        email: contact.email ? String(contact.email) : null,
        phone: contact.phone ? String(contact.phone) : null,
        company: contact.company ? String(contact.company) : null,
        contactType: contact.contact_type ? String(contact.contact_type) : null,
        address: contact.address ? String(contact.address) : null,
      });
    }
  }

  if (leadIds.length > 0) {
    const { data: conversations, error: conversationsError } = await supabase
      .from("conversations")
      .select("id,lead_id")
      .eq("workspace_id", workspaceId)
      .in("lead_id", leadIds);

    if (conversationsError) {
      throw new Error(
        `Unable to load lead conversations: ${conversationsError.message}`,
      );
    }

    for (const conversation of conversations ?? []) {
      const leadId = conversation.lead_id ? String(conversation.lead_id) : null;

      if (leadId && !conversationByLeadId.has(leadId)) {
        conversationByLeadId.set(leadId, String(conversation.id));
      }
    }
  }

  return (leads ?? []).map((lead) => ({
    id: String(lead.id),
    contactId: lead.contact_id ? String(lead.contact_id) : null,
    conversationId: conversationByLeadId.get(String(lead.id)) ?? null,
    title: String(lead.title),
    description: lead.description ? String(lead.description) : null,
    source: lead.source ? String(lead.source) : null,
    status: String(lead.status),
    priority: String(lead.priority),
    serviceType: lead.service_type ? String(lead.service_type) : null,
    nextStep: lead.next_step ? String(lead.next_step) : null,
    estimatedValue:
      lead.estimated_value === null || lead.estimated_value === undefined
        ? null
        : String(lead.estimated_value),
    updatedAt: String(lead.updated_at),
    contact: contactsById.get(String(lead.contact_id)) ?? null,
  })) satisfies LeadListItem[];
}

export async function getContactList(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select(
      "id,name,email,phone,company,contact_type,address,source,notes,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Unable to load contacts: ${error.message}`);
  }

  const contactIds = uniqueIds(
    (contacts ?? []).map((contact) => String(contact.id)),
  );
  const { data: messages, error: messagesError } =
    contactIds.length > 0
      ? await supabase
          .from("messages")
          .select("id,contact_id,created_at,received_at,sent_at")
          .eq("workspace_id", workspaceId)
          .in("contact_id", contactIds)
      : { data: [], error: null };

  if (messagesError) {
    throw new Error(
      `Unable to load contact message counts: ${messagesError.message}`,
    );
  }

  const messageCounts = new Map<string, number>();
  const latestMessageAtByContact = new Map<string, string>();

  for (const message of messages ?? []) {
    const contactId = message.contact_id ? String(message.contact_id) : null;

    if (contactId) {
      messageCounts.set(contactId, (messageCounts.get(contactId) ?? 0) + 1);
      const messageAt = message.sent_at
        ? String(message.sent_at)
        : message.received_at
          ? String(message.received_at)
          : message.created_at
            ? String(message.created_at)
            : null;
      const previousMessageAt = latestMessageAtByContact.get(contactId);

      if (
        messageAt &&
        (!previousMessageAt ||
          new Date(messageAt).getTime() > new Date(previousMessageAt).getTime())
      ) {
        latestMessageAtByContact.set(contactId, messageAt);
      }
    }
  }

  return (contacts ?? []).map((contact) => ({
    id: String(contact.id),
    name: contact.name ? String(contact.name) : null,
    email: contact.email ? String(contact.email) : null,
    phone: contact.phone ? String(contact.phone) : null,
    company: contact.company ? String(contact.company) : null,
    contactType: contact.contact_type ? String(contact.contact_type) : "client",
    address: contact.address ? String(contact.address) : null,
    source: contact.source ? String(contact.source) : null,
    notes: contact.notes ? String(contact.notes) : null,
    lastMessageAt: latestMessageAtByContact.get(String(contact.id)) ?? null,
    updatedAt: String(contact.updated_at),
    messageCount: messageCounts.get(String(contact.id)) ?? 0,
  })) satisfies ContactListItem[];
}

function contactSearchNeedle(value: string) {
  return value
    .trim()
    .replace(/[,()%_*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function contactSearchFilter(value: string) {
  const needle = contactSearchNeedle(value);

  if (needle.length < 2) {
    return null;
  }

  const pattern = `%${needle}%`;

  return [
    "name",
    "company",
    "email",
    "phone",
    "address",
  ]
    .map((column) => `${column}.ilike.${pattern}`)
    .join(",");
}

export async function searchContacts(
  supabase: SupabaseClient,
  workspaceId: string,
  value: string,
  limit = 8,
): Promise<ContactSearchResult[]> {
  const filter = contactSearchFilter(value);

  if (!filter) {
    return [];
  }

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id,name,email,phone,company,address,updated_at")
    .eq("workspace_id", workspaceId)
    .or(filter)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 20));

  if (error) {
    throw new Error(`Unable to search contacts: ${error.message}`);
  }

  return (contacts ?? []).map((contact) => ({
    address: textValue(contact.address),
    company: textValue(contact.company),
    email: textValue(contact.email),
    id: String(contact.id),
    name: textValue(contact.name),
    phone: textValue(contact.phone),
    updatedAt: String(contact.updated_at),
  })) satisfies ContactSearchResult[];
}

export async function getConversationList(
  supabase: SupabaseClient,
  workspaceId: string,
  options: ConversationListOptions = {},
) {
  const selectedIds = uniqueIds(options.ids ?? []);

  if (options.ids && selectedIds.length === 0) {
    return [] satisfies ConversationListItem[];
  }

  let conversationsQuery = supabase
    .from("conversations")
    .select("id,status,last_message_at,contact_id,lead_id,created_at")
    .eq("workspace_id", workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (selectedIds.length > 0) {
    conversationsQuery = conversationsQuery.in("id", selectedIds);
  }

  const { data: conversations, error } = await conversationsQuery.limit(
    options.limit ?? (selectedIds.length > 0 ? selectedIds.length : 100),
  );

  if (error) {
    throw new Error(`Unable to load conversations: ${error.message}`);
  }

  const conversationIds = uniqueIds(
    (conversations ?? []).map((conversation) => String(conversation.id)),
  );
  const contactIds = uniqueIds(
    (conversations ?? []).map((conversation) =>
      String(conversation.contact_id ?? ""),
    ),
  );
  const leadIds = uniqueIds(
    (conversations ?? []).map((conversation) =>
      String(conversation.lead_id ?? ""),
    ),
  );

  const [
    messagesResult,
    contactsResult,
    leadsResult,
    actionsResult,
    factsResult,
    quoteDraftsResult,
  ] = await Promise.all([
    conversationIds.length > 0
      ? supabase
          .from("messages")
          .select(
            "id,conversation_id,direction,subject,body_text,created_at,received_at,sent_at",
          )
          .eq("workspace_id", workspaceId)
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(LIST_MESSAGE_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length > 0
      ? supabase
          .from("contacts")
          .select("id,name,email")
          .eq("workspace_id", workspaceId)
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? supabase
          .from("leads")
          .select("id,title,priority,next_step,service_type")
          .eq("workspace_id", workspaceId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("actions")
          .select("id,target_id,type,status,created_at")
          .eq("workspace_id", workspaceId)
          .eq("target_type", "conversation")
          .in("target_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(LIST_ACTION_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("inquiry_facts")
          .select(
            "conversation_id,job_type,address,preferred_time,urgency,fit,missing_info",
          )
          .eq("workspace_id", workspaceId)
          .in("conversation_id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("quote_drafts")
          .select("id,conversation_id,status")
          .eq("workspace_id", workspaceId)
          .in("conversation_id", conversationIds)
          .limit(LIST_QUOTE_DRAFT_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (messagesResult.error) {
    throw new Error(
      `Unable to load conversation messages: ${messagesResult.error.message}`,
    );
  }

  if (contactsResult.error) {
    throw new Error(
      `Unable to load conversation contacts: ${contactsResult.error.message}`,
    );
  }

  if (leadsResult.error) {
    throw new Error(
      `Unable to load conversation leads: ${leadsResult.error.message}`,
    );
  }

  if (actionsResult.error) {
    throw new Error(
      `Unable to load conversation actions: ${actionsResult.error.message}`,
    );
  }

  if (factsResult.error) {
    throw new Error(
      `Unable to load conversation inquiry facts: ${factsResult.error.message}`,
    );
  }

  if (quoteDraftsResult.error) {
    throw new Error(
      `Unable to load conversation quote drafts: ${quoteDraftsResult.error.message}`,
    );
  }

  const latestMessageByConversation = new Map<
    string,
    (typeof messagesResult.data)[number]
  >();
  const originalInquiryByConversation = new Map<
    string,
    (typeof messagesResult.data)[number]
  >();
  const earliestMessageByConversation = new Map<
    string,
    (typeof messagesResult.data)[number]
  >();

  for (const message of messagesResult.data ?? []) {
    const conversationId = String(message.conversation_id);

    if (!latestMessageByConversation.has(conversationId)) {
      latestMessageByConversation.set(conversationId, message);
    }

    const messageTime = Date.parse(
      message.received_at
        ? String(message.received_at)
        : message.created_at
          ? String(message.created_at)
          : "",
    );
    const currentEarliest = earliestMessageByConversation.get(conversationId);
    const currentEarliestTime = currentEarliest
      ? Date.parse(
          currentEarliest.received_at
            ? String(currentEarliest.received_at)
            : currentEarliest.created_at
              ? String(currentEarliest.created_at)
              : "",
        )
      : Number.POSITIVE_INFINITY;

    if (Number.isFinite(messageTime) && messageTime < currentEarliestTime) {
      earliestMessageByConversation.set(conversationId, message);
    }

    if (String(message.direction) !== "inbound") {
      continue;
    }

    const currentOriginal = originalInquiryByConversation.get(conversationId);
    const currentOriginalTime = currentOriginal
      ? Date.parse(
          currentOriginal.received_at
            ? String(currentOriginal.received_at)
            : currentOriginal.created_at
              ? String(currentOriginal.created_at)
              : "",
        )
      : Number.POSITIVE_INFINITY;

    if (Number.isFinite(messageTime) && messageTime < currentOriginalTime) {
      originalInquiryByConversation.set(conversationId, message);
    }
  }

  const contactsById = new Map(
    (contactsResult.data ?? []).map((contact) => [
      String(contact.id),
      contact.name
        ? String(contact.name)
        : contact.email
          ? String(contact.email)
          : "Unknown contact",
    ]),
  );
  const leadsById = new Map(
    (leadsResult.data ?? []).map((lead) => [
      String(lead.id),
      {
        nextStep: lead.next_step ? String(lead.next_step) : null,
        priority: lead.priority ? String(lead.priority) : null,
        serviceType: lead.service_type ? String(lead.service_type) : null,
        title: String(lead.title),
      },
    ]),
  );
  const factsByConversation = new Map(
    (factsResult.data ?? []).map((facts) => [
      String(facts.conversation_id),
      {
        address: facts.address ? String(facts.address) : null,
        fit: facts.fit ? String(facts.fit) : "needs_review",
        jobType: facts.job_type ? String(facts.job_type) : null,
        missingInfo: Array.isArray(facts.missing_info)
          ? facts.missing_info
              .map((item) => (typeof item === "string" ? item.trim() : null))
              .filter((item): item is string => Boolean(item))
          : [],
        preferredTime: facts.preferred_time
          ? String(facts.preferred_time)
          : null,
        urgency: facts.urgency ? String(facts.urgency) : "normal",
      },
    ]),
  );
  const quoteDraftsByConversation = new Map<string, QuoteDraftSummary>();

  for (const quoteDraft of quoteDraftsResult.data ?? []) {
    const conversationId = quoteDraft.conversation_id
      ? String(quoteDraft.conversation_id)
      : null;

    if (!conversationId) {
      continue;
    }

    const summary = quoteDraftsByConversation.get(conversationId) ?? {
      changesRequested: 0,
      draft: 0,
      ready: 0,
      sent: 0,
      total: 0,
    };
    const status = String(quoteDraft.status);

    summary.total += 1;

    if (status === "changes_requested") {
      summary.changesRequested += 1;
    } else if (status === "ready") {
      summary.ready += 1;
    } else if (status === "sent") {
      summary.sent += 1;
    } else if (status !== "archived" && status !== "approved") {
      summary.draft += 1;
    }

    quoteDraftsByConversation.set(conversationId, summary);
  }

  const actionsByConversation = new Map<string, ActionSummary>();

  for (const action of actionsResult.data ?? []) {
    const conversationId = action.target_id ? String(action.target_id) : null;

    if (!conversationId) {
      continue;
    }

    const summary = actionsByConversation.get(conversationId) ?? {
      latestActionStatus: null,
      latestActionType: null,
      pendingApprovalCount: 0,
      approvedActionCount: 0,
      activeActionTypes: [],
      completedActionTypes: [],
    };
    const type = String(action.type);
    const status = String(action.status);
    const isLegacyReplyPlanningAction =
      type === "ask_missing_info" || type === "schedule_follow_up";

    if (isLegacyReplyPlanningAction && status !== "completed") {
      continue;
    }

    if (!summary.latestActionType) {
      summary.latestActionType = type;
      summary.latestActionStatus = status;
    }

    if (status === "pending_approval") {
      summary.pendingApprovalCount += 1;
    }

    if (status === "approved") {
      summary.approvedActionCount += 1;
    }

    if (["pending_approval", "approved", "executing"].includes(status)) {
      summary.activeActionTypes.push(type);
    }

    if (status === "completed") {
      summary.completedActionTypes.push(type);
    }

    actionsByConversation.set(conversationId, summary);
  }

  return (conversations ?? []).map((conversation) => {
    const latestMessage = latestMessageByConversation.get(
      String(conversation.id),
    );
    const originalInquiry =
      originalInquiryByConversation.get(String(conversation.id)) ??
      earliestMessageByConversation.get(String(conversation.id));
    const lead = leadsById.get(String(conversation.lead_id));
    const actionSummary = actionsByConversation.get(
      String(conversation.id),
    ) ?? {
      approvedActionCount: 0,
      activeActionTypes: [],
      completedActionTypes: [],
      latestActionStatus: null,
      latestActionType: null,
      pendingApprovalCount: 0,
    };
    const status = String(conversation.status);
    const latestDirection = latestMessage?.direction
      ? String(latestMessage.direction)
      : null;
    const facts = factsByConversation.get(String(conversation.id)) ?? null;
    const quoteDraftSummary = quoteDraftsByConversation.get(
      String(conversation.id),
    ) ?? {
      changesRequested: 0,
      draft: 0,
      ready: 0,
      sent: 0,
      total: 0,
    };
    const quoteDraftCount = quoteDraftSummary.total;
    const activeActionTypes = [...new Set(actionSummary.activeActionTypes)];
    const completedActionTypes = [
      ...new Set(actionSummary.completedActionTypes),
    ];
    const { nextActionLabel, workflowBucket } = deriveConversationWorkflow({
      activeActionTypes,
      approvedActionCount: actionSummary.approvedActionCount,
      completedActionTypes,
      facts,
      latestDirection,
      leadPriority: lead?.priority ?? null,
      pendingApprovalCount: actionSummary.pendingApprovalCount,
      quoteDraftSummary,
      status,
    });

    return {
      id: String(conversation.id),
      status,
      originalInquiryAt: originalInquiry?.received_at
        ? String(originalInquiry.received_at)
        : originalInquiry?.created_at
          ? String(originalInquiry.created_at)
          : conversation.created_at
            ? String(conversation.created_at)
            : null,
      originalInquiryBody: originalInquiry?.body_text
        ? String(originalInquiry.body_text)
        : latestMessage?.body_text
          ? String(latestMessage.body_text)
          : null,
      lastMessageAt: conversation.last_message_at
        ? String(conversation.last_message_at)
        : null,
      contactName: contactsById.get(String(conversation.contact_id)) ?? null,
      leadTitle: lead?.title ?? null,
      leadPriority: lead?.priority ?? null,
      leadNextStep: lead?.nextStep ?? null,
      leadServiceType: lead?.serviceType ?? null,
      latestSubject: latestMessage?.subject
        ? String(latestMessage.subject)
        : null,
      latestBody: latestMessage?.body_text
        ? String(latestMessage.body_text)
        : null,
      latestDirection,
      latestActionType: actionSummary.latestActionType,
      latestActionStatus: actionSummary.latestActionStatus,
      pendingApprovalCount: actionSummary.pendingApprovalCount,
      approvedActionCount: actionSummary.approvedActionCount,
      activeActionTypes,
      completedActionTypes,
      inquiryFacts: facts,
      quoteDraftCount,
      nextActionLabel,
      workflowBucket,
    };
  }) satisfies ConversationListItem[];
}

export async function getSkippedEmailSummaries(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 30,
): Promise<SkippedEmailSummaries> {
  const last24HoursStart = skippedEmailLast24HoursStart();
  const [itemsResult, countResult] = await Promise.all([
    supabase
      .from("events")
      .select("id,source,payload,processed_at,created_at")
      .eq("workspace_id", workspaceId)
      .eq("type", "inbound.email.received")
      .eq("status", "processed")
      .contains("payload", { stage: "observed" })
      .order("processed_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("type", "inbound.email.received")
      .eq("status", "processed")
      .contains("payload", { stage: "observed" })
      .gte("processed_at", last24HoursStart),
  ]);

  const { data, error } = itemsResult;

  if (error) {
    throw new Error(`Unable to load skipped email summaries: ${error.message}`);
  }

  if (countResult.error) {
    throw new Error(
      `Unable to count recent skipped email summaries: ${countResult.error.message}`,
    );
  }

  let replyEvents: SkippedEmailReplyEventRow[] = [];

  if ((data ?? []).length > 0) {
    const { data: replyEventRows, error: replyEventsError } = await supabase
      .from("events")
      .select("id,payload,processed_at,created_at")
      .eq("workspace_id", workspaceId)
      .eq("type", "outbound.filtered_email.reply_sent")
      .eq("status", "processed")
      .order("processed_at", { ascending: false, nullsFirst: false })
      .limit(500);

    if (replyEventsError) {
      throw new Error(
        `Unable to load skipped email reply logs: ${replyEventsError.message}`,
      );
    }

    replyEvents = replyEventRows ?? [];
  }

  return {
    items: buildSkippedEmailSummaryItems(
      (data ?? []) as SkippedEmailEventRow[],
      replyEvents,
    ),
    last24HoursCount: countResult.count ?? 0,
  };
}

export async function getSkippedEmailLast24HoursCount(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("type", "inbound.email.received")
    .eq("status", "processed")
    .contains("payload", { stage: "observed" })
    .gte("processed_at", skippedEmailLast24HoursStart());

  if (error) {
    throw new Error(
      `Unable to count recent skipped email summaries: ${error.message}`,
    );
  }

  return count ?? 0;
}

export async function getConversationWorkflowCounts(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ConversationWorkflowCounts> {
  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("id,status,lead_id")
    .eq("workspace_id", workspaceId)
    .limit(500);

  if (error) {
    throw new Error(`Unable to load conversation counts: ${error.message}`);
  }

  const conversationIds = uniqueIds(
    (conversations ?? []).map((conversation) => String(conversation.id)),
  );
  const leadIds = uniqueIds(
    (conversations ?? []).map((conversation) =>
      String(conversation.lead_id ?? ""),
    ),
  );

  const [
    messagesResult,
    leadsResult,
    actionsResult,
    factsResult,
    quoteDraftsResult,
  ] = await Promise.all([
    conversationIds.length > 0
      ? supabase
          .from("messages")
          .select("conversation_id,direction,created_at")
          .eq("workspace_id", workspaceId)
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(LIST_MESSAGE_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? supabase
          .from("leads")
          .select("id,priority")
          .eq("workspace_id", workspaceId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("actions")
          .select("target_id,type,status,created_at")
          .eq("workspace_id", workspaceId)
          .eq("target_type", "conversation")
          .in("target_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(LIST_ACTION_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("inquiry_facts")
          .select("conversation_id,fit,missing_info")
          .eq("workspace_id", workspaceId)
          .in("conversation_id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("quote_drafts")
          .select("conversation_id,status")
          .eq("workspace_id", workspaceId)
          .in("conversation_id", conversationIds)
          .limit(LIST_QUOTE_DRAFT_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (messagesResult.error) {
    throw new Error(
      `Unable to load conversation message counts: ${messagesResult.error.message}`,
    );
  }

  if (leadsResult.error) {
    throw new Error(
      `Unable to load conversation lead counts: ${leadsResult.error.message}`,
    );
  }

  if (actionsResult.error) {
    throw new Error(
      `Unable to load conversation action counts: ${actionsResult.error.message}`,
    );
  }

  if (factsResult.error) {
    throw new Error(
      `Unable to load conversation fact counts: ${factsResult.error.message}`,
    );
  }

  if (quoteDraftsResult.error) {
    throw new Error(
      `Unable to load conversation quote counts: ${quoteDraftsResult.error.message}`,
    );
  }

  const latestDirectionByConversation = new Map<string, string>();

  for (const message of messagesResult.data ?? []) {
    const conversationId = String(message.conversation_id);

    if (!latestDirectionByConversation.has(conversationId)) {
      latestDirectionByConversation.set(
        conversationId,
        String(message.direction),
      );
    }
  }

  const leadPriorityById = new Map(
    (leadsResult.data ?? []).map((lead) => [
      String(lead.id),
      lead.priority ? String(lead.priority) : null,
    ]),
  );
  const factsByConversation = new Map<string, ConversationFactsSummary>(
    (factsResult.data ?? []).map((facts) => [
      String(facts.conversation_id),
      {
        fit: facts.fit ? String(facts.fit) : "needs_review",
        missingInfo: Array.isArray(facts.missing_info)
          ? facts.missing_info
              .map((item) => (typeof item === "string" ? item.trim() : null))
              .filter((item): item is string => Boolean(item))
          : [],
      },
    ]),
  );
  const quoteDraftsByConversation = new Map<string, QuoteDraftSummary>();

  for (const quoteDraft of quoteDraftsResult.data ?? []) {
    const conversationId = quoteDraft.conversation_id
      ? String(quoteDraft.conversation_id)
      : null;

    if (!conversationId) {
      continue;
    }

    const summary = quoteDraftsByConversation.get(conversationId) ?? {
      changesRequested: 0,
      draft: 0,
      ready: 0,
      sent: 0,
      total: 0,
    };
    const status = String(quoteDraft.status);

    summary.total += 1;

    if (status === "changes_requested") {
      summary.changesRequested += 1;
    } else if (status === "ready") {
      summary.ready += 1;
    } else if (status === "sent") {
      summary.sent += 1;
    } else if (status !== "archived" && status !== "approved") {
      summary.draft += 1;
    }

    quoteDraftsByConversation.set(conversationId, summary);
  }

  const actionsByConversation = new Map<string, ActionSummary>();

  for (const action of actionsResult.data ?? []) {
    const conversationId = action.target_id ? String(action.target_id) : null;

    if (!conversationId) {
      continue;
    }

    const summary = actionsByConversation.get(conversationId) ?? {
      activeActionTypes: [],
      approvedActionCount: 0,
      completedActionTypes: [],
      latestActionStatus: null,
      latestActionType: null,
      pendingApprovalCount: 0,
    };
    const type = String(action.type);
    const status = String(action.status);
    const isLegacyReplyPlanningAction =
      type === "ask_missing_info" || type === "schedule_follow_up";

    if (isLegacyReplyPlanningAction && status !== "completed") {
      continue;
    }

    if (!summary.latestActionType) {
      summary.latestActionType = type;
      summary.latestActionStatus = status;
    }

    if (status === "pending_approval") {
      summary.pendingApprovalCount += 1;
    }

    if (status === "approved") {
      summary.approvedActionCount += 1;
    }

    if (["pending_approval", "approved", "executing"].includes(status)) {
      summary.activeActionTypes.push(type);
    }

    if (status === "completed") {
      summary.completedActionTypes.push(type);
    }

    actionsByConversation.set(conversationId, summary);
  }

  const counts: ConversationWorkflowCounts = {
    awaitingCustomer: 0,
    missingInfo: 0,
    needsReply: 0,
    needsReview: 0,
    open: 0,
    readyToQuote: 0,
    resolved: 0,
    siteVisitNeeded: 0,
    total: conversations?.length ?? 0,
  };

  for (const conversation of conversations ?? []) {
    const conversationId = String(conversation.id);
    const actionSummary = actionsByConversation.get(conversationId) ?? {
      activeActionTypes: [],
      approvedActionCount: 0,
      completedActionTypes: [],
      latestActionStatus: null,
      latestActionType: null,
      pendingApprovalCount: 0,
    };
    const quoteDraftSummary = quoteDraftsByConversation.get(conversationId) ?? {
      changesRequested: 0,
      draft: 0,
      ready: 0,
      sent: 0,
      total: 0,
    };
    const { workflowBucket } = deriveConversationWorkflow({
      activeActionTypes: [...new Set(actionSummary.activeActionTypes)],
      approvedActionCount: actionSummary.approvedActionCount,
      completedActionTypes: [...new Set(actionSummary.completedActionTypes)],
      facts: factsByConversation.get(conversationId) ?? null,
      latestDirection:
        latestDirectionByConversation.get(conversationId) ?? null,
      leadPriority: conversation.lead_id
        ? (leadPriorityById.get(String(conversation.lead_id)) ?? null)
        : null,
      pendingApprovalCount: actionSummary.pendingApprovalCount,
      quoteDraftSummary,
      status: String(conversation.status),
    });

    if (workflowBucket === "awaiting_customer") {
      counts.awaitingCustomer += 1;
    } else if (workflowBucket === "missing_info") {
      counts.missingInfo += 1;
    } else if (workflowBucket === "needs_reply") {
      counts.needsReply += 1;
    } else if (workflowBucket === "needs_review") {
      counts.needsReview += 1;
    } else if (workflowBucket === "ready_to_quote") {
      counts.readyToQuote += 1;
    } else if (workflowBucket === "resolved") {
      counts.resolved += 1;
    } else if (workflowBucket === "site_visit_needed") {
      counts.siteVisitNeeded += 1;
    } else {
      counts.open += 1;
    }
  }

  return counts;
}

function deriveConversationWorkflow({
  activeActionTypes,
  approvedActionCount,
  completedActionTypes,
  facts,
  latestDirection,
  leadPriority,
  pendingApprovalCount,
  quoteDraftSummary,
  status,
}: {
  activeActionTypes: string[];
  approvedActionCount: number;
  completedActionTypes: string[];
  facts: ConversationFactsSummary;
  latestDirection: string | null;
  leadPriority: string | null;
  pendingApprovalCount: number;
  quoteDraftSummary: QuoteDraftSummary;
  status: string;
}) {
  const hasMissingInfo = Boolean(facts?.missingInfo.length);
  const hasActiveQuoteDraft =
    quoteDraftSummary.draft > 0 || quoteDraftSummary.ready > 0;
  const hasQuoteChangeRequest = quoteDraftSummary.changesRequested > 0;
  const hasSentQuoteDraft = quoteDraftSummary.sent > 0;
  const hasCompletedReply =
    status === "replied" ||
    latestDirection === "outbound" ||
    completedActionTypes.includes("draft_reply") ||
    completedActionTypes.includes("send_outbound_message");
  const hasSiteVisitAction = [
    ...activeActionTypes,
    ...completedActionTypes,
  ].includes("book_site_visit");
  const hasQuoteAction = [
    ...activeActionTypes,
    ...completedActionTypes,
  ].includes("create_quote_draft");
  const isAwaitingCustomer =
    (hasCompletedReply && status !== "resolved") ||
    completedActionTypes.includes("ask_missing_info") ||
    completedActionTypes.includes("schedule_follow_up");
  const workflowBucket =
    status === "resolved"
      ? "resolved"
      : leadPriority === "high"
        ? "needs_review"
        : hasQuoteChangeRequest
          ? "ready_to_quote"
        : isAwaitingCustomer || hasSentQuoteDraft
          ? "awaiting_customer"
          : hasMissingInfo
            ? "missing_info"
            : pendingApprovalCount > 0 ||
                status === "reply_drafted" ||
                latestDirection === "inbound"
              ? "needs_reply"
              : hasSiteVisitAction
                ? "site_visit_needed"
                : hasQuoteAction || hasActiveQuoteDraft
                  ? "ready_to_quote"
                  : facts?.fit === "needs_review"
                    ? "needs_review"
                    : "open";
  const nextActionLabel =
    leadPriority === "high"
      ? "Profile check"
      : hasQuoteChangeRequest
        ? "Review quote changes"
      : isAwaitingCustomer
        ? "Awaiting customer"
        : pendingApprovalCount > 0
          ? "Needs approval"
          : hasMissingInfo
            ? "Missing info"
            : approvedActionCount > 0
              ? "Ready to record"
              : hasSiteVisitAction
                ? "Site visit"
                : hasQuoteAction || hasActiveQuoteDraft
                  ? "Ready to quote"
                  : hasSentQuoteDraft
                    ? "Quote sent"
                    : status === "reply_drafted"
                      ? "Review draft"
                      : status === "resolved"
                        ? "Resolved"
                        : latestDirection === "inbound"
                          ? "Needs reply"
                          : "Open";

  return {
    nextActionLabel,
    workflowBucket,
  };
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function getContactProfile(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<ContactProfile | null> {
  const { data: contact, error } = await supabase
    .from("contacts")
    .select(
      "id,name,email,phone,company,contact_type,address,source,notes,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load contact profile: ${error.message}`);
  }

  if (!contact) {
    return null;
  }

  const [leads, conversations, messages, aiRuns, quoteDrafts] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id,title,status,priority,service_type,next_step,updated_at")
        .eq("workspace_id", workspaceId)
        .eq("contact_id", contactId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("conversations")
        .select("id,status,last_message_at,lead_id")
        .eq("workspace_id", workspaceId)
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("messages")
        .select(
          "id,conversation_id,direction,subject,body_text,created_at,received_at,sent_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("ai_runs")
        .select(
          "id,task_type,status,provider,model,output,actual_cost,created_at",
        )
        .eq("workspace_id", workspaceId)
        .contains("input_refs", { contactId })
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("quote_drafts")
        .select(
          "id,title,status,line_items,notes,conversation_id,lead_id,updated_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("contact_id", contactId)
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

  if (leads.error) {
    throw new Error(`Unable to load contact leads: ${leads.error.message}`);
  }

  if (conversations.error) {
    throw new Error(
      `Unable to load contact conversations: ${conversations.error.message}`,
    );
  }

  if (messages.error) {
    throw new Error(
      `Unable to load contact messages: ${messages.error.message}`,
    );
  }

  if (aiRuns.error) {
    throw new Error(`Unable to load contact AI runs: ${aiRuns.error.message}`);
  }

  if (quoteDrafts.error) {
    throw new Error(
      `Unable to load contact quote drafts: ${quoteDrafts.error.message}`,
    );
  }

  const leadIds = uniqueIds((leads.data ?? []).map((lead) => String(lead.id)));
  const conversationIds = uniqueIds(
    (conversations.data ?? []).map((conversation) => String(conversation.id)),
  );
  const messageIds = uniqueIds(
    (messages.data ?? []).map((message) => String(message.id)),
  );
  const aiRunIds = uniqueIds((aiRuns.data ?? []).map((run) => String(run.id)));
  const quoteDraftIds = uniqueIds(
    (quoteDrafts.data ?? []).map((quoteDraft) => String(quoteDraft.id)),
  );
  const leadTitlesById = new Map(
    (leads.data ?? []).map((lead) => [String(lead.id), String(lead.title)]),
  );

  const actions =
    conversationIds.length > 0
      ? await supabase
          .from("actions")
          .select("id,type,status,input,created_at")
          .eq("workspace_id", workspaceId)
          .eq("target_type", "conversation")
          .in("target_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(50)
      : { data: [], error: null };

  if (actions.error) {
    throw new Error(`Unable to load contact actions: ${actions.error.message}`);
  }

  const actionIds = uniqueIds(
    (actions.data ?? []).map((action) => String(action.id)),
  );
  const entityIds = uniqueIds([
    contactId,
    ...leadIds,
    ...conversationIds,
    ...messageIds,
    ...aiRunIds,
    ...actionIds,
    ...quoteDraftIds,
  ]);

  const auditLogs =
    entityIds.length > 0
      ? await supabase
          .from("audit_logs")
          .select("id,action,actor_type,entity_type,created_at")
          .eq("workspace_id", workspaceId)
          .in("entity_id", entityIds)
          .order("created_at", { ascending: false })
          .limit(30)
      : { data: [], error: null };

  if (auditLogs.error) {
    throw new Error(
      `Unable to load contact audit logs: ${auditLogs.error.message}`,
    );
  }

  return {
    contact: {
      id: String(contact.id),
      name: contact.name ? String(contact.name) : null,
      email: contact.email ? String(contact.email) : null,
      phone: contact.phone ? String(contact.phone) : null,
      company: contact.company ? String(contact.company) : null,
      contactType: contact.contact_type
        ? String(contact.contact_type)
        : "client",
      address: contact.address ? String(contact.address) : null,
      source: contact.source ? String(contact.source) : null,
      notes: contact.notes ? String(contact.notes) : null,
      updatedAt: String(contact.updated_at),
    },
    counts: {
      leads: leads.data?.length ?? 0,
      conversations: conversations.data?.length ?? 0,
      messages: messages.data?.length ?? 0,
      actions: actions.data?.length ?? 0,
      quoteDrafts: quoteDrafts.data?.length ?? 0,
    },
    leads: (leads.data ?? []).map((lead) => ({
      id: String(lead.id),
      title: String(lead.title),
      status: String(lead.status),
      priority: String(lead.priority),
      serviceType: lead.service_type ? String(lead.service_type) : null,
      nextStep: lead.next_step ? String(lead.next_step) : null,
      updatedAt: String(lead.updated_at),
    })),
    conversations: (conversations.data ?? []).map((conversation) => ({
      id: String(conversation.id),
      status: String(conversation.status),
      leadTitle: conversation.lead_id
        ? (leadTitlesById.get(String(conversation.lead_id)) ?? null)
        : null,
      lastMessageAt: conversation.last_message_at
        ? String(conversation.last_message_at)
        : null,
    })),
    messages: (messages.data ?? []).map((message) => ({
      id: String(message.id),
      conversationId: message.conversation_id
        ? String(message.conversation_id)
        : null,
      direction: String(message.direction),
      subject: message.subject ? String(message.subject) : null,
      bodyText: message.body_text ? String(message.body_text) : null,
      createdAt: String(message.created_at),
      receivedAt: message.received_at ? String(message.received_at) : null,
      sentAt: message.sent_at ? String(message.sent_at) : null,
    })),
    aiRuns: (aiRuns.data ?? []).map((run) => ({
      id: String(run.id),
      taskType: String(run.task_type),
      status: String(run.status),
      provider: String(run.provider),
      model: String(run.model),
      output: objectRecord(run.output),
      actualCost:
        run.actual_cost === null || run.actual_cost === undefined
          ? null
          : String(run.actual_cost),
      createdAt: String(run.created_at),
    })),
    actions: (actions.data ?? []).map((action) => ({
      id: String(action.id),
      type: String(action.type),
      status: String(action.status),
      input: objectRecord(action.input),
      createdAt: String(action.created_at),
    })),
    quoteDrafts: (quoteDrafts.data ?? []).map((quoteDraft) => ({
      id: String(quoteDraft.id),
      title: String(quoteDraft.title),
      status: String(quoteDraft.status),
      lineItemCount: jsonArray(quoteDraft.line_items).length,
      notes: textValue(quoteDraft.notes),
      conversationId: quoteDraft.conversation_id
        ? String(quoteDraft.conversation_id)
        : null,
      leadTitle: quoteDraft.lead_id
        ? (leadTitlesById.get(String(quoteDraft.lead_id)) ?? null)
        : null,
      updatedAt: String(quoteDraft.updated_at),
    })),
    auditLogs: (auditLogs.data ?? []).map((log) => ({
      id: String(log.id),
      action: String(log.action),
      actorType: String(log.actor_type),
      entityType: String(log.entity_type),
      createdAt: String(log.created_at),
    })),
  };
}

export async function getQuoteDraftList(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QuoteDraftListItem[]> {
  const { data: quoteDrafts, error } = await supabase
    .from("quote_drafts")
    .select(
      "id,title,status,line_items,notes,metadata,contact_id,lead_id,conversation_id,created_at,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Unable to load quote drafts: ${error.message}`);
  }

  const contactIds = uniqueIds(
    (quoteDrafts ?? []).map((quoteDraft) =>
      quoteDraft.contact_id ? String(quoteDraft.contact_id) : null,
    ),
  );
  const leadIds = uniqueIds(
    (quoteDrafts ?? []).map((quoteDraft) =>
      quoteDraft.lead_id ? String(quoteDraft.lead_id) : null,
    ),
  );
  const conversationIds = uniqueIds(
    (quoteDrafts ?? []).map((quoteDraft) =>
      quoteDraft.conversation_id ? String(quoteDraft.conversation_id) : null,
    ),
  );

  const [contacts, leads, conversations, inquiryFacts] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from("contacts")
          .select("id,name,email,phone,company,address")
          .eq("workspace_id", workspaceId)
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? supabase
          .from("leads")
          .select("id,title,status,service_type,next_step")
          .eq("workspace_id", workspaceId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("conversations")
          .select("id,status,last_message_at")
          .eq("workspace_id", workspaceId)
          .in("id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("inquiry_facts")
          .select("conversation_id,job_type,address,preferred_time,budget")
          .eq("workspace_id", workspaceId)
          .in("conversation_id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contacts.error) {
    throw new Error(`Unable to load quote contacts: ${contacts.error.message}`);
  }

  if (leads.error) {
    throw new Error(`Unable to load quote leads: ${leads.error.message}`);
  }

  if (conversations.error) {
    throw new Error(
      `Unable to load quote conversations: ${conversations.error.message}`,
    );
  }

  if (inquiryFacts.error) {
    throw new Error(
      `Unable to load quote inquiry facts: ${inquiryFacts.error.message}`,
    );
  }

  const contactsById = new Map(
    (contacts.data ?? []).map((contact) => [
      String(contact.id),
      {
        company: textValue(contact.company),
        email: textValue(contact.email),
        id: String(contact.id),
        name: textValue(contact.name),
        phone: textValue(contact.phone),
        address: textValue(contact.address),
      },
    ]),
  );
  const leadsById = new Map(
    (leads.data ?? []).map((lead) => [
      String(lead.id),
      {
        id: String(lead.id),
        nextStep: textValue(lead.next_step),
        serviceType: textValue(lead.service_type),
        status: String(lead.status),
        title: String(lead.title),
      },
    ]),
  );
  const conversationsById = new Map(
    (conversations.data ?? []).map((conversation) => [
      String(conversation.id),
      {
        id: String(conversation.id),
        lastMessageAt: conversation.last_message_at
          ? String(conversation.last_message_at)
          : null,
        status: String(conversation.status),
      },
    ]),
  );
  const factsByConversationId = new Map(
    (inquiryFacts.data ?? []).map((facts) => [
      String(facts.conversation_id),
      {
        address: textValue(facts.address),
        budget: textValue(facts.budget),
        jobType: textValue(facts.job_type),
        preferredTime: textValue(facts.preferred_time),
      },
    ]),
  );

  return (quoteDrafts ?? []).map((quoteDraft) => {
    const contactId = quoteDraft.contact_id
      ? String(quoteDraft.contact_id)
      : null;
    const leadId = quoteDraft.lead_id ? String(quoteDraft.lead_id) : null;
    const conversationId = quoteDraft.conversation_id
      ? String(quoteDraft.conversation_id)
      : null;
    const lineItems = jsonArray(quoteDraft.line_items);

    return {
      id: String(quoteDraft.id),
      title: String(quoteDraft.title),
      status: String(quoteDraft.status),
      lineItems,
      lineItemCount: lineItems.length,
      notes: textValue(quoteDraft.notes),
      metadata: objectRecord(quoteDraft.metadata),
      createdAt: String(quoteDraft.created_at),
      updatedAt: String(quoteDraft.updated_at),
      contact: contactId ? (contactsById.get(contactId) ?? null) : null,
      lead: leadId ? (leadsById.get(leadId) ?? null) : null,
      conversation: conversationId
        ? (conversationsById.get(conversationId) ?? null)
        : null,
      inquiryFacts: conversationId
        ? (factsByConversationId.get(conversationId) ?? null)
        : null,
    };
  }) satisfies QuoteDraftListItem[];
}

export async function getQuoteDraftProfile(
  supabase: SupabaseClient,
  workspaceId: string,
  quoteDraftId: string,
): Promise<QuoteDraftProfile | null> {
  const { data: quoteDraft, error } = await supabase
    .from("quote_drafts")
    .select(
      "id,title,status,line_items,notes,metadata,contact_id,lead_id,conversation_id,created_at,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load quote draft: ${error.message}`);
  }

  if (!quoteDraft) {
    return null;
  }

  const contactId = quoteDraft.contact_id
    ? String(quoteDraft.contact_id)
    : null;
  const leadId = quoteDraft.lead_id ? String(quoteDraft.lead_id) : null;
  const conversationId = quoteDraft.conversation_id
    ? String(quoteDraft.conversation_id)
    : null;

  const [contact, lead, conversation, inquiryFacts, messages] =
    await Promise.all([
      contactId
        ? supabase
            .from("contacts")
            .select("id,name,email,phone,company,address")
            .eq("workspace_id", workspaceId)
            .eq("id", contactId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      leadId
        ? supabase
            .from("leads")
            .select("id,title,status,service_type,next_step")
            .eq("workspace_id", workspaceId)
            .eq("id", leadId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      conversationId
        ? supabase
            .from("conversations")
            .select("id,status,last_message_at")
            .eq("workspace_id", workspaceId)
            .eq("id", conversationId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      conversationId
        ? supabase
            .from("inquiry_facts")
            .select(
              "conversation_id,job_type,address,preferred_time,urgency,budget,fit,missing_info",
            )
            .eq("workspace_id", workspaceId)
            .eq("conversation_id", conversationId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      conversationId
        ? supabase
            .from("messages")
            .select(
              "id,direction,subject,body_text,metadata,created_at,received_at,sent_at",
            )
            .eq("workspace_id", workspaceId)
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (contact.error) {
    throw new Error(`Unable to load quote contact: ${contact.error.message}`);
  }

  if (lead.error) {
    throw new Error(`Unable to load quote lead: ${lead.error.message}`);
  }

  if (conversation.error) {
    throw new Error(
      `Unable to load quote conversation: ${conversation.error.message}`,
    );
  }

  if (inquiryFacts.error) {
    throw new Error(
      `Unable to load quote inquiry facts: ${inquiryFacts.error.message}`,
    );
  }

  if (messages.error) {
    throw new Error(`Unable to load quote messages: ${messages.error.message}`);
  }

  const entityIds = uniqueIds([
    quoteDraftId,
    contactId,
    leadId,
    conversationId,
  ]);
  const auditLogs =
    entityIds.length > 0
      ? await supabase
          .from("audit_logs")
          .select("id,action,actor_type,entity_type,created_at")
          .eq("workspace_id", workspaceId)
          .in("entity_id", entityIds)
          .order("created_at", { ascending: false })
          .limit(30)
      : { data: [], error: null };

  if (auditLogs.error) {
    throw new Error(
      `Unable to load quote audit logs: ${auditLogs.error.message}`,
    );
  }

  const lineItems = jsonArray(quoteDraft.line_items);
  const quoteDraftItem: QuoteDraftListItem = {
    id: String(quoteDraft.id),
    title: String(quoteDraft.title),
    status: String(quoteDraft.status),
    lineItems,
    lineItemCount: lineItems.length,
    notes: textValue(quoteDraft.notes),
    metadata: objectRecord(quoteDraft.metadata),
    createdAt: String(quoteDraft.created_at),
    updatedAt: String(quoteDraft.updated_at),
    contact: contact.data
      ? {
          company: textValue(contact.data.company),
          email: textValue(contact.data.email),
          id: String(contact.data.id),
          name: textValue(contact.data.name),
          phone: textValue(contact.data.phone),
          address: textValue(contact.data.address),
        }
      : null,
    lead: lead.data
      ? {
          id: String(lead.data.id),
          nextStep: textValue(lead.data.next_step),
          serviceType: textValue(lead.data.service_type),
          status: String(lead.data.status),
          title: String(lead.data.title),
        }
      : null,
    conversation: conversation.data
      ? {
          id: String(conversation.data.id),
          lastMessageAt: conversation.data.last_message_at
            ? String(conversation.data.last_message_at)
            : null,
          status: String(conversation.data.status),
        }
      : null,
    inquiryFacts: inquiryFacts.data
      ? {
          address: textValue(inquiryFacts.data.address),
          budget: textValue(inquiryFacts.data.budget),
          jobType: textValue(inquiryFacts.data.job_type),
          preferredTime: textValue(inquiryFacts.data.preferred_time),
        }
      : null,
  };

  return {
    quoteDraft: quoteDraftItem,
    inquiryFacts: inquiryFacts.data
      ? {
          address: textValue(inquiryFacts.data.address),
          budget: textValue(inquiryFacts.data.budget),
          fit: textValue(inquiryFacts.data.fit),
          jobType: textValue(inquiryFacts.data.job_type),
          missingInfo: jsonArray(inquiryFacts.data.missing_info)
            .map((item) => textValue(item))
            .filter((item): item is string => Boolean(item)),
          preferredTime: textValue(inquiryFacts.data.preferred_time),
          urgency: textValue(inquiryFacts.data.urgency),
        }
      : null,
    messages: (messages.data ?? []).map((message) => ({
      id: String(message.id),
      direction: String(message.direction),
      subject: textValue(message.subject),
      bodyText: textValue(message.body_text),
      metadata: objectRecord(message.metadata),
      createdAt: String(message.created_at),
      receivedAt: message.received_at ? String(message.received_at) : null,
      sentAt: message.sent_at ? String(message.sent_at) : null,
    })),
    auditLogs: (auditLogs.data ?? []).map((log) => ({
      id: String(log.id),
      action: String(log.action),
      actorType: String(log.actor_type),
      entityType: String(log.entity_type),
      createdAt: String(log.created_at),
    })),
  };
}

export async function getConversationReview(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationReview | null> {
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("id,status,last_message_at,contact_id,lead_id,created_at")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load conversation: ${error.message}`);
  }

  if (!conversation) {
    return null;
  }

  const contactId = conversation.contact_id
    ? String(conversation.contact_id)
    : null;
  const leadId = conversation.lead_id ? String(conversation.lead_id) : null;

  const [messages, contact, lead, aiRuns, actions, quoteDrafts, inquiryFacts] =
    await Promise.all([
      supabase
        .from("messages")
        .select(
          "id,direction,channel_id,subject,body_text,metadata,created_at,received_at,sent_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(REVIEW_MESSAGE_LIMIT),
      contactId
        ? supabase
            .from("contacts")
            .select("id,name,email,phone,company,contact_type,address,notes")
            .eq("workspace_id", workspaceId)
            .eq("id", contactId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      leadId
        ? supabase
            .from("leads")
            .select(
              "id,title,description,status,priority,source,service_type,next_step,estimated_value,created_at,updated_at",
            )
            .eq("workspace_id", workspaceId)
            .eq("id", leadId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("ai_runs")
        .select(
          "id,task_type,status,provider,model,output,usage,actual_cost,created_at,completed_at",
        )
        .eq("workspace_id", workspaceId)
        .contains("input_refs", { conversationId })
        .order("created_at", { ascending: false })
        .limit(REVIEW_AI_RUN_LIMIT),
      supabase
        .from("actions")
        .select(
          "id,type,status,input,result,created_at,approved_at,executed_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("target_type", "conversation")
        .eq("target_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(REVIEW_ACTION_LIMIT),
      supabase
        .from("quote_drafts")
        .select(
          "id,title,status,line_items,notes,metadata,created_at,updated_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(REVIEW_QUOTE_DRAFT_LIMIT),
      supabase
        .from("inquiry_facts")
        .select(
          "id,source_ai_run_id,job_type,address,preferred_time,urgency,budget,fit,missing_info,source,edited_by_user_id,metadata,created_at,updated_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", conversationId)
        .maybeSingle(),
    ]);

  if (messages.error) {
    throw new Error(`Unable to load messages: ${messages.error.message}`);
  }

  if (contact.error) {
    throw new Error(`Unable to load contact profile: ${contact.error.message}`);
  }

  if (lead.error) {
    throw new Error(`Unable to load lead: ${lead.error.message}`);
  }

  if (aiRuns.error) {
    throw new Error(`Unable to load AI runs: ${aiRuns.error.message}`);
  }

  if (actions.error) {
    throw new Error(`Unable to load actions: ${actions.error.message}`);
  }

  if (quoteDrafts.error) {
    throw new Error(
      `Unable to load quote drafts: ${quoteDrafts.error.message}`,
    );
  }

  if (inquiryFacts.error) {
    throw new Error(
      `Unable to load inquiry facts: ${inquiryFacts.error.message}`,
    );
  }

  const aiRunIds = uniqueIds((aiRuns.data ?? []).map((run) => String(run.id)));
  const actionIds = uniqueIds(
    (actions.data ?? []).map((action) => String(action.id)),
  );
  const messageIds = uniqueIds(
    (messages.data ?? []).map((message) => String(message.id)),
  );
  const quoteDraftIds = uniqueIds(
    (quoteDrafts.data ?? []).map((quoteDraft) => String(quoteDraft.id)),
  );
  const inquiryFactsId = inquiryFacts.data
    ? String(inquiryFacts.data.id)
    : null;
  const channelIds = uniqueIds(
    (messages.data ?? []).map((message) => String(message.channel_id ?? "")),
  );
  const entityIds = uniqueIds([
    conversationId,
    contactId,
    leadId,
    ...messageIds,
    ...aiRunIds,
    ...actionIds,
    ...quoteDraftIds,
    inquiryFactsId,
  ]);

  const [routeDecisions, usageEvents, auditLogs, channels] = await Promise.all([
    aiRunIds.length > 0
      ? supabase
          .from("model_route_decisions")
          .select(
            "id,ai_run_id,selected_provider,selected_model,fallback_used,decision_reason,budget_snapshot,created_at",
          )
          .eq("workspace_id", workspaceId)
          .in("ai_run_id", aiRunIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    aiRunIds.length > 0
      ? supabase
          .from("usage_events")
          .select(
            "id,ai_run_id,usage_type,quantity,customer_charge_snapshot,currency,created_at",
          )
          .eq("workspace_id", workspaceId)
          .in("ai_run_id", aiRunIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase
          .from("audit_logs")
          .select("id,action,actor_type,entity_type,created_at")
          .eq("workspace_id", workspaceId)
          .in("entity_id", entityIds)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    channelIds.length > 0
      ? supabase
          .from("channels")
          .select("id,type,display_name")
          .eq("workspace_id", workspaceId)
          .in("id", channelIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (routeDecisions.error) {
    throw new Error(
      `Unable to load route decisions: ${routeDecisions.error.message}`,
    );
  }

  if (usageEvents.error) {
    throw new Error(
      `Unable to load usage events: ${usageEvents.error.message}`,
    );
  }

  if (auditLogs.error) {
    throw new Error(`Unable to load audit logs: ${auditLogs.error.message}`);
  }

  if (channels.error) {
    throw new Error(
      `Unable to load message channels: ${channels.error.message}`,
    );
  }

  const channelsById = new Map(
    (channels.data ?? []).map((channel) => [
      String(channel.id),
      {
        displayName: String(channel.display_name),
        type: String(channel.type),
      },
    ]),
  );

  return {
    conversation: {
      id: String(conversation.id),
      status: String(conversation.status),
      lastMessageAt: conversation.last_message_at
        ? String(conversation.last_message_at)
        : null,
      createdAt: String(conversation.created_at),
    },
    contact: contact.data
      ? {
          id: String(contact.data.id),
          name: contact.data.name ? String(contact.data.name) : null,
          email: contact.data.email ? String(contact.data.email) : null,
          phone: contact.data.phone ? String(contact.data.phone) : null,
          company: contact.data.company ? String(contact.data.company) : null,
          contactType: contact.data.contact_type
            ? String(contact.data.contact_type)
            : "client",
          address: contact.data.address ? String(contact.data.address) : null,
          notes: contact.data.notes ? String(contact.data.notes) : null,
        }
      : null,
    lead: lead.data
      ? {
          id: String(lead.data.id),
          title: String(lead.data.title),
          description: lead.data.description
            ? String(lead.data.description)
            : null,
          status: String(lead.data.status),
          priority: String(lead.data.priority),
          source: lead.data.source ? String(lead.data.source) : null,
          serviceType: lead.data.service_type
            ? String(lead.data.service_type)
            : null,
          nextStep: lead.data.next_step ? String(lead.data.next_step) : null,
          estimatedValue:
            lead.data.estimated_value === null ||
            lead.data.estimated_value === undefined
              ? null
              : String(lead.data.estimated_value),
          createdAt: String(lead.data.created_at),
          updatedAt: String(lead.data.updated_at),
        }
      : null,
    messages: [...(messages.data ?? [])]
      .sort(
        (first, second) =>
          new Date(String(first.created_at)).getTime() -
          new Date(String(second.created_at)).getTime(),
      )
      .map((message) => ({
        id: String(message.id),
        direction: String(message.direction),
        channelId: message.channel_id ? String(message.channel_id) : null,
        channelType: message.channel_id
          ? (channelsById.get(String(message.channel_id))?.type ?? null)
          : null,
        channelDisplayName: message.channel_id
          ? (channelsById.get(String(message.channel_id))?.displayName ?? null)
          : null,
        subject: message.subject ? String(message.subject) : null,
        bodyText: message.body_text ? String(message.body_text) : null,
        metadata: objectRecord(message.metadata),
        createdAt: String(message.created_at),
        receivedAt: message.received_at ? String(message.received_at) : null,
        sentAt: message.sent_at ? String(message.sent_at) : null,
      })),
    aiRuns: (aiRuns.data ?? []).map((run) => ({
      id: String(run.id),
      taskType: String(run.task_type),
      status: String(run.status),
      provider: String(run.provider),
      model: String(run.model),
      output: objectRecord(run.output),
      usage: objectRecord(run.usage),
      actualCost:
        run.actual_cost === null || run.actual_cost === undefined
          ? null
          : String(run.actual_cost),
      createdAt: String(run.created_at),
      completedAt: run.completed_at ? String(run.completed_at) : null,
    })),
    actions: (actions.data ?? []).map((action) => ({
      id: String(action.id),
      type: String(action.type),
      status: String(action.status),
      input: objectRecord(action.input),
      result: objectRecord(action.result),
      createdAt: String(action.created_at),
      approvedAt: action.approved_at ? String(action.approved_at) : null,
      executedAt: action.executed_at ? String(action.executed_at) : null,
    })),
    quoteDrafts: (quoteDrafts.data ?? []).map((quoteDraft) => ({
      id: String(quoteDraft.id),
      title: String(quoteDraft.title),
      status: String(quoteDraft.status),
      lineItems: Array.isArray(quoteDraft.line_items)
        ? quoteDraft.line_items
        : [],
      notes: quoteDraft.notes ? String(quoteDraft.notes) : null,
      metadata: objectRecord(quoteDraft.metadata),
      createdAt: String(quoteDraft.created_at),
      updatedAt: String(quoteDraft.updated_at),
    })),
    inquiryFacts: inquiryFacts.data
      ? {
          id: String(inquiryFacts.data.id),
          sourceAiRunId: inquiryFacts.data.source_ai_run_id
            ? String(inquiryFacts.data.source_ai_run_id)
            : null,
          jobType: inquiryFacts.data.job_type
            ? String(inquiryFacts.data.job_type)
            : null,
          address: inquiryFacts.data.address
            ? String(inquiryFacts.data.address)
            : null,
          preferredTime: inquiryFacts.data.preferred_time
            ? String(inquiryFacts.data.preferred_time)
            : null,
          urgency: String(inquiryFacts.data.urgency),
          budget: inquiryFacts.data.budget
            ? String(inquiryFacts.data.budget)
            : null,
          fit: String(inquiryFacts.data.fit),
          missingInfo: Array.isArray(inquiryFacts.data.missing_info)
            ? inquiryFacts.data.missing_info
                .map((item) => (typeof item === "string" ? item : null))
                .filter((item): item is string => Boolean(item))
            : [],
          source: String(inquiryFacts.data.source),
          editedByUserId: inquiryFacts.data.edited_by_user_id
            ? String(inquiryFacts.data.edited_by_user_id)
            : null,
          metadata: objectRecord(inquiryFacts.data.metadata),
          createdAt: String(inquiryFacts.data.created_at),
          updatedAt: String(inquiryFacts.data.updated_at),
        }
      : null,
    routeDecisions: (routeDecisions.data ?? []).map((decision) => ({
      id: String(decision.id),
      aiRunId: decision.ai_run_id ? String(decision.ai_run_id) : null,
      selectedProvider: String(decision.selected_provider),
      selectedModel: String(decision.selected_model),
      fallbackUsed: Boolean(decision.fallback_used),
      decisionReason: String(decision.decision_reason),
      budgetSnapshot: objectRecord(decision.budget_snapshot),
      createdAt: String(decision.created_at),
    })),
    usageEvents: (usageEvents.data ?? []).map((usage) => ({
      id: String(usage.id),
      aiRunId: usage.ai_run_id ? String(usage.ai_run_id) : null,
      usageType: String(usage.usage_type),
      quantity: String(usage.quantity),
      customerChargeSnapshot: String(usage.customer_charge_snapshot),
      currency: String(usage.currency),
      createdAt: String(usage.created_at),
    })),
    auditLogs: (auditLogs.data ?? []).map((log) => ({
      id: String(log.id),
      action: String(log.action),
      actorType: String(log.actor_type),
      entityType: String(log.entity_type),
      createdAt: String(log.created_at),
    })),
  };
}
