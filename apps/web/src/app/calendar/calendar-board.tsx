"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import {
  type CalendarSyncProvider,
  calendarProviderSyncErrorMessage,
} from "../../lib/calendar/sync-errors";
import styles from "./calendar-board.module.css";

type CalendarBoardProps = Readonly<{
  anchorDate: string;
  events: CalendarEventItem[];
  initialSelectedEventId: string | null;
  options: CalendarEntityOptions;
  settings: CalendarSettings;
  timeZone: string;
  view: CalendarView;
}>;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, mondayOffset));
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatDateParam(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

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

function dateTimeLocalValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function isoFromDateTimeLocal(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function displayType(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function calendarSyncProvider(
  value: string | null,
): CalendarSyncProvider | null {
  return value === "google" || value === "microsoft" ? value : null;
}

function calendarSyncDestination(event: CalendarEventItem) {
  if (event.externalCalendarProvider) {
    return `${displayType(event.externalCalendarProvider)} calendar`;
  }

  return event.externalSyncStatus === "failed"
    ? "Calendar sync needs attention."
    : "Will sync when a connected calendar is available.";
}

function calendarSyncError(event: CalendarEventItem) {
  return event.externalSyncError
    ? calendarProviderSyncErrorMessage(
        event.externalSyncError,
        calendarSyncProvider(event.externalCalendarProvider),
      )
    : null;
}

function viewHref(view: CalendarView, date: Date) {
  const params = new URLSearchParams({
    date: formatDateParam(date),
    view,
  });

  return `/calendar?${params.toString()}`;
}

function rangeForView(anchor: Date, view: CalendarView) {
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

function rangeLabel(anchor: Date, view: CalendarView, timeZone: string) {
  if (view === "day") {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "long",
      timeZone,
      weekday: "long",
      year: "numeric",
    }).format(anchor);
  }

  if (view === "month") {
    return new Intl.DateTimeFormat("en", {
      month: "long",
      timeZone,
      year: "numeric",
    }).format(anchor);
  }

  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  const formatter = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone,
  });

  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function eventsForDay(events: CalendarEventItem[], day: Date) {
  const start = startOfDay(day).getTime();
  const end = addDays(startOfDay(day), 1).getTime();

  return events.filter((event) => {
    if (!event.startsAt) {
      return false;
    }

    const time = new Date(event.startsAt).getTime();
    return time >= start && time < end;
  });
}

function eventsInRange(
  events: CalendarEventItem[],
  range: ReturnType<typeof rangeForView>,
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

function contactLabel(event: CalendarEventItem) {
  return (
    event.contact?.name ??
    event.contact?.company ??
    event.contact?.email ??
    event.lead?.title ??
    event.conversation?.leadTitle ??
    "No contact linked"
  );
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

function DateTimeInput({
  defaultValue,
  label,
  name,
}: Readonly<{
  defaultValue: string | null;
  label: string;
  name: string;
}>) {
  const [value, setValue] = useState(dateTimeLocalValue(defaultValue));

  return (
    <label>
      {label}
      <input
        name={`${name}Local`}
        onChange={(event) => setValue(event.target.value)}
        type="datetime-local"
        value={value}
      />
      <input name={name} type="hidden" value={isoFromDateTimeLocal(value)} />
    </label>
  );
}

function EventCard({
  active,
  event,
  onSelect,
  timeZone,
}: Readonly<{
  active: boolean;
  event: CalendarEventItem;
  onSelect: () => void;
  timeZone: string;
}>) {
  return (
    <button
      className={styles.eventCard}
      data-active={active}
      onClick={onSelect}
      type="button"
    >
      <strong>{event.title}</strong>
      <span>
        {formatTime(event.startsAt, timeZone)}
        {event.location ? ` - ${event.location}` : ""}
      </span>
      <span>{contactLabel(event)}</span>
    </button>
  );
}

function MonthView({
  activeEventId,
  anchor,
  events,
  onSelect,
  timeZone,
}: Readonly<{
  activeEventId: string | null;
  anchor: Date;
  events: CalendarEventItem[];
  onSelect: (eventId: string) => void;
  timeZone: string;
}>) {
  const firstOfMonth = startOfMonth(anchor);
  const firstDay = startOfWeek(firstOfMonth);
  const todayKey = formatDateParam(new Date());
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
        const dayEvents = eventsForDay(events, day);
        const isMuted = day.getMonth() !== anchor.getMonth();
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
            <div className={styles.dayNumber}>{day.getDate()}</div>
            <div className={styles.eventList}>
              {dayEvents.slice(0, 4).map((event) => (
                <EventCard
                  active={event.id === activeEventId}
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
  events,
  onSelect,
  timeZone,
}: Readonly<{
  activeEventId: string | null;
  anchor: Date;
  events: CalendarEventItem[];
  onSelect: (eventId: string) => void;
  timeZone: string;
}>) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  return (
    <div className={styles.weekGrid}>
      {days.map((day) => {
        const dayEvents = eventsForDay(events, day);

        return (
          <div className={styles.weekColumn} key={formatDateParam(day)}>
            <div className={styles.weekHeader}>
              <strong>{DAY_NAMES[(day.getDay() + 6) % 7]}</strong>
              <span>{day.getDate()}</span>
            </div>
            <div className={styles.weekBody}>
              {dayEvents.length > 0 ? (
                dayEvents.map((event) => (
                  <EventCard
                    active={event.id === activeEventId}
                    event={event}
                    key={event.id}
                    onSelect={() => onSelect(event.id)}
                    timeZone={timeZone}
                  />
                ))
              ) : (
                <span className={styles.eventMeta}>No events</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  activeEventId,
  anchor,
  events,
  onSelect,
  timeZone,
}: Readonly<{
  activeEventId: string | null;
  anchor: Date;
  events: CalendarEventItem[];
  onSelect: (eventId: string) => void;
  timeZone: string;
}>) {
  const dayEvents = eventsForDay(events, anchor);

  return (
    <div className={styles.dayBody}>
      {dayEvents.length > 0 ? (
        dayEvents.map((event) => (
          <div className={styles.dayEventRow} key={event.id}>
            <div className={styles.dayEventTime}>
              {formatTime(event.startsAt, timeZone)}
            </div>
            <EventCard
              active={event.id === activeEventId}
              event={event}
              onSelect={() => onSelect(event.id)}
              timeZone={timeZone}
            />
          </div>
        ))
      ) : (
        <p className={styles.emptyState}>No events on this day yet.</p>
      )}
    </div>
  );
}

function eventStartForNew(settings: CalendarSettings) {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  const end = new Date(
    date.getTime() + settings.defaultDurationMinutes * 60_000,
  );

  return {
    end: end.toISOString(),
    start: date.toISOString(),
  };
}

function EventEditor({
  currentHref,
  event,
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
  mode: "create" | "edit";
  onClose?: () => void;
  onNew: () => void;
  options: CalendarEntityOptions;
  settings: CalendarSettings;
  timeZone: string;
  variant?: "modal" | "side";
}>) {
  const newTimes = useMemo(() => eventStartForNew(settings), [settings]);
  const directionsUrl = event
    ? googleMapsDirectionsUrl(event.location, event.locationAddress)
    : null;
  const defaultContactId = event?.contactId ?? "";
  const defaultLeadId = event?.leadId ?? "";
  const defaultConversationId = event?.conversationId ?? "";
  const syncError = event ? calendarSyncError(event) : null;
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
        key={event?.id ?? "new"}
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
          />
          <DateTimeInput
            defaultValue={event?.endsAt ?? newTimes.end}
            label="End"
            name="endsAt"
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
              </span>{" "}
              {calendarSyncDestination(event)}
              {syncError ? ` - ${syncError}` : ""}
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
  events,
  initialSelectedEventId,
  options,
  settings,
  timeZone,
  view,
}: CalendarBoardProps) {
  const anchor = useMemo(
    () => startOfDay(new Date(`${anchorDate}T12:00:00`)),
    [anchorDate],
  );
  const [currentView, setCurrentView] = useState<CalendarView>(view);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialSelectedEventId,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const visibleRange = useMemo(
    () => rangeForView(anchor, currentView),
    [anchor, currentView],
  );
  const visibleEvents = useMemo(
    () => eventsInRange(events, visibleRange),
    [events, visibleRange],
  );
  const currentHref = viewHref(currentView, anchor);
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? null;
  const selectEvent = (eventId: string) => {
    setCreateOpen(false);
    setSelectedEventId(eventId);
  };
  const switchView = (nextView: CalendarView) => {
    setCurrentView(nextView);
    window.history.replaceState(null, "", viewHref(nextView, anchor));
  };
  const previousDate =
    currentView === "month"
      ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
      : addDays(anchor, currentView === "week" ? -7 : -1);
  const nextDate =
    currentView === "month"
      ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
      : addDays(anchor, currentView === "week" ? 7 : 1);
  const scheduledEvents = visibleEvents.filter((event) => event.startsAt);
  const unsyncedCount = visibleEvents.filter(
    (event) =>
      event.startsAt &&
      event.externalSyncStatus &&
      event.externalSyncStatus !== "synced",
  ).length;

  return (
    <div className={styles.calendarShell}>
      <div className={styles.calendarToolbar}>
        <div className={styles.calendarToolbarLeft}>
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
          <Link
            className="secondary-button compact"
            href={viewHref(currentView, new Date())}
          >
            Today
          </Link>
        </div>
        <div className={styles.calendarToolbarRight}>
          <Link
            className="secondary-button compact"
            href={viewHref(currentView, previousDate)}
          >
            Prev
          </Link>
          <Link
            className="secondary-button compact"
            href={viewHref(currentView, nextDate)}
          >
            Next
          </Link>
          <button
            className="primary-button compact"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            Add event
          </button>
        </div>
      </div>

      <div
        className={[
          styles.calendarGrid,
          selectedEvent ? null : styles.calendarGridFull,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <section className={styles.calendarPanel}>
          <div className={styles.calendarPanelHeader}>
            <div className={styles.calendarTitle}>
              <p className="eyebrow">Calendar</p>
              <h2>{rangeLabel(anchor, currentView, timeZone)}</h2>
              <p>
                {scheduledEvents.length} scheduled event
                {scheduledEvents.length === 1 ? "" : "s"}
                {unsyncedCount > 0 ? ` - ${unsyncedCount} needing sync` : ""}
              </p>
            </div>
            <span className={styles.syncPill} data-status="synced">
              {settings.syncProvider === "none"
                ? "Kyro only"
                : `${displayType(settings.syncProvider)} sync`}
            </span>
          </div>

          {currentView === "month" ? (
            <MonthView
              activeEventId={selectedEventId}
              anchor={anchor}
              events={visibleEvents}
              onSelect={selectEvent}
              timeZone={timeZone}
            />
          ) : null}
          {currentView === "week" ? (
            <WeekView
              activeEventId={selectedEventId}
              anchor={anchor}
              events={visibleEvents}
              onSelect={selectEvent}
              timeZone={timeZone}
            />
          ) : null}
          {currentView === "day" ? (
            <DayView
              activeEventId={selectedEventId}
              anchor={anchor}
              events={visibleEvents}
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
            onNew={() => setCreateOpen(true)}
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
              mode="create"
              onClose={() => setCreateOpen(false)}
              onNew={() => setCreateOpen(false)}
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
