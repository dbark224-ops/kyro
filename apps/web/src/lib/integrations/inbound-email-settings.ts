import type { SupabaseClient } from "@supabase/supabase-js";

export const INBOUND_EMAIL_POLICY_TYPE = "inbound_email";

export const INBOUND_EMAIL_SYNC_MODES = ["automatic", "manual_only", "paused"] as const;
export const INBOUND_EMAIL_QUIET_HOURS_MODES = ["paused", "same_interval"] as const;
export const INBOUND_EMAIL_POLL_INTERVALS = [5, 15, 30, 60] as const;
export const INBOUND_EMAIL_SENDER_RULE_ACTIONS = ["always_promote", "always_ignore"] as const;

export type InboundEmailSyncMode = (typeof INBOUND_EMAIL_SYNC_MODES)[number];
export type InboundEmailQuietHoursMode = (typeof INBOUND_EMAIL_QUIET_HOURS_MODES)[number];
export type InboundEmailSenderRuleAction = (typeof INBOUND_EMAIL_SENDER_RULE_ACTIONS)[number];
export type InboundEmailSenderRule = {
  action: InboundEmailSenderRuleAction;
  createdAt?: string | null;
  createdFromEventId?: string | null;
  match: "email" | "domain";
  value: string;
};

export type InboundEmailSettings = {
  actionInstructions: string;
  autoPromoteActionable: boolean;
  includeAwarenessEvents: boolean;
  lookbackDays: number;
  maxMessagesPerSync: number;
  pollIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursEnd: string;
  quietHoursMode: InboundEmailQuietHoursMode;
  quietHoursStart: string;
  senderRules: InboundEmailSenderRule[];
  syncMode: InboundEmailSyncMode;
  timeZone: string;
};

export type InboundEmailSyncHistoryItem = {
  actorType: string;
  checkedConnections: number;
  createdAt: string;
  duplicates: number;
  errors: number;
  fetchedMessages: number;
  id: string;
  needsReconnect: number;
  observedMessages: number;
  promotedMessages: number;
  skippedBySchedule: number;
  trigger: InboundEmailSyncMode | "assistant" | "manual" | "scheduled" | string;
};

export type InboundEmailDecisionItem = {
  accountEmail: string | null;
  attachmentCount: number;
  category: string | null;
  conversationId: string | null;
  createdAt: string;
  fromEmail: string | null;
  id: string;
  processedAt: string | null;
  provider: string | null;
  providerUsed: string | null;
  reason: string | null;
  receivedAt: string | null;
  stage: string | null;
  status: string;
  subject: string;
  threadMatchStrategy: string | null;
};

export type InboundEmailOperationalSummary = {
  decisions: InboundEmailDecisionItem[];
  syncRuns: InboundEmailSyncHistoryItem[];
};

export const DEFAULT_INBOUND_EMAIL_ACTION_INSTRUCTIONS = [
  "Promote emails that look like customer enquiries, quote requests, booking changes, job updates, supplier/work logistics, urgent service issues, or other business matters Kyro can help action.",
  "Do not promote personal jokes, family messages, newsletters, receipts, marketing blasts, social notifications, automated system mail, spam, or low-value FYI messages unless they clearly affect the business.",
  "It is okay for Kyro to be aware that a skipped email existed, but only actionable business mail should become a lead, conversation, or draft reply.",
].join(" ");

export const DEFAULT_INBOUND_EMAIL_SETTINGS: InboundEmailSettings = {
  actionInstructions: DEFAULT_INBOUND_EMAIL_ACTION_INSTRUCTIONS,
  autoPromoteActionable: true,
  includeAwarenessEvents: true,
  lookbackDays: 7,
  maxMessagesPerSync: 25,
  pollIntervalMinutes: 5,
  quietHoursEnabled: true,
  quietHoursEnd: "04:00",
  quietHoursMode: "paused",
  quietHoursStart: "22:00",
  senderRules: [],
  syncMode: "automatic",
  timeZone: defaultTimeZone(),
};

type LocalDateParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

function defaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = numberValue(value) ?? fallback;

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeTime(value: unknown, fallback: string) {
  const text = textValue(value);

  if (!text) {
    return fallback;
  }

  const match = text.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return fallback;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeSyncMode(value: unknown): InboundEmailSyncMode {
  return INBOUND_EMAIL_SYNC_MODES.includes(value as InboundEmailSyncMode)
    ? (value as InboundEmailSyncMode)
    : DEFAULT_INBOUND_EMAIL_SETTINGS.syncMode;
}

function normalizeQuietHoursMode(value: unknown): InboundEmailQuietHoursMode {
  if (value === "once") {
    return "paused";
  }

  return INBOUND_EMAIL_QUIET_HOURS_MODES.includes(value as InboundEmailQuietHoursMode)
    ? (value as InboundEmailQuietHoursMode)
    : DEFAULT_INBOUND_EMAIL_SETTINGS.quietHoursMode;
}

function normalizeTimeZone(value: unknown) {
  const timeZone = textValue(value) ?? DEFAULT_INBOUND_EMAIL_SETTINGS.timeZone;

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());

    return timeZone;
  } catch {
    return DEFAULT_INBOUND_EMAIL_SETTINGS.timeZone;
  }
}

function normalizePollInterval(value: unknown) {
  const parsed = clampNumber(
    value,
    DEFAULT_INBOUND_EMAIL_SETTINGS.pollIntervalMinutes,
    5,
    60,
  );

  return INBOUND_EMAIL_POLL_INTERVALS.find((interval) => interval === parsed) ?? parsed;
}

function emailDomain(value: string | null) {
  const [, domain] = (value ?? "").toLowerCase().split("@");

  return domain?.trim() || null;
}

function normalizeRuleValue(value: unknown, match: InboundEmailSenderRule["match"]) {
  const text = textValue(value)?.toLowerCase();

  if (!text) {
    return null;
  }

  if (match === "email") {
    return text.includes("@") ? text : null;
  }

  return text.replace(/^@/, "").trim() || null;
}

function normalizeSenderRules(value: unknown): InboundEmailSenderRule[] {
  const rules = Array.isArray(value) ? value : [];
  const normalizedRules: InboundEmailSenderRule[] = [];
  const seen = new Set<string>();

  for (const rawRule of rules) {
    const rule = objectRecord(rawRule);
    const action = INBOUND_EMAIL_SENDER_RULE_ACTIONS.includes(
      rule.action as InboundEmailSenderRuleAction,
    )
      ? (rule.action as InboundEmailSenderRuleAction)
      : null;
    const match = rule.match === "domain" ? "domain" : rule.match === "email" ? "email" : null;
    const value = match ? normalizeRuleValue(rule.value, match) : null;

    if (!action || !match || !value) {
      continue;
    }

    const key = `${match}:${value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedRules.push({
      action,
      createdAt: textValue(rule.createdAt),
      createdFromEventId: textValue(rule.createdFromEventId),
      match,
      value,
    });
  }

  return normalizedRules.slice(0, 200);
}

export function senderRuleTargetFromEmail(
  email: string | null,
  match: InboundEmailSenderRule["match"] = "email",
) {
  const normalizedEmail = textValue(email)?.toLowerCase() ?? null;

  return match === "domain"
    ? emailDomain(normalizedEmail)
    : normalizedEmail && normalizedEmail.includes("@")
      ? normalizedEmail
      : null;
}

export function senderRuleTargetFromInput(
  value: string | null,
  match: InboundEmailSenderRule["match"] = "email",
) {
  const text = textValue(value)?.toLowerCase() ?? null;

  if (!text) {
    return null;
  }

  if (match === "email") {
    return text.includes("@") ? text : null;
  }

  const domain = text.includes("@")
    ? emailDomain(text)
    : text
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/^@/, "")
        .split(/[/?#]/)[0]
        .trim();

  return domain && domain.includes(".") && !domain.includes("@") && !/\s/.test(domain)
    ? domain
    : null;
}

export function upsertInboundEmailSenderRule(
  settings: InboundEmailSettings,
  rule: InboundEmailSenderRule,
): InboundEmailSettings {
  const nextRules = settings.senderRules.filter(
    (existingRule) =>
      existingRule.match !== rule.match || existingRule.value !== rule.value,
  );

  return {
    ...settings,
    senderRules: [rule, ...nextRules].slice(0, 200),
  };
}

export function removeInboundEmailSenderRule(
  settings: InboundEmailSettings,
  rule: Pick<InboundEmailSenderRule, "match" | "value">,
): InboundEmailSettings {
  return {
    ...settings,
    senderRules: settings.senderRules.filter(
      (existingRule) =>
        existingRule.match !== rule.match || existingRule.value !== rule.value,
    ),
  };
}

export function findInboundEmailSenderRule(
  rules: InboundEmailSenderRule[],
  email: string | null,
) {
  const normalizedEmail = senderRuleTargetFromEmail(email, "email");
  const domain = senderRuleTargetFromEmail(email, "domain");

  if (!normalizedEmail && !domain) {
    return null;
  }

  return (
    rules.find(
      (rule) =>
        (rule.match === "email" && rule.value === normalizedEmail) ||
        (rule.match === "domain" && rule.value === domain),
    ) ?? null
  );
}

function localDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    month: value("month"),
    year: value("year"),
  };
}

function minuteOfDay(value: string) {
  const [hour, minute] = value.split(":").map(Number);

  return hour * 60 + minute;
}

function dateKey(parts: Pick<LocalDateParts, "day" | "month" | "year">) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function previousUtcDateKey(parts: LocalDateParts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  date.setUTCDate(date.getUTCDate() - 1);

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function quietWindowKey(date: Date, settings: InboundEmailSettings) {
  const parts = localDateParts(date, settings.timeZone);
  const nowMinute = parts.hour * 60 + parts.minute;
  const start = minuteOfDay(settings.quietHoursStart);
  const end = minuteOfDay(settings.quietHoursEnd);

  if (start === end) {
    return null;
  }

  if (start < end) {
    return nowMinute >= start && nowMinute < end ? dateKey(parts) : null;
  }

  if (nowMinute >= start) {
    return dateKey(parts);
  }

  if (nowMinute < end) {
    return previousUtcDateKey(parts);
  }

  return null;
}

function minutesSince(value: string | null, now: Date) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return (now.getTime() - timestamp) / 60_000;
}

export function normalizeInboundEmailSettings(value: unknown): InboundEmailSettings {
  const settings = objectRecord(value);
  const timeZone = normalizeTimeZone(settings.timeZone);

  return {
    actionInstructions:
      textValue(settings.actionInstructions) ??
      DEFAULT_INBOUND_EMAIL_SETTINGS.actionInstructions,
    autoPromoteActionable: true,
    includeAwarenessEvents: booleanValue(
      settings.includeAwarenessEvents,
      DEFAULT_INBOUND_EMAIL_SETTINGS.includeAwarenessEvents,
    ),
    lookbackDays: clampNumber(settings.lookbackDays, DEFAULT_INBOUND_EMAIL_SETTINGS.lookbackDays, 1, 30),
    maxMessagesPerSync: clampNumber(
      settings.maxMessagesPerSync,
      DEFAULT_INBOUND_EMAIL_SETTINGS.maxMessagesPerSync,
      5,
      50,
    ),
    pollIntervalMinutes: normalizePollInterval(settings.pollIntervalMinutes),
    quietHoursEnabled: booleanValue(
      settings.quietHoursEnabled,
      DEFAULT_INBOUND_EMAIL_SETTINGS.quietHoursEnabled,
    ),
    quietHoursEnd: normalizeTime(settings.quietHoursEnd, DEFAULT_INBOUND_EMAIL_SETTINGS.quietHoursEnd),
    quietHoursMode: normalizeQuietHoursMode(settings.quietHoursMode),
    quietHoursStart: normalizeTime(
      settings.quietHoursStart,
      DEFAULT_INBOUND_EMAIL_SETTINGS.quietHoursStart,
    ),
    senderRules: normalizeSenderRules(settings.senderRules),
    syncMode: normalizeSyncMode(settings.syncMode),
    timeZone,
  };
}

export async function getInboundEmailSettings(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("settings")
    .eq("workspace_id", workspaceId)
    .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load inbound email settings: ${error.message}`);
  }

  return normalizeInboundEmailSettings(data?.settings);
}

export function normalizeInboundEmailSyncAuditRow(row: {
  actor_type?: string | null;
  after: unknown;
  created_at?: string | null;
  id: string;
}): InboundEmailSyncHistoryItem {
  const after = objectRecord(row.after);

  return {
    actorType: textValue(row.actor_type) ?? "system",
    checkedConnections: numberValue(after.checkedConnections) ?? 0,
    createdAt: textValue(row.created_at) ?? new Date(0).toISOString(),
    duplicates: numberValue(after.duplicates) ?? 0,
    errors: numberValue(after.errors) ?? 0,
    fetchedMessages: numberValue(after.fetchedMessages) ?? 0,
    id: row.id,
    needsReconnect: numberValue(after.needsReconnect) ?? 0,
    observedMessages: numberValue(after.observedMessages) ?? 0,
    promotedMessages: numberValue(after.promotedMessages) ?? 0,
    skippedBySchedule: numberValue(after.skippedBySchedule) ?? 0,
    trigger: textValue(after.trigger) ?? "unknown",
  };
}

export function normalizeInboundEmailDecisionRow(row: {
  created_at?: string | null;
  id: string;
  payload: unknown;
  processed_at?: string | null;
  status?: string | null;
}): InboundEmailDecisionItem {
  const payload = objectRecord(row.payload);
  const classification = objectRecord(payload.classification);

  return {
    accountEmail: textValue(payload.accountEmail),
    attachmentCount: numberValue(payload.attachmentCount) ?? 0,
    category: textValue(classification.category),
    conversationId: textValue(payload.conversationId),
    createdAt: textValue(row.created_at) ?? new Date(0).toISOString(),
    fromEmail: textValue(payload.fromEmail) ?? textValue(payload.contactEmail),
    id: row.id,
    processedAt: textValue(row.processed_at),
    provider: textValue(payload.provider),
    providerUsed: textValue(classification.providerUsed),
    reason: textValue(classification.reason),
    receivedAt: textValue(payload.receivedAt),
    stage: textValue(payload.stage),
    status: textValue(row.status) ?? "unknown",
    subject: textValue(payload.subject) ?? "Inbound email",
    threadMatchStrategy: textValue(payload.threadMatchStrategy),
  };
}

export async function getInboundEmailOperationalSummary(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<InboundEmailOperationalSummary> {
  const [syncRunsResult, decisionsResult] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("id,actor_type,after,created_at")
      .eq("workspace_id", workspaceId)
      .eq("action", "inbound.email_sync.completed")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("events")
      .select("id,payload,status,processed_at,created_at")
      .eq("workspace_id", workspaceId)
      .eq("type", "inbound.email.received")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (syncRunsResult.error) {
    throw new Error(
      `Unable to load inbound email sync history: ${syncRunsResult.error.message}`,
    );
  }

  if (decisionsResult.error) {
    throw new Error(
      `Unable to load inbound email decisions: ${decisionsResult.error.message}`,
    );
  }

  return {
    decisions: (decisionsResult.data ?? []).map(normalizeInboundEmailDecisionRow),
    syncRuns: (syncRunsResult.data ?? []).map(normalizeInboundEmailSyncAuditRow),
  };
}

export function shouldRunInboundEmailSync({
  lastSyncAt,
  now = new Date(),
  settings,
}: {
  lastSyncAt: string | null;
  now?: Date;
  settings: InboundEmailSettings;
}) {
  if (settings.syncMode !== "automatic") {
    return false;
  }

  const regularIntervalDue = minutesSince(lastSyncAt, now) >= settings.pollIntervalMinutes;

  if (!settings.quietHoursEnabled) {
    return regularIntervalDue;
  }

  const currentQuietWindow = quietWindowKey(now, settings);

  if (!currentQuietWindow) {
    return regularIntervalDue;
  }

  if (settings.quietHoursMode === "same_interval") {
    return regularIntervalDue;
  }

  return false;
}
