/**
 * Wall-clock times: "09:00", "14:30". No date, no timezone.
 *
 * These are the times a business types rather than instants on a timeline --
 * opening hours, an appointment slot the user is choosing. They are formatted
 * against a fixed synthetic date precisely so no timezone is involved: 14:30
 * means half past two wherever you are reading it.
 *
 * The formatter existed identically in settings/shared.tsx and
 * business-availability-editor.tsx before this; both now delegate here.
 */
const SYNTHETIC_DATE_YEAR = 2020;

function parts(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return { hour, minute };
}

/** "14:30" -> "2:30 PM". Returns the input unchanged if it is not a time. */
export function formatTimeOfDay(value: string) {
  const time = parts(value);

  if (!time) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(SYNTHETIC_DATE_YEAR, 0, 1, time.hour, time.minute));
}

export function isTimeOfDay(value: string) {
  return parts(value) !== null;
}

function toTimeOfDay(totalMinutes: number) {
  // Wraps across midnight in both directions, so stepping never lands on an
  // impossible time.
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);

  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(
    wrapped % 60,
  ).padStart(2, "0")}`;
}

export function timeOfDayMinutes(value: string) {
  const time = parts(value);

  return time ? time.hour * 60 + time.minute : null;
}

/**
 * Nudge the hour or the minute by one step.
 *
 * Minutes move to the next multiple of the step rather than by the step, so a
 * time that arrived off-grid -- 07:05 from a synced event -- tidies to 07:15
 * on the first press instead of drifting to 07:20 and staying odd forever.
 *
 * Minutes carry into the hour, because 09:45 pressed up is 10:00 to anyone
 * looking at it, not 09:00.
 */
export function stepTimeOfDay(
  value: string,
  part: "hour" | "minute",
  direction: 1 | -1,
  stepMinutes = 15,
) {
  const current = timeOfDayMinutes(value);

  if (current === null) {
    return value;
  }

  if (part === "hour") {
    return toTimeOfDay(current + direction * 60);
  }

  const step = Math.max(1, Math.round(stepMinutes));
  const minute = current % 60;
  const onGrid = minute % step === 0;
  const nextMinute =
    direction === 1
      ? (onGrid ? minute + step : Math.ceil(minute / step) * step)
      : (onGrid ? minute - step : Math.floor(minute / step) * step);

  return toTimeOfDay(current - minute + nextMinute);
}

/** Swap AM for PM. One press instead of twelve on the hour. */
export function toggleTimeOfDayMeridiem(value: string) {
  const current = timeOfDayMinutes(value);

  return current === null ? value : toTimeOfDay(current + 12 * 60);
}

/** The pieces a stepper renders: "14:30" -> 2, "30", "PM". */
export function timeOfDayDisplayParts(value: string) {
  const time = parts(value);

  if (!time) {
    return null;
  }

  return {
    hour: time.hour % 12 === 0 ? 12 : time.hour % 12,
    meridiem: time.hour >= 12 ? "PM" : "AM",
    minute: String(time.minute).padStart(2, "0"),
  };
}

