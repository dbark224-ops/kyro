import type { SupabaseClient } from "@supabase/supabase-js";

export const INBOUND_EMAIL_POLICY_TYPE = "inbound_email";

export const INBOUND_EMAIL_SYNC_MODES = ["automatic", "manual_only", "paused"] as const;
export const INBOUND_EMAIL_QUIET_HOURS_MODES = ["paused", "same_interval"] as const;
export const INBOUND_EMAIL_POLL_INTERVALS = [5, 15, 30, 60] as const;

export type InboundEmailSyncMode = (typeof INBOUND_EMAIL_SYNC_MODES)[number];
export type InboundEmailQuietHoursMode = (typeof INBOUND_EMAIL_QUIET_HOURS_MODES)[number];

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
  syncMode: InboundEmailSyncMode;
  timeZone: string;
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
