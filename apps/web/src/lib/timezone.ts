const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

export type DateKeyRange = {
  from: string;
  to: string;
};

export function safeTimeZone(value: string | null | undefined) {
  const timeZone = value?.trim() || "UTC";

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function dateKeyParts(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return { day, month, year };
}

function dateKeyFromUtcParts(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function dateKeyToPlainDate(dateKey: string) {
  const { day, month, year } = dateKeyParts(dateKey);

  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

export function dateKeyInTimeZone(
  value: Date | string,
  timeZoneInput: string | null | undefined,
) {
  const timeZone = safeTimeZone(timeZoneInput);
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((current) => current.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function todayDateKey(timeZone: string) {
  return dateKeyInTimeZone(new Date(), timeZone);
}

export function parseDateKeyOrToday(
  value: string | null | undefined,
  timeZone: string,
) {
  return value && DATE_KEY_PATTERN.test(value) ? value : todayDateKey(timeZone);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const { day, month, year } = dateKeyParts(dateKey);

  return dateKeyFromUtcParts(new Date(Date.UTC(year, month - 1, day + days)));
}

export function addMonthsToDateKey(dateKey: string, months: number) {
  const { month, year } = dateKeyParts(dateKey);

  return dateKeyFromUtcParts(new Date(Date.UTC(year, month - 1 + months, 1)));
}

export function startOfMonthDateKey(dateKey: string) {
  const { month, year } = dateKeyParts(dateKey);

  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function startOfWeekDateKey(dateKey: string) {
  const date = dateKeyToPlainDate(dateKey);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return addDaysToDateKey(dateKey, mondayOffset);
}

export function rangeForCalendarViewDateKey(
  anchorDateKey: string,
  view: "day" | "month" | "week",
): DateKeyRange {
  if (view === "day") {
    return { from: anchorDateKey, to: addDaysToDateKey(anchorDateKey, 1) };
  }

  if (view === "month") {
    const from = startOfWeekDateKey(startOfMonthDateKey(anchorDateKey));
    const nextMonth = addMonthsToDateKey(anchorDateKey, 1);
    const to = addDaysToDateKey(startOfWeekDateKey(nextMonth), 7);

    return { from, to };
  }

  const from = startOfWeekDateKey(anchorDateKey);
  return { from, to: addDaysToDateKey(from, 7) };
}

export function timeZoneParts(date: Date, timeZoneInput: string | null | undefined) {
  const timeZone = safeTimeZone(timeZoneInput);
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) =>
    Number(parts.find((current) => current.type === type)?.value ?? "0");

  return {
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    month: part("month"),
    second: part("second"),
    year: part("year"),
  };
}

export function timeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = timeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return (localAsUtc - date.getTime()) / 60_000;
}

export function isoFromDateKeyAndMinutes(
  dateKey: string,
  minutes: number,
  timeZoneInput: string | null | undefined,
) {
  const timeZone = safeTimeZone(timeZoneInput);
  const { day, month, year } = dateKeyParts(dateKey);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const localTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utcTimestamp = localTimestamp;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = timeZoneOffsetMinutes(new Date(utcTimestamp), timeZone);
    const next = localTimestamp - offset * 60_000;

    if (Math.abs(next - utcTimestamp) < 1000) {
      utcTimestamp = next;
      break;
    }

    utcTimestamp = next;
  }

  return new Date(utcTimestamp).toISOString();
}

export function isoRangeForDateKeyRange(
  range: DateKeyRange,
  timeZone: string,
) {
  return {
    from: isoFromDateKeyAndMinutes(range.from, 0, timeZone),
    to: isoFromDateKeyAndMinutes(range.to, 0, timeZone),
  };
}

export function dateTimeLocalValueInTimeZone(
  value: string | null,
  timeZone: string,
) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = timeZoneParts(date, timeZone);

  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(
    parts.minute,
  ).padStart(2, "0")}`;
}

export function isoFromDateTimeLocalInTimeZone(
  value: string,
  timeZone: string,
) {
  const match = value.match(DATE_TIME_LOCAL_PATTERN);

  if (!match) {
    return "";
  }

  const [, year, month, day, hour, minute] = match;

  return isoFromDateKeyAndMinutes(
    `${year}-${month}-${day}`,
    Number(hour) * 60 + Number(minute),
    timeZone,
  );
}

export function providerDateTimeToIso(
  value: string | null,
  timeZoneInput: string | null | undefined,
) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const timeZone = safeTimeZone(timeZoneInput);

  if (DATE_KEY_PATTERN.test(trimmed)) {
    return isoFromDateKeyAndMinutes(trimmed, 0, timeZone);
  }

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const localMatch = trimmed.match(DATE_TIME_LOCAL_PATTERN);

  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    return isoFromDateKeyAndMinutes(
      `${year}-${month}-${day}`,
      Number(hour) * 60 + Number(minute),
      timeZone,
    );
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
