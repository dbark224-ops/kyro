import {
  MICROSOFT_GRAPH_SCOPES,
  MICROSOFT_PROVIDER,
  MICROSOFT_SERVICE,
  getMicrosoftOAuthConfig,
  hashMicrosoftOAuthState,
} from "../../../../lib/integrations/microsoft";
import {
  encryptIntegrationTokenSet,
  hasIntegrationTokenEncryptionKey,
} from "../../../../lib/integrations/token-vault";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type MicrosoftTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type MicrosoftProfile = {
  displayName?: string;
  id?: string;
  mail?: string | null;
  userPrincipalName?: string | null;
};

function settingsRedirect(
  request: Request,
  key: "engine_error" | "engine_message",
  message: string,
) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("section", "integrations");
  url.searchParams.set("panel", "email-accounts");
  url.searchParams.set(key, message);

  return NextResponse.redirect(url);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scopesFromToken(token: MicrosoftTokenResponse) {
  const scopes = textValue(token.scope)?.split(/\s+/).filter(Boolean);

  return scopes?.length ? scopes : [...MICROSOFT_GRAPH_SCOPES];
}

async function exchangeMicrosoftCode({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string;
  codeVerifier: string | null;
  redirectUri: string;
}) {
  const config = getMicrosoftOAuthConfig();

  if (!config) {
    throw new Error("Microsoft OAuth is not configured.");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  const response = await fetch(config.tokenEndpoint, {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const token = (await response.json()) as MicrosoftTokenResponse;

  if (!response.ok || token.error || !token.access_token) {
    throw new Error(
      token.error_description ??
        token.error ??
        "Microsoft token exchange failed.",
    );
  }

  return token;
}

async function getMicrosoftProfile(
  accessToken: string,
): Promise<MicrosoftProfile> {
  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    return {};
  }

  return (await response.json()) as MicrosoftProfile;
}

async function upsertOutlookChannel({
  accountEmail,
  connectionId,
  supabase,
  workspaceId,
}: {
  accountEmail: string | null;
  connectionId: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  workspaceId: string;
}) {
  const externalId = `microsoft:outlook_mail:${accountEmail ?? connectionId}`;
  const channelPayload = {
    workspace_id: workspaceId,
    integration_id: connectionId,
    type: "email",
    display_name: accountEmail ? `Outlook - ${accountEmail}` : "Outlook",
    external_id: externalId,
    status: "active",
    settings: {
      provider: MICROSOFT_PROVIDER,
      service: MICROSOFT_SERVICE,
      connectionId,
      externalSendEnabled: true,
      dryRunUntilEnabled: false,
    },
  };
  const { data: existingChannel, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to inspect Outlook channel: ${existingError.message}`,
    );
  }

  if (existingChannel) {
    const { error } = await supabase
      .from("channels")
      .update(channelPayload)
      .eq("workspace_id", workspaceId)
      .eq("id", existingChannel.id);

    if (error) {
      throw new Error(`Unable to update Outlook channel: ${error.message}`);
    }

    return String(existingChannel.id);
  }

  const { data: channel, error } = await supabase
    .from("channels")
    .insert(channelPayload)
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(
      `Unable to create Outlook channel: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(channel.id);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const microsoftError = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const config = getMicrosoftOAuthConfig();

  if (microsoftError) {
    return settingsRedirect(
      request,
      "engine_error",
      `Microsoft OAuth was cancelled: ${microsoftError}`,
    );
  }

  if (!code || !state) {
    return settingsRedirect(
      request,
      "engine_error",
      "Microsoft OAuth returned without a code.",
    );
  }

  if (!config) {
    return settingsRedirect(
      request,
      "engine_error",
      "Microsoft OAuth is not configured.",
    );
  }

  if (!hasIntegrationTokenEncryptionKey()) {
    return settingsRedirect(
      request,
      "engine_error",
      "Set INTEGRATION_TOKEN_ENCRYPTION_KEY before connecting Microsoft.",
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const { data: oauthState, error: stateError } = await supabase
    .from("integration_oauth_states")
    .select("id,workspace_id,user_id,code_verifier,expires_at,consumed_at")
    .eq("provider", MICROSOFT_PROVIDER)
    .eq("state_hash", hashMicrosoftOAuthState(state))
    .maybeSingle();

  if (stateError || !oauthState) {
    return settingsRedirect(
      request,
      "engine_error",
      stateError?.message ?? "Microsoft OAuth state was not found.",
    );
  }

  if (oauthState.user_id !== user.id) {
    return settingsRedirect(
      request,
      "engine_error",
      "Microsoft OAuth user did not match this session.",
    );
  }

  if (
    oauthState.consumed_at ||
    new Date(String(oauthState.expires_at)).getTime() < Date.now()
  ) {
    return settingsRedirect(
      request,
      "engine_error",
      "Microsoft OAuth state has expired.",
    );
  }

  try {
    const token = await exchangeMicrosoftCode({
      code,
      codeVerifier: textValue(oauthState.code_verifier),
      redirectUri: config.redirectUri,
    });
    const profile = await getMicrosoftProfile(token.access_token!);
    const accountEmail =
      textValue(profile.mail) ?? textValue(profile.userPrincipalName);
    const externalAccountId = textValue(profile.id);
    const connectionKey = `microsoft:${externalAccountId ?? accountEmail ?? user.id}`;
    const now = new Date();
    const scopes = scopesFromToken(token);
    const tokenSet = encryptIntegrationTokenSet({
      accessToken: token.access_token,
      expiresIn: token.expires_in ?? null,
      idToken: token.id_token ?? null,
      obtainedAt: now.toISOString(),
      refreshToken: token.refresh_token ?? null,
      scopes,
      tokenType: token.token_type ?? null,
    });
    const accessTokenExpiresAt =
      typeof token.expires_in === "number"
        ? new Date(now.getTime() + token.expires_in * 1000).toISOString()
        : null;
    const { data: connection, error: connectionError } = await supabase
      .from("integration_connections")
      .upsert(
        {
          workspace_id: oauthState.workspace_id,
          connected_by_user_id: user.id,
          provider: MICROSOFT_PROVIDER,
          service: MICROSOFT_SERVICE,
          connection_key: connectionKey,
          account_email: accountEmail,
          account_name: textValue(profile.displayName),
          external_account_id: externalAccountId,
          status: "connected",
          scopes,
          token_set: tokenSet,
          access_token_expires_at: accessTokenExpiresAt,
          last_connected_at: now.toISOString(),
          last_error: null,
          metadata: {
            source: "microsoft_oauth_callback",
            tenantId: config.tenantId,
          },
        },
        {
          onConflict: "workspace_id,provider,connection_key",
        },
      )
      .select("id")
      .single();

    if (connectionError || !connection) {
      throw new Error(
        connectionError?.message ?? "Unable to save Microsoft connection.",
      );
    }

    await upsertOutlookChannel({
      accountEmail,
      connectionId: String(connection.id),
      supabase,
      workspaceId: String(oauthState.workspace_id),
    });

    await supabase
      .from("integration_oauth_states")
      .update({ consumed_at: now.toISOString() })
      .eq("id", oauthState.id);

    await insertAuditLog(supabase, {
      workspaceId: String(oauthState.workspace_id),
      actorType: "user",
      actorId: user.id,
      action: "integration.microsoft.connected",
      entityType: "integration_connection",
      entityId: String(connection.id),
      after: {
        accountEmail,
        provider: MICROSOFT_PROVIDER,
        scopes,
        service: MICROSOFT_SERVICE,
        status: "connected",
      },
    });

    return settingsRedirect(
      request,
      "engine_message",
      "Microsoft Outlook connected.",
    );
  } catch (error) {
    return settingsRedirect(
      request,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Microsoft OAuth callback failed.",
    );
  }
}
