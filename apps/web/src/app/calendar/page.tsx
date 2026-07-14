import { AppFrame } from "../components/app-frame";
import { headers } from "next/headers";
import {
  getCalendarEntityOptions,
  getCalendarEventById,
  getCalendarEvents,
} from "../../lib/calendar/events";
import {
  CALENDAR_VIEWS,
  getCalendarSettings,
  type CalendarView,
} from "../../lib/calendar/settings";
import { getCalendarReadiness } from "../../lib/calendar/readiness";
import { calendarNavigationPreloadRange } from "../../lib/calendar/navigation-range";
import { syncExternalCalendarUpdatesToKyro } from "../../lib/calendar/provider-sync";
import {
  isoRangeForDateKeyRange,
  parseDateKeyOrToday,
} from "../../lib/timezone";
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

function normalizeView(value: string | undefined, fallback: CalendarView) {
  return CALENDAR_VIEWS.includes(value as CalendarView)
    ? (value as CalendarView)
    : fallback;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const [query, { supabase, workspace }, requestHeaders] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
    headers(),
  ]);
  const isPrefetchRequest =
    requestHeaders.get("next-router-prefetch") === "1" ||
    requestHeaders.get("purpose") === "prefetch" ||
    requestHeaders.get("sec-purpose")?.includes("prefetch");
  const [settings, generalSettings] = await Promise.all([
    getCalendarSettings(supabase, workspace.id),
    getWorkspaceGeneralSettings(supabase, workspace.id),
  ]);
  const view = normalizeView(query?.view, settings.defaultView);
  const anchorDateKey = parseDateKeyOrToday(
    query?.date,
    generalSettings.timeZone,
  );
  const preloadedDateRange = calendarNavigationPreloadRange(anchorDateKey);
  const calendarRange = isoRangeForDateKeyRange(
    preloadedDateRange,
    generalSettings.timeZone,
  );
  if (
    !isPrefetchRequest &&
    settings.importExternalUpdates &&
    settings.syncProvider !== "none"
  ) {
    await syncExternalCalendarUpdatesToKyro({
      supabase,
      workspaceId: workspace.id,
    });
  }
  const [events, selectedEvent, options, calendarReadiness] = await Promise.all([
    getCalendarEvents(supabase, workspace.id, {
      from: calendarRange.from,
      to: calendarRange.to,
    }),
    query?.event
      ? getCalendarEventById(supabase, workspace.id, query.event)
      : null,
    getCalendarEntityOptions(supabase, workspace.id),
    getCalendarReadiness(supabase, workspace.id),
  ]);
  const boardEvents =
    selectedEvent && !events.some((event) => event.id === selectedEvent.id)
      ? [...events, selectedEvent]
      : events;

  return (
    <AppFrame active="Calendar">
      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}

      <CalendarBoard
        anchorDate={anchorDateKey}
        calendarReadiness={calendarReadiness}
        events={boardEvents}
        initialSelectedEventId={query?.event ?? null}
        key={`${anchorDateKey}-${view}`}
        options={options}
        preloadedRange={preloadedDateRange}
        settings={settings}
        timeZone={generalSettings.timeZone}
        view={view}
      />
    </AppFrame>
  );
}
