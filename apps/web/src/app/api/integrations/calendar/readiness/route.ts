import { getCalendarReadiness } from "../../../../../lib/calendar/readiness";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, workspace } = await requireWorkspaceContext();
  const readiness = await getCalendarReadiness(supabase, workspace.id);

  if (readiness.error) {
    return Response.json(
      { error: readiness.error },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    ...readiness,
  });
}
