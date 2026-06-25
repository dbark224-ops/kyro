import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_PROVIDER,
} from "../../../../../lib/integrations/google";
import {
  MICROSOFT_CALENDARS_READ_WRITE_SCOPE,
  MICROSOFT_PROVIDER,
} from "../../../../../lib/integrations/microsoft";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

function normalizeScopes(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (scope): scope is string =>
          typeof scope === "string" && scope.length > 0,
      )
    : [];
}

function hasMicrosoftScope(scopes: string[], requested: string) {
  const short = requested.replace("https://graph.microsoft.com/", "").toLowerCase();

  return scopes.some((scope) => {
    const normalized = scope.toLowerCase();

    return normalized === requested.toLowerCase() || normalized === short;
  });
}

export async function GET() {
  const { supabase, workspace } = await requireWorkspaceContext();
  const [{ count: unsyncedCount }, { data: connections, error }] =
    await Promise.all([
      supabase
        .from("conversation_appointments")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .in("external_sync_status", ["not_synced", "failed", "pending"]),
      supabase
        .from("integration_connections")
        .select("provider,account_email,status,scopes,last_connected_at")
        .eq("workspace_id", workspace.id)
        .in("provider", [GOOGLE_PROVIDER, MICROSOFT_PROVIDER])
        .eq("status", "connected"),
    ]);

  if (error) {
    return Response.json(
      { error: `Unable to load calendar readiness: ${error.message}` },
      { status: 500 },
    );
  }

  const providers = (connections ?? []).map((connection) => {
    const scopes = normalizeScopes(connection.scopes);
    const calendarReady =
      connection.provider === GOOGLE_PROVIDER
        ? scopes.includes(GOOGLE_CALENDAR_EVENTS_SCOPE)
        : hasMicrosoftScope(scopes, MICROSOFT_CALENDARS_READ_WRITE_SCOPE);

    return {
      accountEmail: connection.account_email,
      calendarReady,
      lastConnectedAt: connection.last_connected_at,
      provider: connection.provider,
      requiredScope:
        connection.provider === GOOGLE_PROVIDER
          ? GOOGLE_CALENDAR_EVENTS_SCOPE
          : MICROSOFT_CALENDARS_READ_WRITE_SCOPE,
    };
  });

  return Response.json({
    ok: true,
    providers,
    ready: providers.some((provider) => provider.calendarReady),
    unsyncedAppointments: unsyncedCount ?? 0,
  });
}
