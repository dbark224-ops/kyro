import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasIntegrationTokenEncryptionKey } from "./token-vault";

export const MICROSOFT_PROVIDER = "microsoft";
export const MICROSOFT_SERVICE = "outlook_mail";
export const MICROSOFT_GRAPH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.Send",
] as const;

export type MicrosoftIntegrationConnection = {
  id: string;
  accountEmail: string | null;
  accountName: string | null;
  status: string;
  scopes: string[];
  lastConnectedAt: string | null;
  lastError: string | null;
};

export type MicrosoftIntegrationOverview = {
  configured: boolean;
  encryptionReady: boolean;
  migrationReady: boolean;
  redirectUri: string | null;
  scopes: string[];
  connections: MicrosoftIntegrationConnection[];
  error: string | null;
};

export function getMicrosoftOAuthConfig() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  const tenantId = process.env.MICROSOFT_TENANT_ID?.trim() || "common";

  if (!appUrl || !clientId || !clientSecret) {
    return null;
  }

  return {
    appUrl,
    authorizationEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/integrations/microsoft/callback`,
    tenantId,
    tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  };
}

export function hashMicrosoftOAuthState(state: string) {
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

  return value.filter(
    (scope): scope is string => typeof scope === "string" && scope.length > 0,
  );
}

export async function getMicrosoftIntegrationOverview(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<MicrosoftIntegrationOverview> {
  const config = getMicrosoftOAuthConfig();
  const { data, error } = await supabase
    .from("integration_connections")
    .select("id,account_email,account_name,status,scopes,last_connected_at,last_error")
    .eq("workspace_id", workspaceId)
    .eq("provider", MICROSOFT_PROVIDER)
    .order("last_connected_at", { ascending: false });

  if (error) {
    return {
      configured: Boolean(config),
      encryptionReady: hasIntegrationTokenEncryptionKey(),
      migrationReady: !tableMissing(error),
      redirectUri: config?.redirectUri ?? null,
      scopes: [...MICROSOFT_GRAPH_SCOPES],
      connections: [],
      error: tableMissing(error) ? null : error.message,
    };
  }

  return {
    configured: Boolean(config),
    encryptionReady: hasIntegrationTokenEncryptionKey(),
    migrationReady: true,
    redirectUri: config?.redirectUri ?? null,
    scopes: [...MICROSOFT_GRAPH_SCOPES],
    connections: (data ?? []).map((connection) => ({
      id: String(connection.id),
      accountEmail:
        typeof connection.account_email === "string" ? connection.account_email : null,
      accountName:
        typeof connection.account_name === "string" ? connection.account_name : null,
      status: String(connection.status),
      scopes: normalizeScopes(connection.scopes),
      lastConnectedAt:
        typeof connection.last_connected_at === "string"
          ? connection.last_connected_at
          : null,
      lastError:
        typeof connection.last_error === "string" ? connection.last_error : null,
    })),
    error: null,
  };
}
