import type { SupabaseClient } from "@supabase/supabase-js";

const USAGE_EVENT_LIMIT = 500;

export const usageWindows = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "All", value: "all" },
] as const;

export type UsageWindow = (typeof usageWindows)[number]["value"];

export type UsageTotals = {
  events: number;
  quantity: number;
  providerCost: number;
  customerCharge: number;
  grossMargin: number;
  grossMarginRate: number;
  averageMarkup: number | null;
  currency: string;
};

export type UsageBreakdownRow = {
  key: string;
  label: string;
  description: string;
  provider: string;
  service: string;
  model: string;
  events: number;
  quantity: number;
  providerCost: number;
  customerCharge: number;
  grossMargin: number;
  currency: string;
};

export type UserUsageRow = {
  userId: string;
  displayName: string;
  email: string | null;
  events: number;
  providerCost: number;
  customerCharge: number;
  grossMargin: number;
  currency: string;
};

export type UsageLedgerRow = {
  id: string;
  userId: string | null;
  createdAt: string;
  provider: string;
  service: string;
  model: string;
  usageType: string;
  quantity: number;
  unit: string;
  providerCost: number;
  customerCharge: number;
  markup: number | null;
  currency: string;
  userName: string;
  sourceLabel: string;
  sourceMeta: string | null;
  sourceHref: string | null;
  taskType: string;
  taskLabel: string;
  taskDescription: string;
};

export type UsageReport = {
  activeWindow: UsageWindow;
  generatedAt: string;
  totals: UsageTotals;
  providerBreakdown: UsageBreakdownRow[];
  serviceBreakdown: UsageBreakdownRow[];
  taskBreakdown: UsageBreakdownRow[];
  userBreakdown: UserUsageRow[];
  ledger: UsageLedgerRow[];
};

type UsageEventRow = {
  id: unknown;
  user_id: unknown;
  source_type: unknown;
  source_id: unknown;
  ai_run_id: unknown;
  workflow_run_id: unknown;
  action_id: unknown;
  provider: unknown;
  service: unknown;
  model: unknown;
  usage_type: unknown;
  quantity: unknown;
  unit: unknown;
  unit_cost_snapshot: unknown;
  markup_snapshot: unknown;
  currency: unknown;
  cost_snapshot: unknown;
  customer_charge_snapshot: unknown;
  metadata: unknown;
  created_at: unknown;
};

type UserRow = {
  id: unknown;
  email: unknown;
  name: unknown;
};

type AiRunRow = {
  id: unknown;
  task_type: unknown;
  provider: unknown;
  model: unknown;
  input_refs: unknown;
  created_at: unknown;
};

type ActionRow = {
  id: unknown;
  type: unknown;
  status: unknown;
  target_type: unknown;
  target_id: unknown;
  created_at: unknown;
};

type QuoteDraftRow = {
  id: unknown;
  title: unknown;
  conversation_id: unknown;
};

export function normalizeUsageWindow(value: string | null | undefined): UsageWindow {
  return usageWindows.some((window) => window.value === value)
    ? (value as UsageWindow)
    : "30d";
}

export function usageWindowStart(window: UsageWindow) {
  const now = new Date();

  if (window === "all") {
    return null;
  }

  if (window === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }

  const days = window === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function getUsageReport(
  supabase: SupabaseClient,
  workspaceId: string,
  activeWindow: UsageWindow,
): Promise<UsageReport> {
  const start = usageWindowStart(activeWindow);
  let usageQuery = supabase
    .from("usage_events")
    .select(
      [
        "id",
        "user_id",
        "source_type",
        "source_id",
        "ai_run_id",
        "workflow_run_id",
        "action_id",
        "provider",
        "service",
        "model",
        "usage_type",
        "quantity",
        "unit",
        "unit_cost_snapshot",
        "markup_snapshot",
        "currency",
        "cost_snapshot",
        "customer_charge_snapshot",
        "metadata",
        "created_at",
      ].join(","),
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(USAGE_EVENT_LIMIT);

  if (start) {
    usageQuery = usageQuery.gte("created_at", start);
  }

  const { data: usageEvents, error } = await usageQuery;

  if (error) {
    throw new Error(`Unable to load usage events: ${error.message}`);
  }

  const rows = (usageEvents ?? []) as unknown as UsageEventRow[];
  const userIds = uniqueIds(rows.map((row) => valueId(row.user_id)));
  const aiRunIds = uniqueIds(
    rows.flatMap((row) => [
      valueId(row.ai_run_id),
      textValue(row.source_type) === "ai_run" ? valueId(row.source_id) : null,
    ]),
  );
  const actionIds = uniqueIds(
    rows.flatMap((row) => [
      valueId(row.action_id),
      textValue(row.source_type) === "action" ? valueId(row.source_id) : null,
    ]),
  );

  const [usersResult, aiRunsResult, actionsResult] = await Promise.all([
    userIds.length > 0
      ? supabase.from("users").select("id,email,name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    aiRunIds.length > 0
      ? supabase
          .from("ai_runs")
          .select("id,task_type,provider,model,input_refs,created_at")
          .eq("workspace_id", workspaceId)
          .in("id", aiRunIds)
      : Promise.resolve({ data: [], error: null }),
    actionIds.length > 0
      ? supabase
          .from("actions")
          .select("id,type,status,target_type,target_id,created_at")
          .eq("workspace_id", workspaceId)
          .in("id", actionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (usersResult.error) {
    throw new Error(`Unable to load usage users: ${usersResult.error.message}`);
  }

  if (aiRunsResult.error) {
    throw new Error(`Unable to load usage AI runs: ${aiRunsResult.error.message}`);
  }

  if (actionsResult.error) {
    throw new Error(`Unable to load usage actions: ${actionsResult.error.message}`);
  }

  const aiRuns = (aiRunsResult.data ?? []) as unknown as AiRunRow[];
  const actions = (actionsResult.data ?? []) as unknown as ActionRow[];
  const aiRunsById = new Map(aiRuns.map((run) => [String(run.id), run]));
  const actionsById = new Map(actions.map((action) => [String(action.id), action]));

  const quoteDraftIds = uniqueIds(
    rows.flatMap((row) => {
      const metadata = objectRecord(row.metadata);
      const sourceType = textValue(row.source_type);
      const sourceId = valueId(row.source_id);
      const action = actionForUsageRow(row, actionsById);
      const aiRun = aiRunForUsageRow(row, aiRunsById);
      const aiInputRefs = objectRecord(aiRun?.input_refs);

      return [
        sourceType === "quote_draft" ? sourceId : null,
        textValue(metadata.quoteDraftId),
        textValue(metadata.quote_draft_id),
        action && textValue(action.target_type) === "quote_draft"
          ? valueId(action.target_id)
          : null,
        textValue(aiInputRefs.quoteDraftId),
        textValue(aiInputRefs.quote_draft_id),
      ];
    }),
  );

  const quoteDraftsResult =
    quoteDraftIds.length > 0
      ? await supabase
          .from("quote_drafts")
          .select("id,title,conversation_id")
          .eq("workspace_id", workspaceId)
          .in("id", quoteDraftIds)
      : { data: [], error: null };

  if (quoteDraftsResult.error) {
    throw new Error(
      `Unable to load usage quote drafts: ${quoteDraftsResult.error.message}`,
    );
  }

  const usersById = new Map(
    ((usersResult.data ?? []) as unknown as UserRow[]).map((user) => [
      String(user.id),
      {
        email: textValue(user.email),
        name: textValue(user.name),
      },
    ]),
  );
  const quoteDraftsById = new Map(
    ((quoteDraftsResult.data ?? []) as unknown as QuoteDraftRow[]).map((quoteDraft) => [
      String(quoteDraft.id),
      quoteDraft,
    ]),
  );

  const ledger = rows.map((row) =>
    toLedgerRow(row, usersById, aiRunsById, actionsById, quoteDraftsById),
  );
  const totals = buildTotals(ledger);

  return {
    activeWindow,
    generatedAt: new Date().toISOString(),
    totals,
    providerBreakdown: buildBreakdown(ledger, (row) =>
      [row.provider, row.model, row.service].join("::"),
    ),
    serviceBreakdown: buildBreakdown(ledger, (row) =>
      [row.service, row.usageType].join("::"),
    ),
    taskBreakdown: buildBreakdown(ledger, (row) => row.taskType, (row) => ({
      description: row.taskDescription,
      label: row.taskLabel,
    })),
    userBreakdown: buildUserBreakdown(ledger),
    ledger,
  };
}

function toLedgerRow(
  row: UsageEventRow,
  usersById: Map<string, { email: string | null; name: string | null }>,
  aiRunsById: Map<string, AiRunRow>,
  actionsById: Map<string, ActionRow>,
  quoteDraftsById: Map<string, QuoteDraftRow>,
): UsageLedgerRow {
  const provider = textValue(row.provider) ?? "unknown";
  const service = textValue(row.service) ?? "llm";
  const model = textValue(row.model) ?? "n/a";
  const usageType = textValue(row.usage_type) ?? "usage";
  const currency = textValue(row.currency) ?? "USD";
  const userId = valueId(row.user_id);
  const user = userId ? usersById.get(userId) : null;
  const aiRun = aiRunForUsageRow(row, aiRunsById);
  const source = resolveSource(row, aiRunsById, actionsById, quoteDraftsById);
  const task = usageTaskForRow(row, aiRun);

  return {
    id: String(row.id),
    userId,
    createdAt: String(row.created_at),
    provider,
    service,
    model,
    usageType,
    quantity: numberValue(row.quantity),
    unit: textValue(row.unit) ?? "unit",
    providerCost: numberValue(row.cost_snapshot),
    customerCharge: numberValue(row.customer_charge_snapshot),
    markup:
      row.markup_snapshot === null || row.markup_snapshot === undefined
        ? null
        : numberValue(row.markup_snapshot),
    currency,
    userName: user?.name ?? user?.email ?? "Unknown user",
    sourceLabel: source.label,
    sourceMeta: source.meta,
    sourceHref: source.href,
    taskType: task.key,
    taskLabel: task.label,
    taskDescription: task.description,
  };
}

function usageTaskForRow(row: UsageEventRow, aiRun: AiRunRow | null) {
  const service = textValue(row.service) ?? "llm";
  const usageType = textValue(row.usage_type) ?? "usage";
  const metadata = objectRecord(row.metadata);
  const taskType =
    textValue(metadata.taskType) ??
    textValue(metadata.task_type) ??
    textValue(metadata.billingTask) ??
    textValue(metadata.billing_task) ??
    textValue(aiRun?.task_type) ??
    service;
  const normalized = taskType.toLowerCase();
  const sourceType = textValue(row.source_type);

  if (service === "realtime") {
    return {
      description:
        "Live voice conversations, including streamed speech, text, cached context, and tool-aware voice turns.",
      key: "live_voice_assistant",
      label: "Live voice assistant",
    };
  }

  if (service === "speech_to_text") {
    return {
      description:
        "Audio uploaded or recorded for Kyro to transcribe into text before acting on it.",
      key: "voice_transcription",
      label: "Voice transcription",
    };
  }

  if (service === "text_to_speech") {
    return {
      description:
        "Generated voice playback, pronunciation previews, and non-realtime spoken replies.",
      key: "voice_playback",
      label: "Voice playback",
    };
  }

  if (service === "web_search" || usageType === "web_search_calls") {
    return {
      description:
        "Internet search calls Kyro used to ground an answer with current information.",
      key: "internet_search",
      label: "Internet search",
    };
  }

  if (service === "email") {
    return {
      description:
        "Email delivery and communication activity recorded so billing can include outbound volume later.",
      key: "email_delivery",
      label: "Email delivery",
    };
  }

  if (service === "sms" || normalized.includes("sms")) {
    return {
      description:
        "Inbound and outbound SMS messages sent or received through connected telephony providers.",
      key: "sms_delivery",
      label: "SMS delivery",
    };
  }

  if (
    service === "voice" ||
    normalized.includes("voice_call") ||
    normalized.includes("phone_call")
  ) {
    return {
      description:
        "Phone-call provider charges, call handling, and future voice minutes.",
      key: "phone_calls",
      label: "Phone calls",
    };
  }

  if (
    normalized.includes("number_rental") ||
    normalized.includes("phone_number")
  ) {
    return {
      description:
        "Workspace phone-number rental charges passed through from the telephony provider.",
      key: "phone_number_rental",
      label: "Phone number rental",
    };
  }

  if (
    normalized.includes("reply") ||
    normalized.includes("draft_reply") ||
    sourceType === "inbox_reply"
  ) {
    return {
      description:
        "AI-generated email reply drafts and edits before the user sends them.",
      key: "ai_reply_drafting",
      label: "AI reply drafting",
    };
  }

  if (
    normalized.includes("inbound") ||
    normalized.includes("triage") ||
    normalized.includes("classification") ||
    normalized.includes("classifier") ||
    normalized.includes("email_sync")
  ) {
    return {
      description:
        "Inbound email filtering, classification, extraction, and CRM work item promotion.",
      key: "inbound_email_processing",
      label: "Inbound email processing",
    };
  }

  if (
    normalized.includes("template_revision") ||
    normalized.includes("template") ||
    normalized.includes("document")
  ) {
    return {
      description:
        "Document template edits, quote/invoice structure generation, and document assistant actions.",
      key: "document_generation",
      label: "Document generation",
    };
  }

  if (normalized.includes("pronunciation") || normalized.includes("vocabulary")) {
    return {
      description:
        "Pronunciation vocabulary suggestions, aliases, and background cleanup.",
      key: "pronunciation_vocabulary",
      label: "Pronunciation vocabulary",
    };
  }

  if (normalized.includes("settings") || normalized.includes("help")) {
    return {
      description:
        "Assistant help answers and safe settings-control work inside Kyro.",
      key: "assistant_help_settings",
      label: "Assistant help and settings",
    };
  }

  return {
    description:
      "General AI reasoning, writing, command handling, or tool orchestration that does not fit a narrower task.",
    key: `ai_${service}`,
    label: service === "llm" ? "AI assistant work" : formatLabel(service),
  };
}

function resolveSource(
  row: UsageEventRow,
  aiRunsById: Map<string, AiRunRow>,
  actionsById: Map<string, ActionRow>,
  quoteDraftsById: Map<string, QuoteDraftRow>,
) {
  const sourceType = textValue(row.source_type);
  const sourceId = valueId(row.source_id);
  const action = actionForUsageRow(row, actionsById);
  const aiRun = aiRunForUsageRow(row, aiRunsById);
  const metadata = objectRecord(row.metadata);

  if (action) {
    const actionType = formatLabel(textValue(action.type) ?? "action");
    const actionStatus = formatLabel(textValue(action.status) ?? "unknown");
    const target = hrefForTarget(
      textValue(action.target_type),
      valueId(action.target_id),
      quoteDraftsById,
    );

    return {
      href: target.href,
      label: `Action: ${actionType}`,
      meta: target.meta ?? actionStatus,
    };
  }

  if (sourceType === "quote_draft" && sourceId) {
    const quoteDraft = quoteDraftsById.get(sourceId);

    return {
      href: `/documents/${sourceId}`,
      label: `Quote: ${textValue(quoteDraft?.title) ?? "Draft quote"}`,
      meta: "Document",
    };
  }

  if (aiRun) {
    const inputRefs = objectRecord(aiRun.input_refs);
    const quoteDraftId =
      textValue(inputRefs.quoteDraftId) ?? textValue(inputRefs.quote_draft_id);
    const conversationId =
      textValue(inputRefs.conversationId) ?? textValue(inputRefs.conversation_id);
    const contactId = textValue(inputRefs.contactId) ?? textValue(inputRefs.contact_id);

    if (quoteDraftId) {
      const quoteDraft = quoteDraftsById.get(quoteDraftId);

      return {
        href: `/documents/${quoteDraftId}`,
        label: `AI run: ${formatLabel(textValue(aiRun.task_type) ?? "task")}`,
        meta: textValue(quoteDraft?.title) ?? "Linked quote draft",
      };
    }

    if (conversationId) {
      return {
        href: `/inbox/${conversationId}`,
        label: `AI run: ${formatLabel(textValue(aiRun.task_type) ?? "task")}`,
        meta: "Linked conversation",
      };
    }

    if (contactId) {
      return {
        href: `/contacts/${contactId}`,
        label: `AI run: ${formatLabel(textValue(aiRun.task_type) ?? "task")}`,
        meta: "Linked contact",
      };
    }

    return {
      href: null,
      label: `AI run: ${formatLabel(textValue(aiRun.task_type) ?? "task")}`,
      meta: [textValue(aiRun.provider), textValue(aiRun.model)].filter(Boolean).join(" / "),
    };
  }

  if (sourceType && sourceId) {
    const direct = hrefForTarget(sourceType, sourceId, quoteDraftsById);

    return {
      href: direct.href,
      label: formatLabel(sourceType),
      meta: direct.meta ?? textValue(metadata.reason),
    };
  }

  return {
    href: null,
    label: "Usage event",
    meta: textValue(metadata.reason),
  };
}

function hrefForTarget(
  targetType: string | null,
  targetId: string | null,
  quoteDraftsById: Map<string, QuoteDraftRow>,
) {
  if (!targetType || !targetId) {
    return { href: null, meta: null };
  }

  if (targetType === "conversation") {
    return { href: `/inbox/${targetId}`, meta: "Conversation" };
  }

  if (targetType === "contact") {
    return { href: `/contacts/${targetId}`, meta: "Contact" };
  }

  if (targetType === "quote_draft") {
    const quoteDraft = quoteDraftsById.get(targetId);
    return {
      href: `/documents/${targetId}`,
      meta: textValue(quoteDraft?.title) ?? "Quote draft",
    };
  }

  if (targetType === "lead") {
    return { href: "/leads", meta: "Lead" };
  }

  return { href: null, meta: formatLabel(targetType) };
}

function buildTotals(rows: UsageLedgerRow[]): UsageTotals {
  const providerCost = sum(rows.map((row) => row.providerCost));
  const customerCharge = sum(rows.map((row) => row.customerCharge));
  const markupValues = rows
    .map((row) => row.markup)
    .filter((value): value is number => value !== null);
  const averageMarkup =
    markupValues.length > 0 ? sum(markupValues) / markupValues.length : null;

  return {
    events: rows.length,
    quantity: sum(rows.map((row) => row.quantity)),
    providerCost,
    customerCharge,
    grossMargin: customerCharge - providerCost,
    grossMarginRate:
      customerCharge > 0 ? (customerCharge - providerCost) / customerCharge : 0,
    averageMarkup,
    currency: rows[0]?.currency ?? "USD",
  };
}

function buildBreakdown(
  rows: UsageLedgerRow[],
  keyForRow: (row: UsageLedgerRow) => string,
  descriptorForRow?: (row: UsageLedgerRow) => {
    description: string;
    label: string;
  },
) {
  const byKey = new Map<string, UsageBreakdownRow>();

  for (const row of rows) {
    const key = keyForRow(row);
    const current =
      byKey.get(key) ??
      ({
        key,
        description:
          descriptorForRow?.(row).description ?? formatLabel(row.service),
        label: descriptorForRow?.(row).label ?? row.model,
        provider: row.provider,
        service: row.service,
        model: row.model,
        events: 0,
        quantity: 0,
        providerCost: 0,
        customerCharge: 0,
        grossMargin: 0,
        currency: row.currency,
      } satisfies UsageBreakdownRow);

    current.events += 1;
    current.quantity += row.quantity;
    current.providerCost += row.providerCost;
    current.customerCharge += row.customerCharge;
    current.grossMargin = current.customerCharge - current.providerCost;
    byKey.set(key, current);
  }

  return [...byKey.values()].sort((a, b) => b.customerCharge - a.customerCharge);
}

function buildUserBreakdown(rows: UsageLedgerRow[]) {
  const byUser = new Map<string, UserUsageRow>();

  for (const row of rows) {
    const key = row.userId ?? row.userName;
    const current =
      byUser.get(key) ??
      ({
        userId: key,
        displayName: row.userName,
        email: row.userName.includes("@") ? row.userName : null,
        events: 0,
        providerCost: 0,
        customerCharge: 0,
        grossMargin: 0,
        currency: row.currency,
      } satisfies UserUsageRow);

    current.events += 1;
    current.providerCost += row.providerCost;
    current.customerCharge += row.customerCharge;
    current.grossMargin = current.customerCharge - current.providerCost;
    byUser.set(key, current);
  }

  return [...byUser.values()].sort((a, b) => b.customerCharge - a.customerCharge);
}

function actionForUsageRow(
  row: UsageEventRow,
  actionsById: Map<string, ActionRow>,
) {
  const actionId =
    valueId(row.action_id) ??
    (textValue(row.source_type) === "action" ? valueId(row.source_id) : null);

  return actionId ? actionsById.get(actionId) ?? null : null;
}

function aiRunForUsageRow(row: UsageEventRow, aiRunsById: Map<string, AiRunRow>) {
  const aiRunId =
    valueId(row.ai_run_id) ??
    (textValue(row.source_type) === "ai_run" ? valueId(row.source_id) : null);

  return aiRunId ? aiRunsById.get(aiRunId) ?? null : null;
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function valueId(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}

function numberValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function formatLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
