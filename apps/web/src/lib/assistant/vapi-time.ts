export type VapiCurrentTimeContext = {
  currentDate: string;
  currentDateTime: string;
  currentIsoUtc: string;
  currentTime: string;
  currentTimezone: string;
  promptLine: string;
  variableValues: Record<string, string>;
};

function safeTimeZone(timeZone: string | null | undefined) {
  const candidate = timeZone?.trim() || "UTC";

  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date());

    return candidate;
  } catch {
    return "UTC";
  }
}

function formatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    ...options,
  });
}

export function buildVapiCurrentTimeContext(
  timeZone: string | null | undefined,
  now = new Date(),
): VapiCurrentTimeContext {
  const currentTimezone = safeTimeZone(timeZone);
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
  const promptLine = [
    `Current date/time: ${currentDateTime}.`,
    `Timezone: ${currentTimezone}.`,
    `UTC ISO timestamp: ${currentIsoUtc}.`,
    "Use this as the source of truth for today, tomorrow, this week, relative dates, and appointment times unless the caller explicitly gives another timezone.",
  ].join(" ");

  return {
    currentDate,
    currentDateTime,
    currentIsoUtc,
    currentTime,
    currentTimezone,
    promptLine,
    variableValues: {
      current_date: currentDate,
      current_datetime: currentDateTime,
      current_iso_utc: currentIsoUtc,
      current_time: currentTime,
      current_timezone: currentTimezone,
    },
  };
}
