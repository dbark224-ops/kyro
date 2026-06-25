import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasIntegrationTokenEncryptionKey } from "./token-vault";

export const GOOGLE_PROVIDER = "google";
export const GOOGLE_SERVICE = "google_workspace";
export const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_WORKSPACE_SCOPES = [
  "openid",
  "email",
  "profile",
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_GMAIL_READ_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_CALENDAR_EVENTS_SCOPE
] as const;

export type GoogleIntegrationConnection = {
  id: string;
  accountEmail: string | null;
  accountName: string | null;
  status: string;
  scopes: string[];
  lastConnectedAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
};

export type GoogleIntegrationOverview = {
  configured: boolean;
  encryptionReady: boolean;
  migrationReady: boolean;
  redirectUri: string | null;
  scopes: string[];
  connections: GoogleIntegrationConnection[];
  error: string | null;
};

export function getGoogleOAuthConfig() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!appUrl || !clientId || !clientSecret) {
    return null;
  }

  return {
    appUrl,
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/integrations/google/callback`
  };
}

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function tableMissing(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "42P01" ||
    Boolean(error?.message?.toLowerCase().includes("integration_connections"))
  );
}

function normalizeScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0);
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inboundEmailMetadata(value: unknown) {
  return objectRecord(objectRecord(value).inboundEmail);
}

export async function getGoogleIntegrationOverview(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<GoogleIntegrationOverview> {
  const config = getGoogleOAuthConfig();
  const { data, error } = await supabase
    .from("integration_connections")
    .select("id,account_email,account_name,status,scopes,last_connected_at,last_error,last_sync_at,metadata")
    .eq("workspace_id", workspaceId)
    .eq("provider", GOOGLE_PROVIDER)
    .order("last_connected_at", { ascending: false });

  if (error) {
    return {
      configured: Boolean(config),
      encryptionReady: hasIntegrationTokenEncryptionKey(),
      migrationReady: !tableMissing(error),
      redirectUri: config?.redirectUri ?? null,
      scopes: [...GOOGLE_WORKSPACE_SCOPES],
      connections: [],
      error: tableMissing(error) ? null : error.message
    };
  }

  return {
    configured: Boolean(config),
    encryptionReady: hasIntegrationTokenEncryptionKey(),
    migrationReady: true,
    redirectUri: config?.redirectUri ?? null,
    scopes: [...GOOGLE_WORKSPACE_SCOPES],
    connections: (data ?? []).map((connection) => ({
      id: String(connection.id),
      accountEmail:
        typeof connection.account_email === "string" ? connection.account_email : null,
      accountName: typeof connection.account_name === "string" ? connection.account_name : null,
      status: String(connection.status),
      scopes: normalizeScopes(connection.scopes),
      lastConnectedAt:
        typeof connection.last_connected_at === "string" ? connection.last_connected_at : null,
      lastError: typeof connection.last_error === "string" ? connection.last_error : null,
      lastCheckedAt: textValue(inboundEmailMetadata(connection.metadata).lastCheckedAt),
      lastSyncAt:
        typeof connection.last_sync_at === "string" ? connection.last_sync_at : null,
    })),
    error: null
  };
}
