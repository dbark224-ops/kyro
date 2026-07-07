import { getCalendarEvents } from "../../../../lib/calendar/events";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

function defaultRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 14);

  const to = new Date(from);
  to.setDate(to.getDate() + 90);

  return { from: from.toISOString(), to: to.toISOString() };
}

function safeIsoDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: Request) {
  try {
    const { supabase, workspace } = await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const fallback = defaultRange();
    const from = safeIsoDate(url.searchParams.get("from")) ?? fallback.from;
    const to = safeIsoDate(url.searchParams.get("to")) ?? fallback.to;
    const events = await getCalendarEvents(supabase, workspace.id, { from, to });

    return Response.json({
      events,
      range: { from, to },
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
