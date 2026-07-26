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

/**
 * Every selectable time in a day, for a picker.
 *
 * `include` keeps an existing value selectable even when it does not land on
 * the step -- an event synced from Google at 07:05 must not silently snap to
 * 07:00 just because the picker only offers quarter hours.
 */
export function timeOfDayOptions({
  include,
  stepMinutes = 15,
}: {
  include?: string | null;
  stepMinutes?: number;
} = {}) {
  const step = Math.max(1, Math.round(stepMinutes));
  const values: string[] = [];

  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    values.push(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  }

  if (include && isTimeOfDay(include) && !values.includes(include)) {
    values.push(include);
    values.sort();
  }

  return values.map((value) => ({ label: formatTimeOfDay(value), value }));
}
