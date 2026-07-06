import { AppFrame } from "../components/app-frame";
import {
  getCalendarEntityOptions,
  getCalendarEvents,
} from "../../lib/calendar/events";
import {
  CALENDAR_VIEWS,
  getCalendarSettings,
  type CalendarView,
} from "../../lib/calendar/settings";
import { syncExternalCalendarUpdatesToKyro } from "../../lib/calendar/provider-sync";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import { CalendarBoard } from "./calendar-board";

export const dynamic = "force-dynamic";

type CalendarPageProps = {
  searchParams?: Promise<{
    date?: string;
    engine_error?: string;
    engine_message?: string;
    event?: string;
    view?: string;
  }>;
};

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

function parseAnchorDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return startOfDay(new Date());
  }

  const date = new Date(`${value}T12:00:00`);

  return Number.isNaN(date.getTime()) ? startOfDay(new Date()) : startOfDay(date);
}

function normalizeView(value: string | undefined, fallback: CalendarView) {
  return CALENDAR_VIEWS.includes(value as CalendarView)
    ? (value as CalendarView)
    : fallback;
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

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const [settings, generalSettings] = await Promise.all([
    getCalendarSettings(supabase, workspace.id),
    getWorkspaceGeneralSettings(supabase, workspace.id),
  ]);
  const view = normalizeView(query?.view, settings.defaultView);
  const anchor = parseAnchorDate(query?.date);
  const range = rangeForView(anchor, "month");
  if (settings.importExternalUpdates && settings.syncProvider !== "none") {
    await syncExternalCalendarUpdatesToKyro({
      supabase,
      workspaceId: workspace.id,
    });
  }
  const [events, options] = await Promise.all([
    getCalendarEvents(supabase, workspace.id, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    }),
    getCalendarEntityOptions(supabase, workspace.id),
  ]);

  return (
    <AppFrame active="Calendar">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Calendar</h1>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}

      <CalendarBoard
        anchorDate={formatDateParam(anchor)}
        events={events}
        initialSelectedEventId={query?.event ?? null}
        key={`${formatDateParam(anchor)}-${view}`}
        options={options}
        settings={settings}
        timeZone={generalSettings.timeZone}
        view={view}
      />
    </AppFrame>
  );
}
