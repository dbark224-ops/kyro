import { runBackgroundJobCycle } from "../../../../../lib/background/jobs";
import { syncExternalCalendarEventsToKyro } from "../../../../../lib/calendar/provider-sync";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runScheduledCalendarSync(request: Request) {
  const secrets = envSecrets("CALENDAR_SYNC_SECRET", "CRON_SECRET");

  if (secrets.length === 0 || !hasAnyValidRequestSecret(request, secrets)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const supabase = createServiceSupabaseClient();

  if (workspaceId) {
    const { data: workspace, error } = await supabase
      .from("workspaces")
      .select("id,owner_user_id")
      .eq("id", workspaceId)
      .maybeSingle();

    if (error || !workspace) {
      return Response.json(
        { error: error?.message ?? "Workspace was not found." },
        { status: error ? 500 : 404 },
      );
    }

    const result = await syncExternalCalendarEventsToKyro({
      supabase,
      trigger: "scheduled",
      userId:
        typeof workspace.owner_user_id === "string"
          ? workspace.owner_user_id
          : null,
      workspaceId,
    });

    return Response.json({ ok: true, result, workspaceId });
  }

  const result = await runBackgroundJobCycle(supabase, {
    claimLimit: 40,
    jobTypes: ["calendar_sync"],
  });

  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return runScheduledCalendarSync(request);
}

export async function POST(request: Request) {
  return runScheduledCalendarSync(request);
}
