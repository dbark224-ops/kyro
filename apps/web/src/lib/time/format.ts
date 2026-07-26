/**
 * Dates as the business sees them.
 *
 * A workspace operates in one timezone, and every date shown to its user should
 * be rendered in that timezone. Left to itself, `Intl.DateTimeFormat` uses the
 * runtime's zone -- which on Vercel is UTC -- so an Australian workspace saw a
 * 9am Melbourne message dated the previous evening. Not merely the wrong time:
 * the wrong day, for roughly the first ten hours of every working day.
 *
 * Nineteen local copies of a date formatter used to make this decision
 * independently, twelve of them ignoring the timezone entirely and disagreeing
 * about format and empty label. These are the replacements. Pass the workspace
 * timezone and the answer is right, and identical everywhere.
 */

type FormatInput = {
  emptyLabel?: string;
  locale?: string;
  timeZone?: string | null;
  value: Date | string | null | undefined;
};

function formatted(
  { emptyLabel = "-", locale = "en", timeZone, value }: FormatInput,
  options: Intl.DateTimeFormatOptions,
) {
  if (!value) {
    return emptyLabel;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return emptyLabel;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: timeZone?.trim() || undefined,
    }).format(date);
  } catch {
    // An unusable timezone must not blank the screen. Falling back to the
    // runtime's zone shows a date that is merely offset rather than absent.
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

/** Day, month and time: "26 Jul, 6:57 am". The default across the app. */
export function formatWorkspaceDateTime(input: FormatInput) {
  return formatted(input, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

/** Day and month only: "26 Jul". For rows where the time adds nothing. */
export function formatWorkspaceDate(input: FormatInput) {
  return formatted(input, {
    day: "numeric",
    month: "short",
  });
}

/** Day, month and year: "26 Jul 2026". For anything that outlives a week. */
export function formatWorkspaceDateWithYear(input: FormatInput) {
  return formatted(input, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Day, month, year and time: "26 Jul 2026, 6:57 am". For reports and exported
 * documents, which are read long after the week they cover.
 */
export function formatWorkspaceDateTimeWithYear(input: FormatInput) {
  return formatted(input, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Time only: "6:57 am". For grouped views that already show the day. */
export function formatWorkspaceTime(input: FormatInput) {
  return formatted(input, {
    hour: "numeric",
    minute: "2-digit",
  });
}
