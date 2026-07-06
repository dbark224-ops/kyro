import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_PROVIDER,
  GOOGLE_SERVICE,
  getGoogleOAuthConfig,
  hasGoogleScope,
} from "../integrations/google";
import {
  MICROSOFT_CALENDARS_READ_WRITE_SCOPE,
  MICROSOFT_PROVIDER,
  MICROSOFT_SERVICE,
  getMicrosoftOAuthConfig,
} from "../integrations/microsoft";
import {
  decryptIntegrationTokenSet,
  encryptIntegrationTokenSet,
} from "../integrations/token-vault";
import {
  type CalendarSettings,
  getCalendarSettings,
} from "./settings";

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000;
const EXTERNAL_EVENT_REFRESH_INTERVAL_MS = 5 * 60_000;

type TokenSet = {
  accessToken?: string;
  expiresIn?: number | null;
  idToken?: string | null;
  obtainedAt?: string | null;
  refreshToken?: string | null;
  scopes?: string[];
  tokenType?: string | null;
};

type IntegrationConnectionRow = {
  account_email: string | null;
  id: string;
  provider: string;
  scopes: unknown;
  token_set: unknown;
};

type AppointmentSyncRow = {
  appointment_type: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  description: string | null;
  ends_at: string | null;
  external_calendar_id: string | null;
  external_calendar_provider: string | null;
  external_event_id: string | null;
  id: string;
  lead_id: string | null;
  location: string | null;
  metadata: unknown;
  starts_at: string | null;
  status: string | null;
  title: string | null;
};

type ExternalRefreshRow = AppointmentSyncRow & {
  external_event_etag: string | null;
  external_synced_at: string | null;
};

type ExternalCalendarProvider = "google" | "microsoft";

type ExternalSyncResult = {
  error: string | null;
  eventId: string | null;
  provider: ExternalCalendarProvider | null;
  status: "not_synced" | "synced" | "failed";
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeScopes(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (scope): scope is string => typeof scope === "string" && scope.length > 0,
      )
    : [];
}

function tokenExpiresAt(tokenSet: TokenSet) {
  const obtainedAt = textValue(tokenSet.obtainedAt);
  const expiresIn =
    typeof tokenSet.expiresIn === "number" ? tokenSet.expiresIn : null;

  if (!obtainedAt || !expiresIn) {
    return null;
  }

  return new Date(
    new Date(obtainedAt).getTime() + expiresIn * 1000,
  ).toISOString();
}

function tokenIsExpiring(tokenSet: TokenSet) {
  const expiresAt = tokenExpiresAt(tokenSet);

  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() - Date.now() < ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

async function readApiError(response: Response) {
  const rawText = await response.text();

  try {
    const parsed = JSON.parse(rawText) as {
      error?: { errors?: Array<{ message?: string }>; message?: string };
    };
    const message =
      parsed.error?.message ??
      parsed.error?.errors?.find((item) => item.message)?.message;

    if (message) {
      return message;
    }
  } catch {
    // Use the raw provider text below.
  }

  return rawText.slice(0, 500) || response.statusText;
}

async function markAppointmentExternalSync(
  supabase: SupabaseClient,
  workspaceId: string,
  appointmentId: string,
  result: ExternalSyncResult,
  externalCalendarId: string | null,
) {
  const { error } = await supabase
    .from("conversation_appointments")
    .update({
      external_calendar_id: externalCalendarId,
      external_calendar_provider: result.provider,
      external_event_id: result.eventId,
      external_sync_error: result.error,
      external_sync_status: result.status,
      external_synced_at:
        result.status === "synced" ? new Date().toISOString() : null,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", appointmentId);

  if (error) {
    console.warn("Unable to mark calendar sync status", error.message);
  }
}

async function updateConnectionLastError({
  connectionId,
  message,
  supabase,
  workspaceId,
}: {
  connectionId: string;
  message: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { error } = await supabase
    .from("integration_connections")
    .update({ last_error: message })
    .eq("workspace_id", workspaceId)
    .eq("id", connectionId);

  if (error) {
    console.warn("Unable to update calendar integration status", error.message);
  }
}

async function refreshGoogleAccessToken({
  connection,
  supabase,
  tokenSet,
  workspaceId,
}: {
  connection: IntegrationConnectionRow;
  supabase: SupabaseClient;
  tokenSet: TokenSet;
  workspaceId: string;
}) {
  const config = getGoogleOAuthConfig();
  const refreshToken = textValue(tokenSet.refreshToken);

  if (!config || !refreshToken) {
    throw new Error("Google calendar access expired. Reconnect Google in Settings.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    const message = await readApiError(response);
    await updateConnectionLastError({
      connectionId: connection.id,
      message: `Google calendar token refresh failed: ${message}`,
      supabase,
      workspaceId,
    });
    throw new Error("Google calendar access expired. Reconnect Google in Settings.");
  }

  const refreshed = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
    token_type?: string;
  };
  const updatedTokenSet: TokenSet = {
    ...tokenSet,
    accessToken: refreshed.access_token ?? tokenSet.accessToken,
    expiresIn: refreshed.expires_in ?? tokenSet.expiresIn ?? null,
    idToken: refreshed.id_token ?? tokenSet.idToken ?? null,
    obtainedAt: new Date().toISOString(),
    refreshToken,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : tokenSet.scopes,
    tokenType: refreshed.token_type ?? tokenSet.tokenType ?? null,
  };

  const { error } = await supabase
    .from("integration_connections")
    .update({
      access_token_expires_at: tokenExpiresAt(updatedTokenSet),
      last_error: null,
      token_set: encryptIntegrationTokenSet(
        updatedTokenSet as Record<string, unknown>,
      ),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", connection.id);

  if (error) {
    throw new Error(`Unable to save Google calendar token: ${error.message}`);
  }

  return updatedTokenSet;
}

async function refreshMicrosoftAccessToken({
  connection,
  supabase,
  tokenSet,
  workspaceId,
}: {
  connection: IntegrationConnectionRow;
  supabase: SupabaseClient;
  tokenSet: TokenSet;
  workspaceId: string;
}) {
  const config = getMicrosoftOAuthConfig();
  const refreshToken = textValue(tokenSet.refreshToken);

  if (!config || !refreshToken) {
    throw new Error("Microsoft calendar access expired. Reconnect Outlook in Settings.");
  }

  const response = await fetch(config.tokenEndpoint, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const refreshed = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
    id_token?: string;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  };

  if (!response.ok || refreshed.error || !refreshed.access_token) {
    const message =
      refreshed.error_description ??
      refreshed.error ??
      "Microsoft calendar token refresh failed.";
    await updateConnectionLastError({
      connectionId: connection.id,
      message: `Microsoft calendar token refresh failed: ${message}`,
      supabase,
      workspaceId,
    });
    throw new Error("Microsoft calendar access expired. Reconnect Outlook in Settings.");
  }

  const updatedTokenSet: TokenSet = {
    ...tokenSet,
    accessToken: refreshed.access_token,
    expiresIn: refreshed.expires_in ?? tokenSet.expiresIn ?? null,
    idToken: refreshed.id_token ?? tokenSet.idToken ?? null,
    obtainedAt: new Date().toISOString(),
    refreshToken: refreshed.refresh_token ?? refreshToken,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : tokenSet.scopes,
    tokenType: refreshed.token_type ?? tokenSet.tokenType ?? null,
  };

  const { error } = await supabase
    .from("integration_connections")
    .update({
      access_token_expires_at: tokenExpiresAt(updatedTokenSet),
      last_error: null,
      token_set: encryptIntegrationTokenSet(
        updatedTokenSet as Record<string, unknown>,
      ),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", connection.id);

  if (error) {
    throw new Error(`Unable to save Microsoft calendar token: ${error.message}`);
  }

  return updatedTokenSet;
}

async function loadCalendarConnection({
  provider,
  supabase,
  workspaceId,
}: {
  provider: ExternalCalendarProvider;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("integration_connections")
    .select("id,provider,account_email,scopes,token_set")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider === "google" ? GOOGLE_PROVIDER : MICROSOFT_PROVIDER)
    .eq("service", provider === "google" ? GOOGLE_SERVICE : MICROSOFT_SERVICE)
    .eq("status", "connected")
    .order("last_connected_at", { ascending: false })
    .limit(3);

  if (error) {
    throw new Error(`Unable to load ${provider} calendar connection: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => row as IntegrationConnectionRow)
    .find((row) => {
      const scopes = normalizeScopes(row.scopes);

      return provider === "google"
        ? hasGoogleScope(scopes, GOOGLE_CALENDAR_EVENTS_SCOPE)
        : scopes.some((scope) =>
            [
              "calendars.readwrite",
              MICROSOFT_CALENDARS_READ_WRITE_SCOPE.toLowerCase(),
            ].includes(scope.toLowerCase()),
          );
    });
}

async function chooseCalendarConnection({
  settings,
  supabase,
  workspaceId,
}: {
  settings: CalendarSettings;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  if (settings.syncProvider === "none") {
    return null;
  }

  if (settings.syncProvider === "google") {
    const connection = await loadCalendarConnection({
      provider: "google",
      supabase,
      workspaceId,
    });

    return connection ? { connection, provider: "google" as const } : null;
  }

  if (settings.syncProvider === "microsoft") {
    const connection = await loadCalendarConnection({
      provider: "microsoft",
      supabase,
      workspaceId,
    });

    return connection ? { connection, provider: "microsoft" as const } : null;
  }

  const google = await loadCalendarConnection({
    provider: "google",
    supabase,
    workspaceId,
  });

  if (google) {
    return { connection: google, provider: "google" as const };
  }

  const microsoft = await loadCalendarConnection({
    provider: "microsoft",
    supabase,
    workspaceId,
  });

  return microsoft ? { connection: microsoft, provider: "microsoft" as const } : null;
}

async function accessTokenForConnection({
  connection,
  provider,
  supabase,
  workspaceId,
}: {
  connection: IntegrationConnectionRow;
  provider: ExternalCalendarProvider;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  let tokenSet = decryptIntegrationTokenSet<TokenSet>(
    connection.token_set as Parameters<typeof decryptIntegrationTokenSet>[0],
  );

  if (tokenIsExpiring(tokenSet)) {
    tokenSet =
      provider === "google"
        ? await refreshGoogleAccessToken({
            connection,
            supabase,
            tokenSet,
            workspaceId,
          })
        : await refreshMicrosoftAccessToken({
            connection,
            supabase,
            tokenSet,
            workspaceId,
          });
  }

  const accessToken = textValue(tokenSet.accessToken);

  if (!accessToken) {
    throw new Error(`${provider} calendar connection has no usable access token.`);
  }

  return accessToken;
}

function fallbackEndAt(appointment: AppointmentSyncRow, settings: CalendarSettings) {
  if (appointment.ends_at) {
    return appointment.ends_at;
  }

  if (appointment.starts_at) {
    return new Date(
      new Date(appointment.starts_at).getTime() +
        settings.defaultDurationMinutes * 60_000,
    ).toISOString();
  }

  return null;
}

function kyroDescription(appointment: AppointmentSyncRow) {
  const description = textValue(appointment.description);
  const meta = objectRecord(appointment.metadata);
  const source = textValue(meta.source);
  const lines = [
    description,
    "",
    "Created by Kyro.",
    appointment.conversation_id
      ? `Kyro inquiry: ${appointment.conversation_id}`
      : null,
    source ? `Source: ${source}` : null,
  ].filter((line): line is string => line !== null);

  return lines.join("\n").trim();
}

function googleCalendarUrl(settings: CalendarSettings, suffix = "") {
  const calendarId = encodeURIComponent(settings.externalCalendarId || "primary");

  return `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events${suffix}`;
}

async function upsertGoogleEvent({
  accessToken,
  appointment,
  existingEventId,
  settings,
  workspaceId,
}: {
  accessToken: string;
  appointment: AppointmentSyncRow;
  existingEventId: string | null;
  settings: CalendarSettings;
  workspaceId: string;
}) {
  const startsAt = appointment.starts_at;
  const endsAt = fallbackEndAt(appointment, settings);

  if (!startsAt || !endsAt) {
    throw new Error("Calendar event needs a start and end time before syncing.");
  }

  const response = await fetch(
    existingEventId
      ? googleCalendarUrl(settings, `/${encodeURIComponent(existingEventId)}`)
      : googleCalendarUrl(settings),
    {
      body: JSON.stringify({
        description: kyroDescription(appointment),
        extendedProperties: {
          private: {
            kyroAppointmentId: appointment.id,
            kyroConversationId: appointment.conversation_id ?? "",
            kyroContactId: appointment.contact_id ?? "",
            kyroLeadId: appointment.lead_id ?? "",
            kyroWorkspaceId: workspaceId,
          },
        },
        location: textValue(appointment.location) ?? undefined,
        start: { dateTime: startsAt },
        end: { dateTime: endsAt },
        summary: textValue(appointment.title) ?? "Kyro appointment",
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: existingEventId ? "PATCH" : "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as { etag?: string; id?: string };
}

async function readGoogleEvent({
  accessToken,
  eventId,
  settings,
}: {
  accessToken: string;
  eventId: string;
  settings: CalendarSettings;
}) {
  const response = await fetch(
    googleCalendarUrl(settings, `/${encodeURIComponent(eventId)}`),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: "GET",
    },
  );

  if (response.status === 404 || response.status === 410) {
    return { deleted: true as const };
  }

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const event = (await response.json()) as {
    description?: string | null;
    end?: { date?: string; dateTime?: string };
    etag?: string | null;
    location?: string | null;
    start?: { date?: string; dateTime?: string };
    status?: string | null;
    summary?: string | null;
  };

  return {
    deleted: false as const,
    endsAt: textValue(event.end?.dateTime) ?? textValue(event.end?.date),
    etag: textValue(event.etag),
    location: textValue(event.location),
    startsAt: textValue(event.start?.dateTime) ?? textValue(event.start?.date),
    status:
      event.status === "cancelled"
        ? "cancelled"
        : textValue(event.start?.dateTime) || textValue(event.start?.date)
          ? "scheduled"
          : "suggested",
    title: textValue(event.summary),
  };
}

function microsoftDateTime(value: string) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "");
}

function microsoftCalendarUrl(settings: CalendarSettings, eventId?: string | null) {
  if (eventId) {
    return `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
  }

  const calendarId = settings.externalCalendarId;

  return calendarId && calendarId !== "primary"
    ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
        calendarId,
      )}/events`
    : "https://graph.microsoft.com/v1.0/me/events";
}

function microsoftEventUrl(eventId: string) {
  return `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
}

async function upsertMicrosoftEvent({
  accessToken,
  appointment,
  existingEventId,
  settings,
}: {
  accessToken: string;
  appointment: AppointmentSyncRow;
  existingEventId: string | null;
  settings: CalendarSettings;
}) {
  const startsAt = appointment.starts_at;
  const endsAt = fallbackEndAt(appointment, settings);

  if (!startsAt || !endsAt) {
    throw new Error("Calendar event needs a start and end time before syncing.");
  }

  const requestId = randomUUID();
  const response = await fetch(microsoftCalendarUrl(settings, existingEventId), {
    body: JSON.stringify({
      body: {
        content: kyroDescription(appointment),
        contentType: "Text",
      },
      end: { dateTime: microsoftDateTime(endsAt), timeZone: "UTC" },
      location: textValue(appointment.location)
        ? { displayName: textValue(appointment.location) }
        : undefined,
      subject: textValue(appointment.title) ?? "Kyro appointment",
      start: { dateTime: microsoftDateTime(startsAt), timeZone: "UTC" },
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "client-request-id": requestId,
      "Content-Type": "application/json",
      "return-client-request-id": "true",
    },
    method: existingEventId ? "PATCH" : "POST",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as { id?: string };
}

async function readMicrosoftEvent({
  accessToken,
  eventId,
}: {
  accessToken: string;
  eventId: string;
}) {
  const response = await fetch(microsoftEventUrl(eventId), {
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "GET",
  });

  if (response.status === 404 || response.status === 410) {
    return { deleted: true as const };
  }

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const event = (await response.json()) as {
    end?: { dateTime?: string | null; timeZone?: string | null };
    id?: string | null;
    isCancelled?: boolean | null;
    location?: { displayName?: string | null } | null;
    start?: { dateTime?: string | null; timeZone?: string | null };
    subject?: string | null;
  };
  const startsAt = textValue(event.start?.dateTime);
  const endsAt = textValue(event.end?.dateTime);

  return {
    deleted: false as const,
    endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    etag: textValue(event.id),
    location: textValue(event.location?.displayName),
    startsAt: startsAt ? new Date(startsAt).toISOString() : null,
    status: event.isCancelled ? "cancelled" : startsAt ? "scheduled" : "suggested",
    title: textValue(event.subject),
  };
}

function providerDateTimeToIso(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function externalRefreshDue(row: ExternalRefreshRow) {
  if (!row.external_synced_at) {
    return true;
  }

  return (
    Date.now() - new Date(row.external_synced_at).getTime() >
    EXTERNAL_EVENT_REFRESH_INTERVAL_MS
  );
}

async function loadExternalRefreshAppointments(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const from = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const to = new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select(
      "id,conversation_id,contact_id,lead_id,appointment_type,title,description,status,starts_at,ends_at,location,metadata,external_calendar_provider,external_calendar_id,external_event_id,external_event_etag,external_synced_at",
    )
    .eq("workspace_id", workspaceId)
    .not("external_event_id", "is", null)
    .not("external_calendar_provider", "is", null)
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) {
    throw new Error(`Unable to load external calendar events: ${error.message}`);
  }

  return ((data ?? []) as ExternalRefreshRow[]).filter(externalRefreshDue);
}

async function applyExternalEventRefresh({
  appointment,
  external,
  supabase,
  workspaceId,
}: {
  appointment: ExternalRefreshRow;
  external:
    | Awaited<ReturnType<typeof readGoogleEvent>>
    | Awaited<ReturnType<typeof readMicrosoftEvent>>;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  if (external.deleted) {
    const { error } = await supabase
      .from("conversation_appointments")
      .update({
        external_sync_error: "External calendar event was deleted.",
        external_sync_status: "not_synced",
        external_synced_at: new Date().toISOString(),
        status: "cancelled",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", appointment.id);

    if (error) {
      throw new Error(`Unable to mark deleted external event: ${error.message}`);
    }

    return;
  }

  const startsAt = providerDateTimeToIso(external.startsAt);
  const endsAt = providerDateTimeToIso(external.endsAt);
  const { error } = await supabase
    .from("conversation_appointments")
    .update({
      ends_at: endsAt ?? appointment.ends_at,
      external_event_etag: external.etag ?? appointment.external_event_etag,
      external_sync_error: null,
      external_sync_status: "synced",
      external_synced_at: new Date().toISOString(),
      location: external.location ?? appointment.location,
      starts_at: startsAt ?? appointment.starts_at,
      status: external.status,
      title: external.title ?? appointment.title,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", appointment.id);

  if (error) {
    throw new Error(`Unable to apply external calendar update: ${error.message}`);
  }
}

async function loadAppointment(
  supabase: SupabaseClient,
  workspaceId: string,
  appointmentId: string,
) {
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select(
      "id,conversation_id,contact_id,lead_id,appointment_type,title,description,status,starts_at,ends_at,location,metadata,external_calendar_provider,external_calendar_id,external_event_id",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load calendar event: ${error.message}`);
  }

  return data ? (data as AppointmentSyncRow) : null;
}

export async function syncAppointmentToExternalCalendar({
  action,
  appointmentId,
  supabase,
  workspaceId,
}: {
  action: "create" | "update";
  appointmentId: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const [settings, appointment] = await Promise.all([
    getCalendarSettings(supabase, workspaceId),
    loadAppointment(supabase, workspaceId, appointmentId),
  ]);

  if (!appointment) {
    return { ok: false, skipped: true, status: "missing" };
  }

  const syncEnabled =
    action === "create"
      ? settings.syncCreatedEventsToExternal
      : settings.syncUpdatedEventsToExternal;

  if (!syncEnabled || settings.syncProvider === "none") {
    await markAppointmentExternalSync(
      supabase,
      workspaceId,
      appointment.id,
      {
        error: null,
        eventId: appointment.external_event_id,
        provider: appointment.external_calendar_provider as ExternalCalendarProvider | null,
        status: "not_synced",
      },
      appointment.external_calendar_id ?? settings.externalCalendarId,
    );
    return { ok: true, skipped: true, status: "disabled" };
  }

  if (!appointment.starts_at) {
    await markAppointmentExternalSync(
      supabase,
      workspaceId,
      appointment.id,
      {
        error: "Event has no scheduled start time.",
        eventId: appointment.external_event_id,
        provider: appointment.external_calendar_provider as ExternalCalendarProvider | null,
        status: "not_synced",
      },
      appointment.external_calendar_id ?? settings.externalCalendarId,
    );
    return { ok: true, skipped: true, status: "unscheduled" };
  }

  try {
    const selected = await chooseCalendarConnection({
      settings,
      supabase,
      workspaceId,
    });

    if (!selected) {
      await markAppointmentExternalSync(
        supabase,
        workspaceId,
        appointment.id,
        {
          error: "No connected Google or Outlook calendar with write permission.",
          eventId: appointment.external_event_id,
          provider: null,
          status: "not_synced",
        },
        settings.externalCalendarId,
      );
      return { ok: true, skipped: true, status: "provider_missing" };
    }

    const accessToken = await accessTokenForConnection({
      connection: selected.connection,
      provider: selected.provider,
      supabase,
      workspaceId,
    });
    const existingEventId =
      appointment.external_calendar_provider === selected.provider
        ? appointment.external_event_id
        : null;
    const event =
      selected.provider === "google"
        ? await upsertGoogleEvent({
            accessToken,
            appointment,
            existingEventId,
            settings,
            workspaceId,
          })
        : await upsertMicrosoftEvent({
            accessToken,
            appointment,
            existingEventId,
            settings,
          });
    const eventId = textValue(event.id) ?? existingEventId;

    await markAppointmentExternalSync(
      supabase,
      workspaceId,
      appointment.id,
      {
        error: null,
        eventId,
        provider: selected.provider,
        status: "synced",
      },
      settings.externalCalendarId,
    );
    await updateConnectionLastError({
      connectionId: selected.connection.id,
      message: null,
      supabase,
      workspaceId,
    });

    return { ok: true, skipped: false, status: "synced" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Calendar provider sync failed.";
    await markAppointmentExternalSync(
      supabase,
      workspaceId,
      appointment.id,
      {
        error: message,
        eventId: appointment.external_event_id,
        provider: appointment.external_calendar_provider as ExternalCalendarProvider | null,
        status: "failed",
      },
      appointment.external_calendar_id ?? settings.externalCalendarId,
    );

    return { ok: false, skipped: false, status: "failed", error: message };
  }
}

export async function syncExternalCalendarUpdatesToKyro({
  supabase,
  workspaceId,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const settings = await getCalendarSettings(supabase, workspaceId);

  if (!settings.importExternalUpdates || settings.syncProvider === "none") {
    return { refreshed: 0, skipped: true };
  }

  const appointments = await loadExternalRefreshAppointments(
    supabase,
    workspaceId,
  );
  let refreshed = 0;
  const connections = new Map<
    ExternalCalendarProvider,
    { accessToken: string; connectionId: string }
  >();

  for (const appointment of appointments) {
    const provider =
      appointment.external_calendar_provider === "google" ||
      appointment.external_calendar_provider === "microsoft"
        ? appointment.external_calendar_provider
        : null;
    const eventId = textValue(appointment.external_event_id);

    if (!provider || !eventId) {
      continue;
    }

    try {
      let connection = connections.get(provider);

      if (!connection) {
        const calendarConnection = await loadCalendarConnection({
          provider,
          supabase,
          workspaceId,
        });

        if (!calendarConnection) {
          continue;
        }

        connection = {
          accessToken: await accessTokenForConnection({
            connection: calendarConnection,
            provider,
            supabase,
            workspaceId,
          }),
          connectionId: calendarConnection.id,
        };
        connections.set(provider, connection);
      }

      const external =
        provider === "google"
          ? await readGoogleEvent({
              accessToken: connection.accessToken,
              eventId,
              settings: {
                ...settings,
                externalCalendarId:
                  appointment.external_calendar_id ??
                  settings.externalCalendarId,
              },
            })
          : await readMicrosoftEvent({
              accessToken: connection.accessToken,
              eventId,
            });

      await applyExternalEventRefresh({
        appointment,
        external,
        supabase,
        workspaceId,
      });
      refreshed += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "External calendar refresh failed.";
      await markAppointmentExternalSync(
        supabase,
        workspaceId,
        appointment.id,
        {
          error: message,
          eventId,
          provider,
          status: "failed",
        },
        appointment.external_calendar_id ?? settings.externalCalendarId,
      );
    }
  }

  return { refreshed, skipped: false };
}

export async function deleteAppointmentFromExternalCalendar({
  appointmentId,
  supabase,
  workspaceId,
}: {
  appointmentId: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const [settings, appointment] = await Promise.all([
    getCalendarSettings(supabase, workspaceId),
    loadAppointment(supabase, workspaceId, appointmentId),
  ]);

  if (
    !appointment ||
    !settings.syncDeletedEventsToExternal ||
    !appointment.external_event_id ||
    !appointment.external_calendar_provider
  ) {
    return { ok: true, skipped: true };
  }

  try {
    const provider = appointment.external_calendar_provider as ExternalCalendarProvider;
    const connection = await loadCalendarConnection({
      provider,
      supabase,
      workspaceId,
    });

    if (!connection) {
      return { ok: false, skipped: true, status: "provider_missing" };
    }

    const accessToken = await accessTokenForConnection({
      connection,
      provider,
      supabase,
      workspaceId,
    });
    const response = await fetch(
      provider === "google"
        ? googleCalendarUrl(
            settings,
            `/${encodeURIComponent(appointment.external_event_id)}`,
          )
        : microsoftCalendarUrl(settings, appointment.external_event_id),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        method: "DELETE",
      },
    );

    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new Error(await readApiError(response));
    }

    return { ok: true, skipped: false };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Calendar delete failed.",
      ok: false,
      skipped: false,
    };
  }
}
