export function formatWorkspaceDateTime({
  emptyLabel = "-",
  locale = "en",
  timeZone,
  value,
}: {
  emptyLabel?: string;
  locale?: string;
  timeZone?: string | null;
  value: string | null | undefined;
}) {
  if (!value) {
    return emptyLabel;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return emptyLabel;
  }

  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  };

  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: timeZone?.trim() || undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}
