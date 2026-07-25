export type CalendarSyncProvider = "google" | "microsoft";

const GOOGLE_CALENDAR_SETUP_MESSAGE =
  "Google Calendar setup is not complete. The event is saved in Kyro; save it again after setup is complete to sync it.";

const GOOGLE_CALENDAR_PERMISSION_MESSAGE =
  "Google Calendar permission is missing. Reconnect Google in Settings and include calendar access.";

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

export function calendarProviderSyncErrorMessage(
  message: string,
  provider?: CalendarSyncProvider | null,
) {
  const clean = message.trim();
  const lower = clean.toLowerCase();
  const looksLikeGoogleCalendarError = includesAny(lower, [
    "calendar-json.googleapis.com",
    "google calendar",
    "googleapis.com",
  ]);
  const isGoogleError =
    provider === "google" || (!provider && looksLikeGoogleCalendarError);

  if (
    isGoogleError &&
    includesAny(lower, [
      "accessnotconfigured",
      "api has not been used in project",
      "calendar api has not been used",
      "calendar-json.googleapis.com",
      "console.developers.google.com/apis/api/calendar-json.googleapis.com",
      "it is disabled",
    ])
  ) {
    return GOOGLE_CALENDAR_SETUP_MESSAGE;
  }

  if (
    isGoogleError &&
    includesAny(lower, [
      "insufficient authentication scopes",
      "insufficientpermissions",
      "missing required authentication credential",
      "request had insufficient authentication scopes",
    ])
  ) {
    return GOOGLE_CALENDAR_PERMISSION_MESSAGE;
  }

  if (
    isGoogleError &&
    includesAny(lower, ["googleapis.com", "google calendar api"])
  ) {
    return "Google Calendar rejected the sync request. The event is saved in Kyro; reconnect Google in Settings if it continues.";
  }

  if (
    provider === "microsoft" &&
    includesAny(lower, ["invalid_grant", "interaction_required"])
  ) {
    return "Outlook Calendar access needs refreshing. Reconnect Outlook in Settings.";
  }

  return clean || "Calendar provider sync failed.";
}
