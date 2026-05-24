import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", [
  "owner",
  "admin",
  "operator",
  "viewer",
]);
export const eventStatus = pgEnum("event_status", [
  "pending",
  "processing",
  "processed",
  "failed",
]);
export const actionStatus = pgEnum("action_status", [
  "requested",
  "pending_approval",
  "approved",
  "executing",
  "completed",
  "failed",
  "cancelled",
]);
export const aiRunStatus = pgEnum("ai_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
  ...timestamps,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: workspaceRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceUserIdx: uniqueIndex("workspace_members_workspace_user_idx").on(
      table.workspaceId,
      table.userId,
    ),
  }),
);

export const businessProfiles = pgTable("business_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  businessName: text("business_name").notNull(),
  industry: text("industry"),
  description: text("description"),
  serviceArea: text("service_area"),
  toneOfVoice: text("tone_of_voice"),
  defaultReplyInstructions: text("default_reply_instructions"),
  ...timestamps,
});

export const workspacePolicies = pgTable(
  "workspace_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    policyType: text("policy_type").notNull(),
    settings: jsonb("settings").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    workspacePolicyIdx: uniqueIndex(
      "workspace_policies_workspace_policy_idx",
    ).on(table.workspaceId, table.policyType),
  }),
);

export const workspaceEntitlements = pgTable(
  "workspace_entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    entitlementKey: text("entitlement_key").notNull(),
    value: jsonb("value").notNull(),
    source: text("source").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    workspaceEntitlementIdx: uniqueIndex(
      "workspace_entitlements_workspace_key_idx",
    ).on(table.workspaceId, table.entitlementKey),
  }),
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    contactType: text("contact_type").notNull().default("client"),
    address: text("address"),
    source: text("source"),
    notes: text("notes"),
    tags: jsonb("tags").notNull().default([]),
    ...timestamps,
  },
  (table) => ({
    contactWorkspaceIdx: index("contacts_workspace_idx").on(table.workspaceId),
    contactWorkspaceTypeIdx: index("contacts_workspace_type_idx").on(
      table.workspaceId,
      table.contactType,
    ),
  }),
);

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  source: text("source"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("normal"),
  estimatedValue: numeric("estimated_value"),
  serviceType: text("service_type"),
  nextStep: text("next_step"),
  ...timestamps,
});

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    connectedByUserId: uuid("connected_by_user_id").references(() => users.id),
    provider: text("provider").notNull(),
    service: text("service").notNull(),
    connectionKey: text("connection_key").notNull(),
    accountEmail: text("account_email"),
    accountName: text("account_name"),
    externalAccountId: text("external_account_id"),
    status: text("status").notNull().default("not_connected"),
    scopes: jsonb("scopes").notNull().default([]),
    tokenSet: jsonb("token_set").notNull().default({}),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    integrationConnectionsWorkspaceIdx: index(
      "integration_connections_workspace_idx",
    ).on(table.workspaceId),
    integrationConnectionsWorkspaceProviderIdx: index(
      "integration_connections_workspace_provider_idx",
    ).on(table.workspaceId, table.provider, table.status),
    integrationConnectionsWorkspaceKeyIdx: uniqueIndex(
      "integration_connections_workspace_key_idx",
    ).on(table.workspaceId, table.provider, table.connectionKey),
  }),
);

export const integrationOauthStates = pgTable(
  "integration_oauth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    scopes: jsonb("scopes").notNull().default([]),
    redirectPath: text("redirect_path").notNull().default("/settings"),
    codeVerifier: text("code_verifier"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    integrationOauthStatesStateIdx: uniqueIndex(
      "integration_oauth_states_state_idx",
    ).on(table.stateHash),
    integrationOauthStatesWorkspaceIdx: index(
      "integration_oauth_states_workspace_idx",
    ).on(table.workspaceId, table.provider, table.expiresAt),
  }),
);

export const channels = pgTable("channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  integrationId: uuid("integration_id").references(
    () => integrationConnections.id,
  ),
  type: text("type").notNull(),
  displayName: text("display_name").notNull(),
  externalId: text("external_id"),
  status: text("status").notNull().default("active"),
  settings: jsonb("settings").notNull().default({}),
  ...timestamps,
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  channelId: uuid("channel_id").references(() => channels.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  leadId: uuid("lead_id").references(() => leads.id),
  externalThreadId: text("external_thread_id"),
  status: text("status").notNull().default("open"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  ...timestamps,
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  channelId: uuid("channel_id").references(() => channels.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  direction: text("direction").notNull(),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  externalMessageId: text("external_message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  storageBucket: text("storage_bucket").notNull(),
  storagePath: text("storage_path").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    type: text("type").notNull(),
    source: text("source").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: eventStatus("status").notNull().default("pending"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    eventIdempotencyIdx: uniqueIndex("events_workspace_idempotency_idx").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    eventsInboundObservedProcessedIdx: index(
      "events_inbound_observed_processed_idx",
    )
      .on(table.workspaceId, table.processedAt)
      .where(
        sql`${table.type} = 'inbound.email.received' and ${table.status} = 'processed' and ${table.payload} @> '{"stage":"observed"}'::jsonb`,
      ),
    eventsFilteredEmailReplyProcessedIdx: index(
      "events_filtered_email_reply_processed_idx",
    )
      .on(table.workspaceId, table.processedAt)
      .where(
        sql`${table.type} = 'outbound.filtered_email.reply_sent' and ${table.status} = 'processed'`,
      ),
  }),
);

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  eventId: uuid("event_id").references(() => events.id),
  workflowName: text("workflow_name").notNull(),
  status: text("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
});

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  userId: uuid("user_id").references(() => users.id),
  mode: text("mode").notNull(),
  taskType: text("task_type").notNull(),
  riskLevel: text("risk_level").notNull().default("low"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  modelRouteId: uuid("model_route_id"),
  status: aiRunStatus("status").notNull().default("queued"),
  inputRefs: jsonb("input_refs").notNull().default({}),
  output: jsonb("output").notNull().default({}),
  toolCalls: jsonb("tool_calls").notNull().default([]),
  usage: jsonb("usage").notNull().default({}),
  estimatedCost: numeric("estimated_cost"),
  actualCost: numeric("actual_cost"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const modelRoutes = pgTable("model_routes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id),
  name: text("name").notNull(),
  taskType: text("task_type").notNull(),
  riskLevel: text("risk_level").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  fallbackProvider: text("fallback_provider"),
  fallbackModel: text("fallback_model"),
  settings: jsonb("settings").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const modelRouteDecisions = pgTable("model_route_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  userId: uuid("user_id").references(() => users.id),
  aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
  taskType: text("task_type").notNull(),
  riskLevel: text("risk_level").notNull(),
  selectedProvider: text("selected_provider").notNull(),
  selectedModel: text("selected_model").notNull(),
  fallbackUsed: boolean("fallback_used").notNull().default(false),
  decisionReason: text("decision_reason").notNull(),
  budgetSnapshot: jsonb("budget_snapshot").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const actions = pgTable("actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  type: text("type").notNull(),
  status: actionStatus("status").notNull().default("requested"),
  requestedBy: text("requested_by").notNull(),
  requestedByAiRunId: uuid("requested_by_ai_run_id").references(
    () => aiRuns.id,
  ),
  approvalRequired: boolean("approval_required").notNull().default(true),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  input: jsonb("input").notNull().default({}),
  result: jsonb("result").notNull().default({}),
  policySnapshot: jsonb("policy_snapshot").notNull().default({}),
  error: text("error"),
  ...timestamps,
});

export const quoteDrafts = pgTable(
  "quote_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    sourceActionId: uuid("source_action_id").references(() => actions.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    lineItems: jsonb("line_items").notNull().default([]),
    notes: text("notes"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    quoteDraftWorkspaceIdx: index("quote_drafts_workspace_idx").on(
      table.workspaceId,
    ),
    quoteDraftConversationIdx: index("quote_drafts_conversation_idx").on(
      table.workspaceId,
      table.conversationId,
    ),
    quoteDraftLeadIdx: index("quote_drafts_lead_idx").on(
      table.workspaceId,
      table.leadId,
    ),
  }),
);

export const quoteApprovalLinks = pgTable(
  "quote_approval_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    quoteDraftId: uuid("quote_draft_id")
      .notNull()
      .references(() => quoteDrafts.id),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("active"),
    customerEmail: text("customer_email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    changesRequestedAt: timestamp("changes_requested_at", {
      withTimezone: true,
    }),
    lastChangeRequest: text("last_change_request"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    quoteApprovalLinkTokenHashIdx: uniqueIndex(
      "quote_approval_links_token_hash_idx",
    ).on(table.tokenHash),
    quoteApprovalLinkWorkspaceIdx: index(
      "quote_approval_links_workspace_idx",
    ).on(table.workspaceId),
    quoteApprovalLinkQuoteIdx: index("quote_approval_links_quote_idx").on(
      table.workspaceId,
      table.quoteDraftId,
    ),
    quoteApprovalLinkStatusIdx: index(
      "quote_approval_links_status_idx",
    ).on(table.workspaceId, table.status),
  }),
);

export const inquiryFacts = pgTable(
  "inquiry_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    sourceAiRunId: uuid("source_ai_run_id").references(() => aiRuns.id),
    jobType: text("job_type"),
    address: text("address"),
    preferredTime: text("preferred_time"),
    urgency: text("urgency").notNull().default("normal"),
    budget: text("budget"),
    fit: text("fit").notNull().default("needs_review"),
    missingInfo: jsonb("missing_info").notNull().default([]),
    source: text("source").notNull().default("ai"),
    editedByUserId: uuid("edited_by_user_id").references(() => users.id),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    inquiryFactsWorkspaceConversationIdx: uniqueIndex(
      "inquiry_facts_workspace_conversation_idx",
    ).on(table.workspaceId, table.conversationId),
    inquiryFactsLeadIdx: index("inquiry_facts_workspace_lead_idx").on(
      table.workspaceId,
      table.leadId,
    ),
  }),
);

export const assistantThreads = pgTable(
  "assistant_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id").references(() => users.id),
    title: text("title").notNull().default("Assistant thread"),
    status: text("status").notNull().default("active"),
    summary: text("summary"),
    summaryUpdatedAt: timestamp("summary_updated_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    assistantThreadsWorkspaceUserIdx: index(
      "assistant_threads_workspace_user_idx",
    ).on(table.workspaceId, table.userId, table.updatedAt),
    assistantThreadsWorkspaceStatusIdx: index(
      "assistant_threads_workspace_status_idx",
    ).on(table.workspaceId, table.status),
  }),
);

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => assistantThreads.id),
    userId: uuid("user_id").references(() => users.id),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    intent: text("intent"),
    provider: text("provider"),
    model: text("model"),
    toolCalls: jsonb("tool_calls").notNull().default([]),
    uiBlocks: jsonb("ui_blocks").notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    assistantMessagesThreadCreatedIdx: index(
      "assistant_messages_thread_created_idx",
    ).on(table.workspaceId, table.threadId, table.createdAt),
    assistantMessagesAiRunIdx: index("assistant_messages_ai_run_idx").on(
      table.workspaceId,
      table.aiRunId,
    ),
  }),
);

export const assistantMemories = pgTable(
  "assistant_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id").references(() => users.id),
    sourceThreadId: uuid("source_thread_id").references(
      () => assistantThreads.id,
    ),
    sourceMessageId: uuid("source_message_id").references(
      () => assistantMessages.id,
    ),
    memoryType: text("memory_type").notNull().default("preference"),
    content: text("content").notNull(),
    status: text("status").notNull().default("active"),
    confidence: numeric("confidence").notNull().default("1"),
    tags: jsonb("tags").notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    assistantMemoriesWorkspaceStatusIdx: index(
      "assistant_memories_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.updatedAt),
    assistantMemoriesSourceThreadIdx: index(
      "assistant_memories_source_thread_idx",
    ).on(table.workspaceId, table.sourceThreadId),
  }),
);

export const assistantPronunciations = pgTable(
  "assistant_pronunciations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    phrase: text("phrase").notNull(),
    normalizedPhrase: text("normalized_phrase").notNull(),
    pronunciationHint: text("pronunciation_hint"),
    category: text("category").notNull().default("other"),
    status: text("status").notNull().default("suggested"),
    source: text("source").notNull().default("manual"),
    aliases: jsonb("aliases").notNull().default([]),
    confidence: numeric("confidence").notNull().default("0"),
    importance: text("importance").notNull().default("medium"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    assistantPronunciationsWorkspacePhraseIdx: uniqueIndex(
      "assistant_pronunciations_workspace_phrase_idx",
    ).on(table.workspaceId, table.normalizedPhrase),
    assistantPronunciationsWorkspaceStatusIdx: index(
      "assistant_pronunciations_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.updatedAt),
    assistantPronunciationsWorkspaceCategoryIdx: index(
      "assistant_pronunciations_workspace_category_idx",
    ).on(table.workspaceId, table.category, table.status),
  }),
);

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  userId: uuid("user_id").references(() => users.id),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
  workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id),
  actionId: uuid("action_id").references(() => actions.id),
  provider: text("provider").notNull(),
  service: text("service").notNull(),
  model: text("model"),
  usageType: text("usage_type").notNull(),
  quantity: numeric("quantity").notNull(),
  unit: text("unit").notNull(),
  unitPriceSnapshot: numeric("unit_price_snapshot"),
  unitCostSnapshot: numeric("unit_cost_snapshot").notNull(),
  markupSnapshot: numeric("markup_snapshot").notNull(),
  currency: text("currency").notNull(),
  costSnapshot: numeric("cost_snapshot").notNull(),
  customerChargeSnapshot: numeric("customer_charge_snapshot").notNull(),
  providerUsageId: text("provider_usage_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const usageRollups = pgTable(
  "usage_rollups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id").references(() => users.id),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    provider: text("provider"),
    service: text("service").notNull(),
    model: text("model"),
    usageType: text("usage_type").notNull(),
    quantity: numeric("quantity").notNull(),
    cost: numeric("cost").notNull(),
    customerCharge: numeric("customer_charge").notNull(),
    currency: text("currency").notNull(),
    ...timestamps,
  },
  (table) => ({
    usageRollupPeriodIdx: index("usage_rollups_workspace_period_idx").on(
      table.workspaceId,
      table.periodStart,
      table.periodEnd,
    ),
  }),
);

export const pricingRules = pgTable("pricing_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id),
  planKey: text("plan_key"),
  service: text("service").notNull(),
  provider: text("provider"),
  model: text("model"),
  usageType: text("usage_type").notNull(),
  unit: text("unit").notNull(),
  unitCostSnapshot: numeric("unit_cost_snapshot"),
  markupType: text("markup_type").notNull(),
  markupValue: numeric("markup_value").notNull(),
  customerUnitPrice: numeric("customer_unit_price"),
  currency: text("currency").notNull().default("USD"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const workspaceBudgets = pgTable(
  "workspace_budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    period: text("period").notNull().default("monthly"),
    softLimit: numeric("soft_limit"),
    hardLimit: numeric("hard_limit"),
    currency: text("currency").notNull().default("USD"),
    settings: jsonb("settings").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    workspaceBudgetPeriodIdx: uniqueIndex(
      "workspace_budgets_workspace_period_idx",
    ).on(table.workspaceId, table.period),
  }),
);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
