import type { SupabaseClient } from "@supabase/supabase-js";
import { textValue } from "@kyro/core";

export const CALENDAR_SETTINGS_POLICY_TYPE = "calendar_settings";

export const CALENDAR_VIEWS = ["day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_WEEK_LAYOUTS = ["rolling", "fixed"] as const;
export type CalendarWeekLayout = (typeof CALENDAR_WEEK_LAYOUTS)[number];

export const CALENDAR_EVENT_TYPES = [
  "quote_visit",
  "job",
  "follow_up",
  "site_visit",
  "internal",
  "other",
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_SYNC_PROVIDERS = [
  "auto",
  "google",
  "microsoft",
  "none",
] as const;
export type CalendarSyncProvider = (typeof CALENDAR_SYNC_PROVIDERS)[number];

export type CalendarSettings = {
  bufferMinutesAfter: number;
  bufferMinutesBefore: number;
  defaultDurationMinutes: number;
  defaultEventType: CalendarEventType;
  defaultView: CalendarView;
  externalCalendarId: string;
  importExternalUpdates: boolean;
  syncCreatedEventsToExternal: boolean;
  syncDeletedEventsToExternal: boolean;
  syncProvider: CalendarSyncProvider;
  syncUpdatedEventsToExternal: boolean;
  weekDaysBefore: number;
  weekLayout: CalendarWeekLayout;
};

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  bufferMinutesAfter: 0,
  bufferMinutesBefore: 0,
  defaultDurationMinutes: 60,
  defaultEventType: "quote_visit",
  defaultView: "week",
  externalCalendarId: "primary",
  importExternalUpdates: true,
  syncCreatedEventsToExternal: true,
  syncDeletedEventsToExternal: true,
  syncProvider: "auto",
  syncUpdatedEventsToExternal: true,
  weekDaysBefore: 2,
  weekLayout: "rolling",
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function integerValue(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeCalendarView(
  value: unknown,
  fallback: CalendarView,
): CalendarView {
  const view = textValue(value);

  return CALENDAR_VIEWS.includes(view as CalendarView)
    ? (view as CalendarView)
    : fallback;
}

function normalizeCalendarWeekLayout(
  value: unknown,
  fallback: CalendarWeekLayout,
): CalendarWeekLayout {
  const layout = textValue(value);

  return CALENDAR_WEEK_LAYOUTS.includes(layout as CalendarWeekLayout)
    ? (layout as CalendarWeekLayout)
    : fallback;
}

export function normalizeCalendarEventType(
  value: unknown,
  fallback: CalendarEventType = "other",
): CalendarEventType {
  const type = textValue(value);

  return CALENDAR_EVENT_TYPES.includes(type as CalendarEventType)
    ? (type as CalendarEventType)
    : fallback;
}

function normalizeSyncProvider(
  value: unknown,
  fallback: CalendarSyncProvider,
): CalendarSyncProvider {
  const provider = textValue(value);

  return CALENDAR_SYNC_PROVIDERS.includes(provider as CalendarSyncProvider)
    ? (provider as CalendarSyncProvider)
    : fallback;
}

export function normalizeCalendarSettings(
  value: unknown,
  fallback: CalendarSettings = DEFAULT_CALENDAR_SETTINGS,
): CalendarSettings {
  const settings = objectRecord(value);

  return {
    bufferMinutesAfter: integerValue(
      settings.bufferMinutesAfter,
      fallback.bufferMinutesAfter,
      0,
      240,
    ),
    bufferMinutesBefore: integerValue(
      settings.bufferMinutesBefore,
      fallback.bufferMinutesBefore,
      0,
      240,
    ),
    defaultDurationMinutes: integerValue(
      settings.defaultDurationMinutes,
      fallback.defaultDurationMinutes,
      5,
      720,
    ),
    defaultEventType: normalizeCalendarEventType(
      settings.defaultEventType,
      fallback.defaultEventType,
    ),
    defaultView: normalizeCalendarView(
      settings.defaultView,
      fallback.defaultView,
    ),
    externalCalendarId:
      textValue(settings.externalCalendarId) ?? fallback.externalCalendarId,
    importExternalUpdates: booleanValue(
      settings.importExternalUpdates,
      fallback.importExternalUpdates,
    ),
    syncCreatedEventsToExternal: booleanValue(
      settings.syncCreatedEventsToExternal,
      fallback.syncCreatedEventsToExternal,
    ),
    syncDeletedEventsToExternal: booleanValue(
      settings.syncDeletedEventsToExternal,
      fallback.syncDeletedEventsToExternal,
    ),
    syncProvider: normalizeSyncProvider(
      settings.syncProvider,
      fallback.syncProvider,
    ),
    syncUpdatedEventsToExternal: booleanValue(
      settings.syncUpdatedEventsToExternal,
      fallback.syncUpdatedEventsToExternal,
    ),
    weekDaysBefore: integerValue(
      settings.weekDaysBefore,
      fallback.weekDaysBefore,
      0,
      6,
    ),
    weekLayout: normalizeCalendarWeekLayout(
      settings.weekLayout,
      fallback.weekLayout,
    ),
  };
}

export async function getCalendarSettings(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("settings")
    .eq("workspace_id", workspaceId)
    .eq("policy_type", CALENDAR_SETTINGS_POLICY_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load calendar settings: ${error.message}`);
  }

  return normalizeCalendarSettings(data?.settings);
}
