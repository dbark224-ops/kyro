import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  safeTimeZone,
} from "../timezone";

export type AssistantCurrentTimeContext = {
  currentDate: string;
  currentDateKey: string;
  currentDateTime: string;
  currentIsoUtc: string;
  currentTime: string;
  currentTimezone: string;
  promptLine: string;
  tomorrowDate: string;
  tomorrowDateKey: string;
  variableValues: Record<string, string>;
};

function formatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    ...options,
  });
}

function displayDate(dateKey: string) {
  return formatter("UTC", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

export function buildAssistantCurrentTimeContext(
  timeZone: string | null | undefined,
  now = new Date(),
): AssistantCurrentTimeContext {
  const currentTimezone = safeTimeZone(timeZone);
  const currentDateKey = dateKeyInTimeZone(now, currentTimezone);
  const tomorrowDateKey = addDaysToDateKey(currentDateKey, 1);
  const currentDate = formatter(currentTimezone, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(now);
  const currentTime = formatter(currentTimezone, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(now);
  const currentDateTime = `${currentDate}, ${currentTime}`;
  const currentIsoUtc = now.toISOString();
  const tomorrowDate = displayDate(tomorrowDateKey);
  const promptLine = [
    `Authoritative workspace date/time: ${currentDateTime}.`,
    `Workspace timezone: ${currentTimezone}.`,
    `Workspace local date: ${currentDateKey}.`,
    `Workspace tomorrow: ${tomorrowDate} (${tomorrowDateKey}).`,
    `UTC instant: ${currentIsoUtc}.`,
    "Use the workspace-local date as the only source of truth for today, tomorrow, weekdays, relative dates, past/future checks, and appointment times unless the user explicitly specifies another timezone.",
    "Never substitute the UTC calendar date for the workspace-local date.",
  ].join(" ");

  return {
    currentDate,
    currentDateKey,
    currentDateTime,
    currentIsoUtc,
    currentTime,
    currentTimezone,
    promptLine,
    tomorrowDate,
    tomorrowDateKey,
    variableValues: {
      current_date: currentDate,
      current_date_key: currentDateKey,
      current_datetime: currentDateTime,
      current_iso_utc: currentIsoUtc,
      current_time: currentTime,
      current_timezone: currentTimezone,
      tomorrow_date: tomorrowDate,
      tomorrow_date_key: tomorrowDateKey,
    },
  };
}
