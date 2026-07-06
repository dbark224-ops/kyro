import type { MobileCalendarEvent } from "./mobile-api-types";

export type MobileCalendarView = "day" | "week" | "month";

export const calendarViewLabels: Record<MobileCalendarView, string> = {
  day: "Day",
  month: "Month",
  week: "Week",
};

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(date: Date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return startOfDay(addDays(date, mondayOffset));
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function formatDateParam(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function rangeForCalendarView(anchor: Date, view: MobileCalendarView) {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }

  if (view === "month") {
    const from = startOfWeek(startOfMonth(anchor));
    const to = addDays(startOfWeek(addMonths(anchor, 1)), 7);
    return { from, to };
  }

  const from = startOfWeek(anchor);
  return { from, to: addDays(from, 7) };
}

export function rangeLabel(anchor: Date, view: MobileCalendarView) {
  if (view === "day") {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      weekday: "long",
    }).format(anchor);
  }

  if (view === "month") {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    }).format(anchor);
  }

  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  const formatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  });

  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

export function eventsInRange(
  events: MobileCalendarEvent[],
  range: ReturnType<typeof rangeForCalendarView>,
) {
  const from = range.from.getTime();
  const to = range.to.getTime();

  return events.filter((event) => {
    if (!event.startsAt) {
      return false;
    }

    const time = new Date(event.startsAt).getTime();

    return time >= from && time < to;
  });
}

export function eventsForDay(events: MobileCalendarEvent[], day: Date) {
  return eventsInRange(events, {
    from: startOfDay(day),
    to: addDays(startOfDay(day), 1),
  });
}

export function eventContactLabel(event: MobileCalendarEvent) {
  return (
    event.contact?.name ??
    event.contact?.company ??
    event.contact?.email ??
    event.contact?.phone ??
    event.lead?.title ??
    "No contact linked"
  );
}

export function formatEventTime(value: string | null) {
  if (!value) {
    return "Any time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Any time";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
