import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import {
  getInboundEmailSettings,
  inboundQuietHoursActiveNow,
} from "../../../../../lib/integrations/inbound-email-settings";
import { syncExternalCalendarEventsToKyro } from "../../../../../lib/calendar/provider-sync";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function syncSecret() {
  return envSecrets("CALENDAR_SYNC_SECRET", "CRON_SECRET");
}

async function runScheduledCalendarSync(request: Request) {
  const expectedSecrets = syncSecret();

  if (expectedSecrets.length === 0) {
    return Response.json(
      { error: "CALENDAR_SYNC_SECRET or CRON_SECRET is not configured." },
      { status: 501 },
    );
  }

  if (!hasAnyValidRequestSecret(request, expectedSecrets)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id,owner_user_id")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return Response.json(
      { error: `Unable to load workspaces: ${error.message}` },
      { status: 500 },
    );
  }

  const results = [];

  for (const workspace of workspaces ?? []) {
    const workspaceId = String(workspace.id);
    const ownerUserId =
      typeof workspace.owner_user_id === "string"
        ? workspace.owner_user_id
        : null;

    try {
      const inboundSettings = await getInboundEmailSettings(
        supabase,
        workspaceId,
      );

      if (inboundQuietHoursActiveNow(inboundSettings, now)) {
        results.push({
          ok: true,
          result: { reason: "quiet_hours", skipped: true },
          workspaceId,
        });
        continue;
      }

      const result = await syncExternalCalendarEventsToKyro({
        supabase,
        trigger: "scheduled",
        userId: ownerUserId,
        workspaceId,
      });

      results.push({
        ok: true,
        result,
        workspaceId,
      });
    } catch (error) {
      results.push({
        error:
          error instanceof Error
            ? error.message
            : "Scheduled calendar sync failed.",
        ok: false,
        workspaceId,
      });
    }
  }

  return Response.json({
    results,
    workspaceCount: workspaces?.length ?? 0,
  });
}

export async function GET(request: Request) {
  return runScheduledCalendarSync(request);
}

export async function POST(request: Request) {
  return runScheduledCalendarSync(request);
}
