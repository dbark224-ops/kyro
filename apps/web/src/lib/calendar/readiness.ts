import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_PROVIDER,
  GOOGLE_SERVICE,
  hasGoogleScope,
} from "../integrations/google";
import {
  MICROSOFT_CALENDARS_READ_WRITE_SCOPE,
  MICROSOFT_PROVIDER,
  MICROSOFT_SERVICE,
} from "../integrations/microsoft";

export type CalendarReadinessProvider = {
  accountEmail: string | null;
  calendarReady: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  provider: "google" | "microsoft";
  requiredScope: string;
};

export type CalendarReadiness = {
  error: string | null;
  providers: CalendarReadinessProvider[];
  ready: boolean;
  unsyncedAppointments: number;
};

type IntegrationConnectionRow = {
  account_email: string | null;
  last_connected_at: string | null;
  last_error: string | null;
  provider: string | null;
  scopes: unknown;
  service: string | null;
  status: string | null;
};

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

function normalizeCalendarProvider(provider: string | null) {
  return provider === GOOGLE_PROVIDER
    ? "google"
    : provider === MICROSOFT_PROVIDER
      ? "microsoft"
      : null;
}

function providerService(provider: "google" | "microsoft") {
  return provider === "google" ? GOOGLE_SERVICE : MICROSOFT_SERVICE;
}

function providerRequiredScope(provider: "google" | "microsoft") {
  return provider === "google"
    ? GOOGLE_CALENDAR_EVENTS_SCOPE
    : MICROSOFT_CALENDARS_READ_WRITE_SCOPE;
}

function providerHasCalendarScope(
  provider: "google" | "microsoft",
  scopes: string[],
) {
  return provider === "google"
    ? hasGoogleScope(scopes, GOOGLE_CALENDAR_EVENTS_SCOPE)
    : hasMicrosoftScope(scopes, MICROSOFT_CALENDARS_READ_WRITE_SCOPE);
}

export async function getCalendarReadiness(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<CalendarReadiness> {
  const [{ count: unsyncedCount }, { data: connections, error }] =
    await Promise.all([
      supabase
        .from("conversation_appointments")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .in("external_sync_status", ["not_synced", "failed", "pending"]),
      supabase
        .from("integration_connections")
        .select(
          "provider,service,account_email,status,scopes,last_connected_at,last_error",
        )
        .eq("workspace_id", workspaceId)
        .in("provider", [GOOGLE_PROVIDER, MICROSOFT_PROVIDER])
        .order("last_connected_at", { ascending: false }),
    ]);

  if (error) {
    return {
      error: `Unable to load calendar readiness: ${error.message}`,
      providers: [],
      ready: false,
      unsyncedAppointments: unsyncedCount ?? 0,
    };
  }

  const providers = ((connections ?? []) as IntegrationConnectionRow[])
    .map((connection) => {
      const provider = normalizeCalendarProvider(connection.provider);

      if (!provider || connection.service !== providerService(provider)) {
        return null;
      }

      const scopes = normalizeScopes(connection.scopes);
      const connected = connection.status === "connected";
      const calendarReady =
        connected && providerHasCalendarScope(provider, scopes);

      return {
        accountEmail: connection.account_email,
        calendarReady,
        connected,
        lastConnectedAt: connection.last_connected_at,
        lastError: connection.last_error,
        provider,
        requiredScope: providerRequiredScope(provider),
      } satisfies CalendarReadinessProvider;
    })
    .filter((provider): provider is CalendarReadinessProvider =>
      Boolean(provider),
    );

  return {
    error: null,
    providers,
    ready: providers.some((provider) => provider.calendarReady),
    unsyncedAppointments: unsyncedCount ?? 0,
  };
}
