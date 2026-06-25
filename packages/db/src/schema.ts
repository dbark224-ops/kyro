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
    normalizedEmail: text("normalized_email"),
    normalizedPhone: text("normalized_phone"),
    normalizedCompany: text("normalized_company"),
    contactType: text("contact_type").notNull().default("client"),
    lifecycleStage: text("lifecycle_stage").notNull().default("lead"),
    lifecycleSource: text("lifecycle_source").notNull().default("system"),
    lifecycleReason: text("lifecycle_reason"),
    lifecycleReviewedAt: timestamp("lifecycle_reviewed_at", {
      withTimezone: true,
    }),
    profileResolutionStatus: text("profile_resolution_status")
      .notNull()
      .default("clear"),
    profileResolutionReason: text("profile_resolution_reason"),
    profileConflictContactIds: jsonb("profile_conflict_contact_ids")
      .notNull()
      .default([]),
    mergedIntoContactId: uuid("merged_into_contact_id"),
    profileResolvedAt: timestamp("profile_resolved_at", {
      withTimezone: true,
    }),
    profileResolvedByUserId: uuid("profile_resolved_by_user_id").references(
      () => users.id,
    ),
    address: text("address"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    addressLocality: text("address_locality"),
    addressAdministrativeArea: text("address_administrative_area"),
    addressPostalCode: text("address_postal_code"),
    addressCountryCode: text("address_country_code"),
    addressLatitude: numeric("address_latitude", {
      precision: 12,
      scale: 8,
    }),
    addressLongitude: numeric("address_longitude", {
      precision: 12,
      scale: 8,
    }),
    addressPlaceId: text("address_place_id"),
    addressSource: text("address_source").notNull().default("manual"),
    addressValidationStatus: text("address_validation_status")
      .notNull()
      .default("unverified"),
    addressValidatedAt: timestamp("address_validated_at", {
      withTimezone: true,
    }),
    addressStructured: jsonb("address_structured").notNull().default({}),
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
    contactWorkspaceLifecycleIdx: index("contacts_workspace_lifecycle_idx").on(
      table.workspaceId,
      table.lifecycleStage,
      table.lifecycleSource,
    ),
    contactWorkspaceProfileResolutionIdx: index(
      "contacts_workspace_profile_resolution_idx",
    ).on(table.workspaceId, table.profileResolutionStatus),
    contactWorkspaceMergedIntoIdx: index("contacts_workspace_merged_into_idx")
      .on(table.workspaceId, table.mergedIntoContactId)
      .where(sql`${table.mergedIntoContactId} is not null`),
    contactWorkspaceNormalizedEmailIdx: index(
      "contacts_workspace_normalized_email_idx",
    )
      .on(table.workspaceId, table.normalizedEmail)
      .where(sql`${table.normalizedEmail} is not null`),
    contactWorkspaceNormalizedPhoneIdx: index(
      "contacts_workspace_normalized_phone_idx",
    )
      .on(table.workspaceId, table.normalizedPhone)
      .where(sql`${table.normalizedPhone} is not null`),
    contactWorkspaceNormalizedCompanyIdx: index(
      "contacts_workspace_normalized_company_idx",
    )
      .on(table.workspaceId, table.normalizedCompany)
      .where(sql`${table.normalizedCompany} is not null`),
    contactWorkspaceAddressPlaceIdx: index(
      "contacts_workspace_address_place_idx",
    )
      .on(table.workspaceId, table.addressPlaceId)
      .where(sql`${table.addressPlaceId} is not null`),
    contactWorkspaceAddressPostalIdx: index(
      "contacts_workspace_address_postal_idx",
    )
      .on(table.workspaceId, table.addressCountryCode, table.addressPostalCode)
      .where(sql`${table.addressPostalCode} is not null`),
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

export const workspacePhoneNumbers = pgTable(
  "workspace_phone_numbers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    provider: text("provider").notNull().default("twilio"),
    service: text("service").notNull().default("programmable_messaging"),
    phoneNumber: text("phone_number").notNull(),
    normalizedPhone: text("normalized_phone").notNull(),
    friendlyName: text("friendly_name"),
    providerPhoneNumberId: text("provider_phone_number_id"),
    countryCode: text("country_code"),
    region: text("region"),
    capabilities: jsonb("capabilities").notNull().default({}),
    status: text("status").notNull().default("active"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    assignmentSource: text("assignment_source")
      .notNull()
      .default("manual_pool"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    monthlyCostSnapshot: numeric("monthly_cost_snapshot")
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("USD"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    workspacePhoneNumbersPoolAvailableIdx: index(
      "workspace_phone_numbers_pool_available_idx",
    )
      .on(table.provider, table.countryCode, table.status, table.createdAt)
      .where(
        sql`${table.workspaceId} is null and ${table.status} in ('available', 'reserved')`,
      ),
    workspacePhoneNumbersWorkspaceStatusIdx: index(
      "workspace_phone_numbers_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.provider),
    workspacePhoneNumbersNormalizedIdx: index(
      "workspace_phone_numbers_normalized_idx",
    ).on(table.normalizedPhone, table.provider, table.status),
    workspacePhoneNumbersProviderIdIdx: uniqueIndex(
      "workspace_phone_numbers_provider_id_idx",
    )
      .on(table.provider, table.providerPhoneNumberId)
      .where(sql`${table.providerPhoneNumberId} is not null`),
    workspacePhoneNumbersWorkspaceNumberIdx: uniqueIndex(
      "workspace_phone_numbers_workspace_number_idx",
    )
      .on(table.workspaceId, table.normalizedPhone)
      .where(sql`${table.status} <> 'released'`),
    workspacePhoneNumbersPoolProviderNumberIdx: uniqueIndex(
      "workspace_phone_numbers_pool_provider_number_idx",
    )
      .on(table.provider, table.normalizedPhone)
      .where(sql`${table.workspaceId} is null and ${table.status} <> 'released'`),
  }),
);

export const smsRecipientPreferences = pgTable(
  "sms_recipient_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    phoneNumber: text("phone_number").notNull(),
    normalizedPhone: text("normalized_phone").notNull(),
    channelNumberId: uuid("channel_number_id").references(
      () => workspacePhoneNumbers.id,
    ),
    consentStatus: text("consent_status").notNull().default("unknown"),
    source: text("source").notNull().default("system"),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    optedInAt: timestamp("opted_in_at", { withTimezone: true }),
    optOutKeyword: text("opt_out_keyword"),
    consentNote: text("consent_note"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    smsRecipientPreferencesWorkspacePhoneIdx: uniqueIndex(
      "sms_recipient_preferences_workspace_phone_idx",
    ).on(table.workspaceId, table.normalizedPhone),
    smsRecipientPreferencesWorkspaceStatusIdx: index(
      "sms_recipient_preferences_workspace_status_idx",
    ).on(table.workspaceId, table.consentStatus, table.updatedAt),
    smsRecipientPreferencesContactIdx: index(
      "sms_recipient_preferences_contact_idx",
    )
      .on(table.workspaceId, table.contactId)
      .where(sql`${table.contactId} is not null`),
  }),
);

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

export const conversationTasks = pgTable(
  "conversation_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    messageId: uuid("message_id").references(() => messages.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    sourceActionId: uuid("source_action_id").references(() => actions.id),
    taskType: text("task_type").notNull().default("manual_task"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    conversationTasksWorkspaceStatusIdx: index(
      "conversation_tasks_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.dueAt),
    conversationTasksConversationIdx: index(
      "conversation_tasks_conversation_idx",
    ).on(table.workspaceId, table.conversationId, table.createdAt),
    conversationTasksMessageIdx: index("conversation_tasks_message_idx").on(
      table.workspaceId,
      table.messageId,
    ),
    conversationTasksAssigneeIdx: index("conversation_tasks_assignee_idx").on(
      table.workspaceId,
      table.assignedToUserId,
      table.status,
    ),
  }),
);

export const conversationAppointments = pgTable(
  "conversation_appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    messageId: uuid("message_id").references(() => messages.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    taskId: uuid("task_id").references(() => conversationTasks.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    sourceActionId: uuid("source_action_id").references(() => actions.id),
    appointmentType: text("appointment_type").notNull().default("site_visit"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("suggested"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    externalCalendarProvider: text("external_calendar_provider"),
    externalCalendarId: text("external_calendar_id"),
    externalEventId: text("external_event_id"),
    externalEventEtag: text("external_event_etag"),
    externalSyncStatus: text("external_sync_status")
      .notNull()
      .default("not_synced"),
    externalSyncedAt: timestamp("external_synced_at", { withTimezone: true }),
    externalSyncError: text("external_sync_error"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    conversationAppointmentsWorkspaceStatusIdx: index(
      "conversation_appointments_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.startsAt),
    conversationAppointmentsConversationIdx: index(
      "conversation_appointments_conversation_idx",
    ).on(table.workspaceId, table.conversationId, table.createdAt),
    conversationAppointmentsTaskIdx: index(
      "conversation_appointments_task_idx",
    ).on(table.workspaceId, table.taskId),
    conversationAppointmentsExternalSyncIdx: index(
      "conversation_appointments_external_sync_idx",
    ).on(table.workspaceId, table.externalSyncStatus, table.startsAt),
    conversationAppointmentsExternalEventIdx: uniqueIndex(
      "conversation_appointments_external_event_idx",
    )
      .on(
        table.workspaceId,
        table.externalCalendarProvider,
        table.externalEventId,
      )
      .where(
        sql`${table.externalCalendarProvider} is not null and ${table.externalEventId} is not null`,
      ),
  }),
);

export const conversationNotes = pgTable(
  "conversation_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    messageId: uuid("message_id").references(() => messages.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    authorUserId: uuid("author_user_id").references(() => users.id),
    body: text("body").notNull(),
    visibility: text("visibility").notNull().default("internal"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    conversationNotesConversationIdx: index(
      "conversation_notes_conversation_idx",
    ).on(table.workspaceId, table.conversationId, table.createdAt),
    conversationNotesMessageIdx: index("conversation_notes_message_idx").on(
      table.workspaceId,
      table.messageId,
    ),
  }),
);

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    actionId: uuid("action_id").references(() => actions.id),
    eventId: uuid("event_id").references(() => events.id),
    userId: uuid("user_id").references(() => users.id),
    channelId: uuid("channel_id").references(() => channels.id),
    channelType: text("channel_type").notNull(),
    provider: text("provider"),
    service: text("service"),
    connectionId: uuid("connection_id").references(
      () => integrationConnections.id,
    ),
    recipient: text("recipient"),
    subject: text("subject"),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),
    attachments: jsonb("attachments").notNull().default([]),
    settingsSnapshot: jsonb("settings_snapshot").notNull().default({}),
    status: text("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    source: text("source").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sendingAt: timestamp("sending_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    providerRequestId: text("provider_request_id"),
    lastError: text("last_error"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    outboundMessagesWorkspaceStatusIdx: index(
      "outbound_messages_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.nextAttemptAt),
    outboundMessagesConversationIdx: index(
      "outbound_messages_conversation_idx",
    ).on(table.workspaceId, table.conversationId, table.createdAt),
    outboundMessagesIdempotencyIdx: uniqueIndex(
      "outbound_messages_workspace_idempotency_idx",
    ).on(table.workspaceId, table.idempotencyKey),
  }),
);

export const voiceCalls = pgTable(
  "voice_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    phoneNumberId: uuid("phone_number_id").references(
      () => workspacePhoneNumbers.id,
    ),
    direction: text("direction").notNull(),
    purpose: text("purpose").notNull().default("inbound_customer"),
    provider: text("provider").notNull().default("vapi"),
    carrierProvider: text("carrier_provider").notNull().default("twilio"),
    providerCallId: text("provider_call_id"),
    providerAssistantId: text("provider_assistant_id"),
    providerPhoneNumberId: text("provider_phone_number_id"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    normalizedFromNumber: text("normalized_from_number"),
    normalizedToNumber: text("normalized_to_number"),
    customerNumber: text("customer_number"),
    status: text("status").notNull().default("created"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    recordingUrl: text("recording_url"),
    recordingRetentionDays: integer("recording_retention_days")
      .notNull()
      .default(30),
    recordingExpiresAt: timestamp("recording_expires_at", {
      withTimezone: true,
    }),
    recordingDeletedAt: timestamp("recording_deleted_at", {
      withTimezone: true,
    }),
    transcript: text("transcript"),
    summary: text("summary"),
    endedReason: text("ended_reason"),
    costProviderAmount: numeric("cost_provider_amount")
      .notNull()
      .default("0"),
    costCustomerAmount: numeric("cost_customer_amount")
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("USD"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    voiceCallsWorkspaceCreatedIdx: index("voice_calls_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    voiceCallsWorkspaceStatusIdx: index("voice_calls_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    voiceCallsWorkspaceContactIdx: index("voice_calls_workspace_contact_idx")
      .on(table.workspaceId, table.contactId, table.createdAt)
      .where(sql`${table.contactId} is not null`),
    voiceCallsProviderCallIdx: uniqueIndex("voice_calls_provider_call_idx")
      .on(table.provider, table.providerCallId)
      .where(sql`${table.providerCallId} is not null`),
    voiceCallsRecordingRetentionDueIdx: index(
      "voice_calls_recording_retention_due_idx",
    )
      .on(table.recordingExpiresAt)
      .where(
        sql`${table.recordingUrl} is not null and ${table.recordingDeletedAt} is null`,
      ),
  }),
);

export const voiceCallEvents = pgTable(
  "voice_call_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    voiceCallId: uuid("voice_call_id").references(() => voiceCalls.id),
    provider: text("provider").notNull().default("vapi"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    voiceCallEventsWorkspaceCreatedIdx: index(
      "voice_call_events_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt),
    voiceCallEventsCallCreatedIdx: index("voice_call_events_call_created_idx").on(
      table.workspaceId,
      table.voiceCallId,
      table.createdAt,
    ),
  }),
);

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
    quoteApprovalLinkStatusIdx: index("quote_approval_links_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  }),
);

export const generatedDocuments = pgTable(
  "generated_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    documentType: text("document_type").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("generated"),
    title: text("title").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    quoteDraftId: uuid("quote_draft_id").references(() => quoteDrafts.id),
    fileId: uuid("file_id").references(() => files.id),
    storageBucket: text("storage_bucket"),
    storagePath: text("storage_path"),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    contentHash: text("content_hash"),
    renderer: text("renderer"),
    documentVersion: text("document_version"),
    googleDriveFileId: text("google_drive_file_id"),
    googleDriveWebUrl: text("google_drive_web_url"),
    googleDriveSyncedAt: timestamp("google_drive_synced_at", {
      withTimezone: true,
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    sentMessageId: uuid("sent_message_id").references(() => messages.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    generatedDocumentsWorkspaceStatusIdx: index(
      "generated_documents_workspace_status_idx",
    ).on(table.workspaceId, table.lifecycleStatus, table.updatedAt),
    generatedDocumentsWorkspaceTypeIdx: index(
      "generated_documents_workspace_type_idx",
    ).on(table.workspaceId, table.documentType, table.updatedAt),
    generatedDocumentsContactIdx: index("generated_documents_contact_idx").on(
      table.workspaceId,
      table.contactId,
      table.updatedAt,
    ),
    generatedDocumentsConversationIdx: index(
      "generated_documents_conversation_idx",
    ).on(table.workspaceId, table.conversationId, table.updatedAt),
    generatedDocumentsQuoteDraftIdx: index(
      "generated_documents_quote_draft_idx",
    ).on(table.workspaceId, table.quoteDraftId, table.updatedAt),
    generatedDocumentsQuoteContentIdx: uniqueIndex(
      "generated_documents_quote_content_idx",
    )
      .on(
        table.workspaceId,
        table.quoteDraftId,
        table.documentType,
        table.contentHash,
      )
      .where(
        sql`${table.quoteDraftId} is not null and ${table.contentHash} is not null`,
      ),
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
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    addressLocality: text("address_locality"),
    addressAdministrativeArea: text("address_administrative_area"),
    addressPostalCode: text("address_postal_code"),
    addressCountryCode: text("address_country_code"),
    addressLatitude: numeric("address_latitude", {
      precision: 12,
      scale: 8,
    }),
    addressLongitude: numeric("address_longitude", {
      precision: 12,
      scale: 8,
    }),
    addressPlaceId: text("address_place_id"),
    addressSource: text("address_source").notNull().default("manual"),
    addressValidationStatus: text("address_validation_status")
      .notNull()
      .default("unverified"),
    addressValidatedAt: timestamp("address_validated_at", {
      withTimezone: true,
    }),
    addressStructured: jsonb("address_structured").notNull().default({}),
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
    inquiryFactsAddressPlaceIdx: index(
      "inquiry_facts_workspace_address_place_idx",
    )
      .on(table.workspaceId, table.addressPlaceId)
      .where(sql`${table.addressPlaceId} is not null`),
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

export const assistantContextSnapshots = pgTable(
  "assistant_context_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => assistantThreads.id),
    snapshotType: text("snapshot_type").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    keyPoints: jsonb("key_points").notNull().default([]),
    entities: jsonb("entities").notNull().default([]),
    sourceMessageIds: jsonb("source_message_ids").notNull().default([]),
    messageCount: integer("message_count").notNull().default(0),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    assistantContextSnapshotsUniquePeriodIdx: uniqueIndex(
      "assistant_context_snapshots_unique_period_idx",
    ).on(
      table.workspaceId,
      table.userId,
      table.threadId,
      table.snapshotType,
      table.periodStart,
    ),
    assistantContextSnapshotsThreadPeriodIdx: index(
      "assistant_context_snapshots_thread_period_idx",
    ).on(
      table.workspaceId,
      table.userId,
      table.threadId,
      table.snapshotType,
      table.periodEnd,
    ),
    assistantContextSnapshotsWorkspacePeriodIdx: index(
      "assistant_context_snapshots_workspace_period_idx",
    ).on(
      table.workspaceId,
      table.userId,
      table.snapshotType,
      table.periodEnd,
    ),
  }),
);

export const assistantPromptSuggestionSets = pgTable(
  "assistant_prompt_suggestion_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("weekly"),
    suggestions: jsonb("suggestions").notNull().default([]),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    model: text("model"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    assistantPromptSuggestionSetsActiveIdx: index(
      "assistant_prompt_suggestion_sets_active_idx",
    ).on(table.workspaceId, table.userId, table.status, table.generatedAt),
    assistantPromptSuggestionSetsPeriodIdx: index(
      "assistant_prompt_suggestion_sets_period_idx",
    ).on(table.workspaceId, table.userId, table.periodEnd),
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

export const kyroBillingPeriods = pgTable(
  "kyro_billing_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("USD"),
    subtotalAmount: numeric("subtotal_amount").notNull().default("0"),
    usageAmount: numeric("usage_amount").notNull().default("0"),
    baseSubscriptionAmount: numeric("base_subscription_amount")
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount").notNull().default("0"),
    totalAmount: numeric("total_amount").notNull().default("0"),
    providerCostAmount: numeric("provider_cost_amount").notNull().default("0"),
    invoiceId: uuid("invoice_id"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    kyroBillingPeriodsWorkspacePeriodIdx: uniqueIndex(
      "kyro_billing_periods_workspace_period_idx",
    ).on(table.workspaceId, table.periodStart, table.periodEnd),
    kyroBillingPeriodsWorkspaceStatusIdx: index(
      "kyro_billing_periods_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.periodEnd),
  }),
);

export const kyroInvoices = pgTable(
  "kyro_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    billingPeriodId: uuid("billing_period_id").references(
      () => kyroBillingPeriods.id,
    ),
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("USD"),
    subtotalAmount: numeric("subtotal_amount").notNull().default("0"),
    taxAmount: numeric("tax_amount").notNull().default("0"),
    totalAmount: numeric("total_amount").notNull().default("0"),
    providerCostAmount: numeric("provider_cost_amount").notNull().default("0"),
    stripeCustomerId: text("stripe_customer_id"),
    stripePaymentMethodId: text("stripe_payment_method_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeLastEventId: text("stripe_last_event_id"),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    kyroInvoicesInvoiceNumberIdx: uniqueIndex(
      "kyro_invoices_invoice_number_idx",
    ).on(table.invoiceNumber),
    kyroInvoicesBillingPeriodIdx: uniqueIndex(
      "kyro_invoices_billing_period_idx",
    ).on(table.billingPeriodId),
    kyroInvoicesWorkspaceStatusIdx: index(
      "kyro_invoices_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.dueAt),
    kyroInvoicesStripePaymentIntentIdx: index(
      "kyro_invoices_stripe_payment_intent_idx",
    ).on(table.stripePaymentIntentId),
  }),
);

export const kyroInvoiceLineItems = pgTable(
  "kyro_invoice_line_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => kyroInvoices.id),
    billingPeriodId: uuid("billing_period_id").references(
      () => kyroBillingPeriods.id,
    ),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    provider: text("provider"),
    service: text("service"),
    usageType: text("usage_type"),
    quantity: numeric("quantity").notNull().default("1"),
    unitAmount: numeric("unit_amount").notNull().default("0"),
    amount: numeric("amount").notNull().default("0"),
    taxAmount: numeric("tax_amount").notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    kyroInvoiceLineItemsInvoiceIdx: index(
      "kyro_invoice_line_items_invoice_idx",
    ).on(table.invoiceId),
    kyroInvoiceLineItemsWorkspacePeriodIdx: index(
      "kyro_invoice_line_items_workspace_period_idx",
    ).on(table.workspaceId, table.billingPeriodId),
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
