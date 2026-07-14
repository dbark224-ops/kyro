import type { SupabaseClient } from "@supabase/supabase-js";

export const NOTIFICATION_SETTINGS_POLICY_TYPE = "notifications";

export const CALENDAR_SMS_REMINDER_MINUTES = [15, 30, 60, 120] as const;
export type CalendarSmsReminderMinutes =
  (typeof CALENDAR_SMS_REMINDER_MINUTES)[number];

export const CALENDAR_DAILY_DIGEST_TIMINGS = [
  "morning_of",
  "night_before",
] as const;
export type CalendarDailyDigestTiming =
  (typeof CALENDAR_DAILY_DIGEST_TIMINGS)[number];

export type NotificationSettings = {
  calendarDailyDigestEnabled: boolean;
  calendarDailyDigestTime: string;
  calendarDailyDigestTiming: CalendarDailyDigestTiming;
  calendarSmsReminderMinutes: CalendarSmsReminderMinutes;
  calendarSmsRemindersEnabled: boolean;
  calendarSmsRecipientPhone: string;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  calendarDailyDigestEnabled: false,
  calendarDailyDigestTime: "07:00",
  calendarDailyDigestTiming: "morning_of",
  calendarSmsReminderMinutes: 60,
  calendarSmsRemindersEnabled: false,
  calendarSmsRecipientPhone: "",
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function normalizeReminderMinutes(
  value: unknown,
  fallback: CalendarSmsReminderMinutes,
): CalendarSmsReminderMinutes {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  return CALENDAR_SMS_REMINDER_MINUTES.includes(
    parsed as CalendarSmsReminderMinutes,
  )
    ? (parsed as CalendarSmsReminderMinutes)
    : fallback;
}

function normalizeDigestTiming(
  value: unknown,
  fallback: CalendarDailyDigestTiming,
): CalendarDailyDigestTiming {
  const timing = textValue(value);

  return CALENDAR_DAILY_DIGEST_TIMINGS.includes(
    timing as CalendarDailyDigestTiming,
  )
    ? (timing as CalendarDailyDigestTiming)
    : fallback;
}

export function normalizeDigestTime(value: unknown, fallback = "07:00") {
  const time = textValue(value);

  return time && TIME_PATTERN.test(time) ? time : fallback;
}

export function normalizeNotificationSettings(
  value: unknown,
  fallback: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS,
): NotificationSettings {
  const settings = objectRecord(value);

  return {
    calendarDailyDigestEnabled: booleanValue(
      settings.calendarDailyDigestEnabled,
      fallback.calendarDailyDigestEnabled,
    ),
    calendarDailyDigestTime: normalizeDigestTime(
      settings.calendarDailyDigestTime,
      fallback.calendarDailyDigestTime,
    ),
    calendarDailyDigestTiming: normalizeDigestTiming(
      settings.calendarDailyDigestTiming,
      fallback.calendarDailyDigestTiming,
    ),
    calendarSmsReminderMinutes: normalizeReminderMinutes(
      settings.calendarSmsReminderMinutes,
      fallback.calendarSmsReminderMinutes,
    ),
    calendarSmsRemindersEnabled: booleanValue(
      settings.calendarSmsRemindersEnabled,
      fallback.calendarSmsRemindersEnabled,
    ),
    calendarSmsRecipientPhone:
      textValue(settings.calendarSmsRecipientPhone) ??
      fallback.calendarSmsRecipientPhone,
  };
}

export async function getNotificationSettings(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("settings")
    .eq("workspace_id", workspaceId)
    .eq("policy_type", NOTIFICATION_SETTINGS_POLICY_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load notification settings: ${error.message}`);
  }

  return normalizeNotificationSettings(data?.settings);
}
