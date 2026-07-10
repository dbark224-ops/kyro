"use client";

import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import { AddressAutocompleteField } from "../components/address-autocomplete-field";
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
} from "./actions";
import {
  googleMapsDirectionsUrl,
  type CalendarEntityOptions,
  type CalendarEventItem,
} from "../../lib/calendar/events";
import {
  CALENDAR_EVENT_TYPES,
  type CalendarSettings,
  type CalendarView,
} from "../../lib/calendar/settings";
import type { CalendarReadiness } from "../../lib/calendar/readiness";
import {
  addDaysToDateKey,
  addMonthsToDateKey,
  dateKeyInTimeZone,
  dateKeyToPlainDate,
  dateTimeLocalValueInTimeZone,
  isoFromDateKeyAndMinutes,
  isoFromDateTimeLocalInTimeZone,
  startOfMonthDateKey,
  startOfWeekDateKey,
  todayDateKey,
} from "../../lib/timezone";
import styles from "./calendar-board.module.css";

type CalendarBoardProps = Readonly<{
  anchorDate: string;
  calendarReadiness: CalendarReadiness;
  events: CalendarEventItem[];
  initialSelectedEventId: string | null;
  options: CalendarEntityOptions;
  settings: CalendarSettings;
  timeZone: string;
  view: CalendarView;
}>;

type NewEventTimes = {
  end: string;
  start: string;
};

type TimelineClickPosition = {
  clientY: number;
  height: number;
  top: number;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMELINE_VISIBLE_START_HOUR = 6;
const TIMELINE_VISIBLE_END_HOUR = 18;
const TIMELINE_BUFFER_MINUTES = 60;
const TIMELINE_START_MINUTES =
  TIMELINE_VISIBLE_START_HOUR * 60 - TIMELINE_BUFFER_MINUTES;
const TIMELINE_END_MINUTES =
  TIMELINE_VISIBLE_END_HOUR * 60 + TIMELINE_BUFFER_MINUTES;
const TIMELINE_TOTAL_MINUTES =
  TIMELINE_END_MINUTES - TIMELINE_START_MINUTES;
const TIMELINE_MIN_EVENT_MINUTES = 34;
const TIMELINE_CREATE_SLOT_MINUTES = 30;
const TIMELINE_LABEL_HOURS = Array.from(
  { length: TIMELINE_VISIBLE_END_HOUR - TIMELINE_VISIBLE_START_HOUR + 1 },
  (_, index) => TIMELINE_VISIBLE_START_HOUR + index,
);

function addDays(date: Date, days: number) {
  return dateKeyToPlainDate(addDaysToDateKey(formatDateParam(date), days));
}

function startOfWeek(date: Date) {
  return dateKeyToPlainDate(startOfWeekDateKey(formatDateParam(date)));
}

function startOfMonth(date: Date) {
  return dateKeyToPlainDate(startOfMonthDateKey(formatDateParam(date)));
}

function addMonths(date: Date, months: number) {
  return dateKeyToPlainDate(addMonthsToDateKey(formatDateParam(date), months));
}

function formatDateParam(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(value: string | null, timeZone: string) {
  if (!value) {
    return "No time set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function formatTime(value: string | null, timeZone: string) {
  if (!value) {
    return "Any time";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatHourLabel(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;

  return `${displayHour}${suffix}`;
}

function isoFromCalendarDayAndMinutes(
  day: Date,
  minutes: number,
  timeZone: string,
) {
  return isoFromDateKeyAndMinutes(formatDateParam(day), minutes, timeZone);
}

function minutesInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const hour = Number(
    parts.find((current) => current.type === "hour")?.value ?? "0",
  );
  const minute = Number(
    parts.find((current) => current.type === "minute")?.value ?? "0",
  );

  return hour * 60 + minute;
}

function timelinePercent(minutes: number) {
  return ((minutes - TIMELINE_START_MINUTES) / TIMELINE_TOTAL_MINUTES) * 100;
}

function clampTimelineMinutes(minutes: number) {
  return Math.max(
    0,
    Math.min(24 * 60 - TIMELINE_CREATE_SLOT_MINUTES, minutes),
  );
}

function timelineClickMinutes(position: TimelineClickPosition) {
  const ratio =
    position.height > 0
      ? Math.min(
          1,
          Math.max(0, (position.clientY - position.top) / position.height),
        )
      : 0;
  const rawMinutes =
    TIMELINE_START_MINUTES + TIMELINE_TOTAL_MINUTES * ratio;
  const rounded =
    Math.round(rawMinutes / TIMELINE_CREATE_SLOT_MINUTES) *
    TIMELINE_CREATE_SLOT_MINUTES;

  return clampTimelineMinutes(rounded);
}

function timelineCreateTimes({
  day,
  position,
  settings,
  timeZone,
}: {
  day: Date;
  position: TimelineClickPosition;
  settings: CalendarSettings;
  timeZone: string;
}): NewEventTimes {
  const start = isoFromCalendarDayAndMinutes(
    day,
    timelineClickMinutes(position),
    timeZone,
  );
  const end = new Date(
    new Date(start).getTime() + settings.defaultDurationMinutes * 60_000,
  ).toISOString();

  return { end, start };
}

function timelineEventMetrics(event: CalendarEventItem, timeZone: string) {
  if (!event.startsAt) {
    return {
      edge: "normal",
      style: { height: "6%", top: "0%" } satisfies CSSProperties,
    };
  }

  const start = minutesInTimeZone(event.startsAt, timeZone);
  const startDate = new Date(event.startsAt);
  const endDate = event.endsAt ? new Date(event.endsAt) : null;
  const duration =
    endDate && !Number.isNaN(endDate.getTime()) && endDate > startDate
      ? Math.max(
          TIMELINE_MIN_EVENT_MINUTES,
          Math.round((endDate.getTime() - startDate.getTime()) / 60_000),
        )
      : 60;
  const latestStart = TIMELINE_END_MINUTES - TIMELINE_MIN_EVENT_MINUTES;
  const clampedStart = Math.min(
    Math.max(start, TIMELINE_START_MINUTES),
    latestStart,
  );
  const clampedEnd = Math.min(
    Math.max(start + duration, clampedStart + TIMELINE_MIN_EVENT_MINUTES),
    TIMELINE_END_MINUTES,
  );
  const height = Math.max(
    (TIMELINE_MIN_EVENT_MINUTES / TIMELINE_TOTAL_MINUTES) * 100,
    ((clampedEnd - clampedStart) / TIMELINE_TOTAL_MINUTES) * 100,
  );
  const top = Math.min(timelinePercent(clampedStart), 100 - height);
  const edge =
    start < TIMELINE_VISIBLE_START_HOUR * 60
      ? "early"
      : start >= TIMELINE_VISIBLE_END_HOUR * 60
        ? "late"
        : "normal";

  return {
    edge,
    style: {
      height: `${height}%`,
      top: `${top}%`,
    } satisfies CSSProperties,
  };
}

function dateTimeLocalValue(value: string | null, timeZone: string) {
  return dateTimeLocalValueInTimeZone(value, timeZone);
}

function isoFromDateTimeLocal(value: string, timeZone: string) {
  return value ? isoFromDateTimeLocalInTimeZone(value, timeZone) : "";
}

function displayType(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function calendarSyncDestination(event: CalendarEventItem) {
  if (event.externalCalendarProvider) {
    return `${displayType(event.externalCalendarProvider)} calendar`;
  }

  return event.externalSyncStatus === "failed"
    ? "Calendar sync needs attention."
    : "Will sync when a connected calendar is available.";
}

function calendarSyncDetail(event: CalendarEventItem) {
  return event.externalSyncStatus === "failed"
    ? null
    : calendarSyncDestination(event);
}

function providerLabel(provider: "google" | "microsoft") {
  return provider === "google" ? "Google" : "Outlook";
}

function syncProviderLabel(provider: CalendarSettings["syncProvider"]) {
  return provider === "google"
    ? "Google"
    : provider === "microsoft"
      ? "Outlook"
      : "Calendar";
}

function calendarSyncBadge(
  settings: CalendarSettings,
  readiness: CalendarReadiness,
) {
  if (settings.syncProvider === "none") {
    return { label: "Kyro only", status: "not_synced" as const };
  }

  if (readiness.error) {
    return { label: "Calendar status unavailable", status: "failed" as const };
  }

  const selectedProviders =
    settings.syncProvider === "auto"
      ? (["google", "microsoft"] as const)
      : ([settings.syncProvider] as const);
  const providers = readiness.providers.filter((provider) =>
    selectedProviders.includes(provider.provider),
  );
  const readyProviders = providers.filter((provider) => provider.calendarReady);

  if (readyProviders.length > 0) {
    const label =
      readyProviders.length > 1
        ? "Google + Outlook sync ready"
        : `${providerLabel(readyProviders[0].provider)} sync ready`;

    return { label, status: "synced" as const };
  }

  if (providers.some((provider) => provider.connected)) {
    const label =
      settings.syncProvider === "auto"
        ? "Calendar needs reconnect"
        : `${syncProviderLabel(settings.syncProvider)} needs reconnect`;

    return { label, status: "failed" as const };
  }

  const label =
    settings.syncProvider === "auto"
      ? "Connect calendar"
      : `Connect ${syncProviderLabel(settings.syncProvider)}`;

  return { label, status: "not_synced" as const };
}

function viewHref(view: CalendarView, date: Date) {
  const params = new URLSearchParams({
    date: formatDateParam(date),
    view,
  });

  return `/calendar?${params.toString()}`;
}

function adjacentCalendarHrefs(view: CalendarView, anchor: Date, timeZone: string) {
  const adjacentDates =
    view === "month"
      ? [-1, 1].map(
          (offset) =>
            addMonths(anchor, offset),
        )
      : view === "week"
        ? [-14, -7, 7, 14].map((offset) => addDays(anchor, offset))
        : [-2, -1, 1, 2].map((offset) => addDays(anchor, offset));
  const viewSwitchHrefs = (["day", "week", "month"] as const)
    .filter((nextView) => nextView !== view)
    .map((nextView) => viewHref(nextView, anchor));

  return [
    ...new Set([
      ...adjacentDates.map((date) => viewHref(view, date)),
      ...viewSwitchHrefs,
      viewHref(view, dateKeyToPlainDate(todayDateKey(timeZone))),
    ]),
  ];
}

function rangeForView(anchor: Date, view: CalendarView) {
  if (view === "day") {
    const from = dateKeyToPlainDate(formatDateParam(anchor));
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

function rangeLabel(anchor: Date, view: CalendarView, timeZone: string) {
  const anchorNoon = new Date(
    isoFromCalendarDayAndMinutes(anchor, 12 * 60, timeZone),
  );

  if (view === "day") {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "long",
      timeZone,
      weekday: "long",
      year: "numeric",
    }).format(anchorNoon);
  }

  if (view === "month") {
    return new Intl.DateTimeFormat("en", {
      month: "long",
      timeZone,
      year: "numeric",
    }).format(anchorNoon);
  }

  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  const startNoon = new Date(
    isoFromCalendarDayAndMinutes(start, 12 * 60, timeZone),
  );
  const endNoon = new Date(
    isoFromCalendarDayAndMinutes(end, 12 * 60, timeZone),
  );
  const formatter = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone,
  });

  return `${formatter.format(startNoon)} - ${formatter.format(endNoon)}`;
}

function eventsForDay(
  events: CalendarEventItem[],
  day: Date,
  timeZone: string,
) {
  const dayKey = formatDateParam(day);

  return events
    .filter(
      (event) =>
        Boolean(event.startsAt) &&
        dateKeyInTimeZone(event.startsAt as string, timeZone) === dayKey,
    )
    .sort((first, second) => {
      const firstTime = first.startsAt
        ? new Date(first.startsAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const secondTime = second.startsAt
        ? new Date(second.startsAt).getTime()
        : Number.MAX_SAFE_INTEGER;

      return firstTime - secondTime;
    });
}

function eventsInRange(
  events: CalendarEventItem[],
  range: ReturnType<typeof rangeForView>,
  timeZone: string,
) {
  const from = formatDateParam(range.from);
  const to = formatDateParam(range.to);

  return events.filter((event) => {
    if (!event.startsAt) {
      return false;
    }

    const eventDay = dateKeyInTimeZone(event.startsAt, timeZone);
    return eventDay >= from && eventDay < to;
  });
}

function contactLabel(event: CalendarEventItem) {
  return (
    event.contact?.name ??
    event.contact?.company ??
    event.contact?.email ??
    event.lead?.title ??
    event.conversation?.leadTitle ??
    null
  );
}

function truncateCalendarTitle(title: string, enabled: boolean) {
  const limit = 34;

  return enabled && title.length > limit
    ? `${title.slice(0, limit - 1).trimEnd()}...`
    : title;
}

function SubmitButton({
  children,
  className = "primary-button compact",
}: Readonly<{ children: string; className?: string }>) {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? "Saving..." : children}
    </button>
  );
}

function ChevronIcon({
  direction,
}: Readonly<{ direction: "next" | "previous" }>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path
        d={direction === "previous" ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function DateTimeInput({
  defaultValue,
  label,
  name,
  timeZone,
}: Readonly<{
  defaultValue: string | null;
  label: string;
  name: string;
  timeZone: string;
}>) {
  const [value, setValue] = useState(dateTimeLocalValue(defaultValue, timeZone));

  return (
    <label>
      {label}
      <input
        name={`${name}Local`}
        onChange={(event) => setValue(event.target.value)}
        type="datetime-local"
        value={value}
      />
      <input
        name={name}
        type="hidden"
        value={isoFromDateTimeLocal(value, timeZone)}
      />
    </label>
  );
}

function EventCard({
  active,
  condensed = false,
  event,
  onSelect,
  timeZone,
}: Readonly<{
  active: boolean;
  condensed?: boolean;
  event: CalendarEventItem;
  onSelect: () => void;
  timeZone: string;
}>) {
  const linkedLabel = contactLabel(event);

  return (
    <button
      className={styles.eventCard}
      data-active={active}
      data-condensed={condensed}
      onClick={onSelect}
      type="button"
    >
      <div className={styles.eventCardPrimary}>
        <time>{formatTime(event.startsAt, timeZone)}</time>
        <strong>{truncateCalendarTitle(event.title, condensed)}</strong>
      </div>
      {event.location ? <span>{event.location}</span> : null}
      {linkedLabel ? <span>{linkedLabel}</span> : null}
    </button>
  );
}

function TimelineAxis() {
  return (
    <div className={styles.timelineAxis} aria-hidden="true">
      {TIMELINE_LABEL_HOURS.map((hour) => (
        <span
          className={styles.timelineAxisLabel}
          key={hour}
          style={{ top: `${timelinePercent(hour * 60)}%` }}
        >
          {formatHourLabel(hour)}
        </span>
      ))}
    </div>
  );
}

function TimelineLines() {
  return (
    <>
      {TIMELINE_LABEL_HOURS.map((hour) => (
        <span
          className={styles.timelineLine}
          key={hour}
          style={{ top: `${timelinePercent(hour * 60)}%` }}
        />
      ))}
    </>
  );
}

function TimelineEventCard({
  active,
  compact = false,
  condensed = false,
  event,
  onSelect,
  timeZone,
}: Readonly<{
  active: boolean;
  compact?: boolean;
  condensed?: boolean;
  event: CalendarEventItem;
  onSelect: () => void;
  timeZone: string;
}>) {
  const metrics = timelineEventMetrics(event, timeZone);
  const linkedLabel = contactLabel(event);

  return (
    <button
      className={styles.timelineEvent}
      data-active={active}
      data-compact={compact}
      data-condensed={condensed}
      data-edge={metrics.edge}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      title={condensed ? event.title : undefined}
      style={metrics.style}
      type="button"
    >
      <span className={styles.timelineEventTop}>
        <time>{formatTime(event.startsAt, timeZone)}</time>
        <strong>{truncateCalendarTitle(event.title, condensed)}</strong>
      </span>
      {compact ? null : (
        <>
          {event.location ? <span>{event.location}</span> : null}
          {linkedLabel ? <span>{linkedLabel}</span> : null}
        </>
      )}
    </button>
  );
}

function MonthView({
  activeEventId,
  anchor,
  condensed,
  events,
  onSelect,
  timeZone,
}: Readonly<{
  activeEventId: string | null;
  anchor: Date;
  condensed: boolean;
  events: CalendarEventItem[];
  onSelect: (eventId: string) => void;
  timeZone: string;
}>) {
  const firstOfMonth = startOfMonth(anchor);
  const firstDay = startOfWeek(firstOfMonth);
  const todayKey = todayDateKey(timeZone);
  const cells = Array.from({ length: 42 }, (_, index) =>
    addDays(firstDay, index),
  );

  return (
    <div className={styles.monthGrid}>
      {DAY_NAMES.map((day) => (
        <div className={styles.monthDayName} key={day}>
          {day}
        </div>
      ))}
      {cells.map((day) => {
        const dayEvents = eventsForDay(events, day, timeZone);
        const isMuted = day.getUTCMonth() !== anchor.getUTCMonth();
        const isToday = formatDateParam(day) === todayKey;

        return (
          <div
            className={[
              styles.monthCell,
              isMuted ? styles.monthCellMuted : null,
              isToday ? styles.monthCellToday : null,
            ]
              .filter(Boolean)
              .join(" ")}
            key={formatDateParam(day)}
          >
            <div className={styles.dayNumber}>{day.getUTCDate()}</div>
            <div className={styles.eventList}>
              {dayEvents.slice(0, 4).map((event) => (
                <EventCard
                  active={event.id === activeEventId}
                  condensed={condensed}
                  event={event}
                  key={event.id}
                  onSelect={() => onSelect(event.id)}
                  timeZone={timeZone}
                />
              ))}
              {dayEvents.length > 4 ? (
                <span className={styles.eventMeta}>
                  +{dayEvents.length - 4} more
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekView({
  activeEventId,
  anchor,
  condensed,
  events,
  onCreateAt,
  onSelect,
  timeZone,
}: Readonly<{
  activeEventId: string | null;
  anchor: Date;
  condensed: boolean;
  events: CalendarEventItem[];
  onCreateAt: (day: Date, position: TimelineClickPosition) => void;
  onSelect: (eventId: string) => void;
  timeZone: string;
}>) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  return (
    <div className={styles.weekGrid}>
      <div className={styles.timelineAxisSpacer} />
      {days.map((day) => (
        <div className={styles.weekHeader} key={formatDateParam(day)}>
          <strong>{DAY_NAMES[(day.getUTCDay() + 6) % 7]}</strong>
          <span>{day.getUTCDate()}</span>
        </div>
      ))}
      <TimelineAxis />
      {days.map((day) => {
        const dayEvents = eventsForDay(events, day, timeZone);

        return (
          <div
            className={styles.timelineDay}
            data-clickable="true"
            key={formatDateParam(day)}
            onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onCreateAt(day, {
                clientY: event.clientY,
                height: rect.height,
                top: rect.top,
              });
            }}
          >
            <TimelineLines />
            {dayEvents.map((event) => (
              <TimelineEventCard
                active={event.id === activeEventId}
                compact
                condensed={condensed}
                event={event}
                key={event.id}
                onSelect={() => onSelect(event.id)}
                timeZone={timeZone}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  activeEventId,
  anchor,
  condensed,
  events,
  onCreateAt,
  onSelect,
  timeZone,
}: Readonly<{
  activeEventId: string | null;
  anchor: Date;
  condensed: boolean;
  events: CalendarEventItem[];
  onCreateAt: (day: Date, position: TimelineClickPosition) => void;
  onSelect: (eventId: string) => void;
  timeZone: string;
}>) {
  const dayEvents = eventsForDay(events, anchor, timeZone);

  return (
    <div className={styles.dayTimeline}>
      <TimelineAxis />
      <div
        className={styles.timelineDay}
        data-clickable="true"
        data-view="day"
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onCreateAt(anchor, {
            clientY: event.clientY,
            height: rect.height,
            top: rect.top,
          });
        }}
      >
        <TimelineLines />
        {dayEvents.length > 0 ? (
          dayEvents.map((event) => (
            <TimelineEventCard
              active={event.id === activeEventId}
              condensed={condensed}
              event={event}
              key={event.id}
              onSelect={() => onSelect(event.id)}
              timeZone={timeZone}
            />
          ))
        ) : (
          <p className={styles.emptyState}>No events on this day yet.</p>
        )}
      </div>
    </div>
  );
}

function eventStartForNew(settings: CalendarSettings, timeZone: string) {
  const nowIso = new Date().toISOString();
  const todayKey = dateKeyInTimeZone(nowIso, timeZone);
  const currentMinutes = minutesInTimeZone(nowIso, timeZone);
  const roundedStartMinutes =
    (Math.floor(currentMinutes / 60) + 1) * 60;
  const startDayOffset = Math.floor(roundedStartMinutes / (24 * 60));
  const startMinutes = roundedStartMinutes % (24 * 60);
  const start = isoFromDateKeyAndMinutes(
    addDaysToDateKey(todayKey, startDayOffset),
    startMinutes,
    timeZone,
  );
  const end = new Date(
    new Date(start).getTime() + settings.defaultDurationMinutes * 60_000,
  );

  return {
    end: end.toISOString(),
    start,
  };
}

function EventEditor({
  currentHref,
  event,
  initialTimes,
  mode,
  onClose,
  onNew,
  options,
  settings,
  timeZone,
  variant = "side",
}: Readonly<{
  currentHref: string;
  event: CalendarEventItem | null;
  initialTimes?: NewEventTimes | null;
  mode: "create" | "edit";
  onClose?: () => void;
  onNew: () => void;
  options: CalendarEntityOptions;
  settings: CalendarSettings;
  timeZone: string;
  variant?: "modal" | "side";
}>) {
  const fallbackNewTimes = useMemo(
    () => eventStartForNew(settings, timeZone),
    [settings, timeZone],
  );
  const newTimes = initialTimes ?? fallbackNewTimes;
  const directionsUrl = event
    ? googleMapsDirectionsUrl(event.location, event.locationAddress)
    : null;
  const defaultContactId = event?.contactId ?? "";
  const defaultLeadId = event?.leadId ?? "";
  const defaultConversationId = event?.conversationId ?? "";
  const syncDetail = event ? calendarSyncDetail(event) : null;
  const action =
    mode === "edit" ? updateCalendarEventAction : createCalendarEventAction;

  return (
    <aside
      className={[
        styles.editorPanel,
        variant === "modal" ? styles.editorPanelModal : null,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.editorHeader}>
        <div>
          <p className="eyebrow">Event</p>
          <h2>
            {mode === "edit" ? "Edit calendar event" : "Add calendar event"}
          </h2>
          <p>
            {mode === "edit"
              ? `Updated ${formatLocalDateTime(event?.updatedAt ?? null, timeZone)}`
              : "Create a Kyro event and sync it to the connected calendar."}
          </p>
        </div>
        <button
          className="secondary-button compact"
          onClick={variant === "modal" ? (onClose ?? onNew) : onNew}
          type="button"
        >
          {variant === "modal" ? "Close" : "New"}
        </button>
      </div>

      <form
        action={action}
        className={styles.editorForm}
        key={event?.id ?? newTimes.start}
      >
        {event ? (
          <input name="appointmentId" type="hidden" value={event.id} />
        ) : null}
        <input name="redirectTo" type="hidden" value={currentHref} />
        <div className={styles.formGrid}>
          <label className={styles.fullWidth}>
            Title
            <input
              defaultValue={event?.title ?? ""}
              name="title"
              placeholder="Quote visit, job, call back..."
              required
              type="text"
            />
          </label>
          <label>
            Type
            <select
              defaultValue={event?.appointmentType ?? settings.defaultEventType}
              name="appointmentType"
            >
              {CALENDAR_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {displayType(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select defaultValue={event?.status ?? "scheduled"} name="status">
              <option value="scheduled">Scheduled</option>
              <option value="suggested">Suggested</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <DateTimeInput
            defaultValue={event?.startsAt ?? newTimes.start}
            label="Start"
            name="startsAt"
            timeZone={timeZone}
          />
          <DateTimeInput
            defaultValue={event?.endsAt ?? newTimes.end}
            label="End"
            name="endsAt"
            timeZone={timeZone}
          />
          <label>
            Contact
            <select defaultValue={defaultContactId} name="contactId">
              <option value="">No contact</option>
              {options.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lead
            <select defaultValue={defaultLeadId} name="leadId">
              <option value="">No lead</option>
              {options.leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fullWidth}>
            Inquiry
            <select defaultValue={defaultConversationId} name="conversationId">
              <option value="">No linked inquiry</option>
              {options.conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.label}
                  {conversation.detail ? ` - ${conversation.detail}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.fullWidth}>
            <AddressAutocompleteField
              defaultValue={event?.location ?? ""}
              label="Address"
              name="location"
              placeholder="Start typing the event address..."
            />
            {directionsUrl ? (
              <a
                className={styles.directionsLink}
                href={directionsUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open directions
              </a>
            ) : null}
          </div>
          <label className={styles.fullWidth}>
            Notes
            <textarea
              defaultValue={event?.description ?? ""}
              name="description"
              placeholder="Access notes, customer preference, quote details..."
            />
          </label>
        </div>

        <div className={styles.syncLine}>
          {event ? (
            <>
              <span
                className={styles.syncPill}
                data-status={event.externalSyncStatus ?? "not_synced"}
              >
                {event.externalSyncStatus === "synced"
                  ? "Synced"
                  : event.externalSyncStatus === "failed"
                    ? "Sync failed"
                    : "Kyro calendar"}
              </span>
              {syncDetail ? <span>{syncDetail}</span> : null}
            </>
          ) : (
            "New events write back to Google or Outlook when a connected calendar is available."
          )}
        </div>

        <div className={styles.editorActions}>
          <div className={styles.submitRow}>
            <SubmitButton>
              {mode === "edit" ? "Save event" : "Create event"}
            </SubmitButton>
          </div>
        </div>
      </form>

      {event ? (
        <form action={deleteCalendarEventAction} className={styles.editorForm}>
          <input name="appointmentId" type="hidden" value={event.id} />
          <input name="redirectTo" type="hidden" value={currentHref} />
          <button className={styles.dangerButton} type="submit">
            Delete event
          </button>
        </form>
      ) : null}
    </aside>
  );
}

export function CalendarBoard({
  anchorDate,
  calendarReadiness,
  events,
  initialSelectedEventId,
  options,
  settings,
  timeZone,
  view,
}: CalendarBoardProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const anchor = useMemo(
    () => dateKeyToPlainDate(anchorDate),
    [anchorDate],
  );
  const [currentView, setCurrentView] = useState<CalendarView>(view);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialSelectedEventId,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [createTimes, setCreateTimes] = useState<NewEventTimes | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const visibleRange = useMemo(
    () => rangeForView(anchor, currentView),
    [anchor, currentView],
  );
  const visibleEvents = useMemo(
    () => eventsInRange(events, visibleRange, timeZone),
    [events, visibleRange, timeZone],
  );
  const currentHref = viewHref(currentView, anchor);
  const prefetchedHrefs = useMemo(
    () => adjacentCalendarHrefs(currentView, anchor, timeZone),
    [anchor, currentView, timeZone],
  );
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? null;

  useEffect(() => {
    prefetchedHrefs.forEach((href) => {
      router.prefetch(href);
    });
  }, [prefetchedHrefs, router]);

  const selectEvent = (eventId: string) => {
    setCreateOpen(false);
    setCreateTimes(null);
    setSelectedEventId(eventId);
  };
  const openCreateEvent = (times: NewEventTimes | null = null) => {
    setCreateTimes(times);
    setCreateOpen(true);
  };
  const closeCreateEvent = () => {
    setCreateOpen(false);
    setCreateTimes(null);
  };
  const createEventFromTimeline = (
    day: Date,
    position: TimelineClickPosition,
  ) => {
    openCreateEvent(
      timelineCreateTimes({
        day,
        position,
        settings,
        timeZone,
      }),
    );
  };
  const switchView = (nextView: CalendarView) => {
    setCurrentView(nextView);
    window.history.replaceState(null, "", viewHref(nextView, anchor));
  };
  const navigateCalendar = (href: string) => {
    if (href === currentHref) {
      return;
    }

    setPendingHref(href);
    startNavigation(() => {
      router.push(href);
    });
  };
  const previousDate =
    currentView === "month"
      ? addMonths(anchor, -1)
      : addDays(anchor, currentView === "week" ? -7 : -1);
  const nextDate =
    currentView === "month"
      ? addMonths(anchor, 1)
      : addDays(anchor, currentView === "week" ? 7 : 1);
  const todayDate = dateKeyToPlainDate(todayDateKey(timeZone));
  const scheduledEvents = visibleEvents.filter((event) => event.startsAt);
  const unsyncedCount = visibleEvents.filter(
    (event) =>
      event.startsAt &&
      event.externalSyncStatus &&
      event.externalSyncStatus !== "synced",
  ).length;
  const calendarIsPending = Boolean(pendingHref || isNavigating);
  const syncBadge = calendarSyncBadge(settings, calendarReadiness);

  return (
    <div className={styles.calendarShell}>
      <div
        className={[
          styles.calendarGrid,
          selectedEvent ? null : styles.calendarGridFull,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <section aria-busy={calendarIsPending} className={styles.calendarPanel}>
          <div className={styles.calendarPanelHeader}>
            <div className={styles.calendarTitleCluster}>
              <div className={styles.calendarTitleLine}>
                <div className={styles.calendarTitle}>
                  <h2>{rangeLabel(anchor, currentView, timeZone)}</h2>
                </div>
                <div className={styles.viewSwitch} aria-label="Calendar view">
                  {(["day", "week", "month"] as const).map((nextView) => (
                    <button
                      data-active={currentView === nextView}
                      key={nextView}
                      onClick={() => switchView(nextView)}
                      type="button"
                    >
                      {nextView}
                    </button>
                  ))}
                </div>
              </div>
              <p>
                {scheduledEvents.length} scheduled event
                {scheduledEvents.length === 1 ? "" : "s"}
                {unsyncedCount > 0 ? ` - ${unsyncedCount} needing sync` : ""}
              </p>
            </div>
            <div className={styles.calendarHeaderActions}>
              <span className={styles.syncPill} data-status={syncBadge.status}>
                {syncBadge.label}
              </span>
              <button
                className={`secondary-button compact ${styles.calendarNavButton}`}
                onClick={() =>
                  navigateCalendar(viewHref(currentView, previousDate))
                }
                type="button"
              >
                <ChevronIcon direction="previous" />
                Prev
              </button>
              <button
                className="secondary-button compact"
                onClick={() =>
                  navigateCalendar(viewHref(currentView, todayDate))
                }
                type="button"
              >
                Today
              </button>
              <button
                className={`secondary-button compact ${styles.calendarNavButton}`}
                onClick={() => navigateCalendar(viewHref(currentView, nextDate))}
                type="button"
              >
                Next
                <ChevronIcon direction="next" />
              </button>
              <button
                className="primary-button compact"
                onClick={() => openCreateEvent()}
                type="button"
              >
                + Add
              </button>
            </div>
          </div>

          {calendarIsPending ? (
            <div className={styles.calendarPendingOverlay} aria-live="polite">
              <span
                className={styles.calendarPendingSpinner}
                aria-hidden="true"
              />
              <span>Loading calendar</span>
            </div>
          ) : null}

          {currentView === "month" ? (
            <MonthView
              activeEventId={selectedEventId}
              anchor={anchor}
              condensed={Boolean(selectedEvent)}
              events={visibleEvents}
              onSelect={selectEvent}
              timeZone={timeZone}
            />
          ) : null}
          {currentView === "week" ? (
            <WeekView
              activeEventId={selectedEventId}
              anchor={anchor}
              condensed={Boolean(selectedEvent)}
              events={visibleEvents}
              onCreateAt={createEventFromTimeline}
              onSelect={selectEvent}
              timeZone={timeZone}
            />
          ) : null}
          {currentView === "day" ? (
            <DayView
              activeEventId={selectedEventId}
              anchor={anchor}
              condensed={Boolean(selectedEvent)}
              events={visibleEvents}
              onCreateAt={createEventFromTimeline}
              onSelect={selectEvent}
              timeZone={timeZone}
            />
          ) : null}
        </section>

        {selectedEvent ? (
          <EventEditor
            currentHref={currentHref}
            event={selectedEvent}
            mode="edit"
            onNew={() => openCreateEvent()}
            options={options}
            settings={settings}
            timeZone={timeZone}
          />
        ) : null}
      </div>

      {createOpen ? (
        <div className={styles.modalBackdrop}>
          <div
            aria-label="Add calendar event"
            aria-modal="true"
            className={styles.modalPanel}
            role="dialog"
          >
            <EventEditor
              currentHref={currentHref}
              event={null}
              initialTimes={createTimes}
              mode="create"
              onClose={closeCreateEvent}
              onNew={closeCreateEvent}
              options={options}
              settings={settings}
              timeZone={timeZone}
              variant="modal"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
