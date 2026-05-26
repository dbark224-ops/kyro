import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MICROSOFT_PROVIDER,
  MICROSOFT_SERVICE,
  getMicrosoftOAuthConfig,
} from "./microsoft";
import {
  decryptIntegrationTokenSet,
  encryptIntegrationTokenSet,
} from "./token-vault";
import type { EmailAttachment, EmailSendResult } from "./mail-types";

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000;

type MicrosoftTokenSet = {
  accessToken?: string;
  expiresIn?: number | null;
  idToken?: string | null;
  obtainedAt?: string | null;
  refreshToken?: string | null;
  scopes?: string[];
  tokenType?: string | null;
};

type MicrosoftConnectionRow = {
  account_email: string | null;
  id: string;
  scopes: unknown;
  token_set: unknown;
};

type MicrosoftGraphErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeScopes(value: unknown) {
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
    : [];
}

function tokenExpiresAt(tokenSet: MicrosoftTokenSet) {
  const obtainedAt = textValue(tokenSet.obtainedAt);
  const expiresIn = typeof tokenSet.expiresIn === "number" ? tokenSet.expiresIn : null;

  if (!obtainedAt || !expiresIn) {
    return null;
  }

  return new Date(new Date(obtainedAt).getTime() + expiresIn * 1000).toISOString();
}

function isExpiring(tokenSet: MicrosoftTokenSet) {
  const expiresAt = tokenExpiresAt(tokenSet);

  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() - Date.now() < ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

function hasMailSendScope(scopes: string[]) {
  return scopes.some((scope) => {
    const normalized = scope.toLowerCase();

    return (
      normalized === "mail.send" ||
      normalized === "https://graph.microsoft.com/mail.send"
    );
  });
}

async function readMicrosoftGraphError(response: Response) {
  const rawText = await response.text();

  try {
    const parsed = JSON.parse(rawText) as MicrosoftGraphErrorPayload;

    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // Fall through to raw response text.
  }

  return rawText.slice(0, 500) || response.statusText;
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
    .update({
      last_error: message,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", connectionId);

  if (error) {
    console.warn("Unable to update Microsoft integration status", error.message);
  }
}

async function loadActiveMicrosoftConnection(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("integration_connections")
    .select("id,account_email,scopes,token_set")
    .eq("workspace_id", workspaceId)
    .eq("provider", MICROSOFT_PROVIDER)
    .eq("service", MICROSOFT_SERVICE)
    .eq("status", "connected")
    .order("last_connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load connected Outlook account: ${error.message}`);
  }

  if (!data) {
    throw new Error("Connect an Outlook account in Settings before sending Outlook email.");
  }

  return data as MicrosoftConnectionRow;
}

async function refreshAccessToken({
  connection,
  supabase,
  tokenSet,
  workspaceId,
}: {
  connection: MicrosoftConnectionRow;
  supabase: SupabaseClient;
  tokenSet: MicrosoftTokenSet;
  workspaceId: string;
}) {
  const config = getMicrosoftOAuthConfig();
  const refreshToken = textValue(tokenSet.refreshToken);

  if (!config || !refreshToken) {
    throw new Error("Microsoft access expired. Reconnect Outlook in Settings.");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch(config.tokenEndpoint, {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
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
      refreshed.error_description ?? refreshed.error ?? "Microsoft token refresh failed.";
    await updateConnectionLastError({
      connectionId: connection.id,
      message: `Microsoft token refresh failed: ${message}`,
      supabase,
      workspaceId,
    });

    throw new Error("Microsoft access expired and refresh failed. Reconnect Outlook in Settings.");
  }

  const updatedTokenSet: MicrosoftTokenSet = {
    ...tokenSet,
    accessToken: refreshed.access_token,
    expiresIn: refreshed.expires_in ?? tokenSet.expiresIn ?? null,
    idToken: refreshed.id_token ?? tokenSet.idToken ?? null,
    obtainedAt: new Date().toISOString(),
    refreshToken: refreshed.refresh_token ?? refreshToken,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : tokenSet.scopes,
    tokenType: refreshed.token_type ?? tokenSet.tokenType ?? null,
  };
  const encrypted = encryptIntegrationTokenSet(updatedTokenSet as Record<string, unknown>);
  const { error } = await supabase
    .from("integration_connections")
    .update({
      access_token_expires_at: tokenExpiresAt(updatedTokenSet),
      last_error: null,
      token_set: encrypted,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", connection.id);

  if (error) {
    throw new Error(`Unable to save refreshed Microsoft access token: ${error.message}`);
  }

  return updatedTokenSet;
}

function graphAttachments(attachments: EmailAttachment[]) {
  return attachments.map((attachment) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    contentBytes: attachment.contentBase64,
    contentId: attachment.contentId ?? undefined,
    contentType: attachment.contentType || "application/octet-stream",
    isInline:
      attachment.disposition === "inline" || Boolean(attachment.contentId),
    name: attachment.filename || "attachment",
  }));
}

export async function sendOutlookMessage(
  supabase: SupabaseClient,
  {
    attachments = [],
    body,
    htmlBody,
    subject,
    to,
    workspaceId,
  }: {
    attachments?: EmailAttachment[];
    body: string;
    htmlBody?: string | null;
    subject: string;
    to: string;
    workspaceId: string;
  },
): Promise<EmailSendResult> {
  const connection = await loadActiveMicrosoftConnection(supabase, workspaceId);
  const scopes = normalizeScopes(connection.scopes);

  if (!hasMailSendScope(scopes)) {
    throw new Error("The connected Outlook account is missing the Mail.Send scope.");
  }

  let tokenSet = decryptIntegrationTokenSet<MicrosoftTokenSet>(
    connection.token_set as Parameters<typeof decryptIntegrationTokenSet>[0],
  );

  if (isExpiring(tokenSet)) {
    tokenSet = await refreshAccessToken({
      connection,
      supabase,
      tokenSet,
      workspaceId,
    });
  }

  const accessToken = textValue(tokenSet.accessToken);

  if (!accessToken) {
    throw new Error("The connected Outlook account does not have a usable access token.");
  }

  const providerRequestId = crypto.randomUUID();
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    body: JSON.stringify({
      message: {
        attachments: graphAttachments(attachments),
        body: {
          content: htmlBody ?? body,
          contentType: htmlBody ? "HTML" : "Text",
        },
        subject,
        toRecipients: [
          {
            emailAddress: {
              address: to,
            },
          },
        ],
      },
      saveToSentItems: true,
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "client-request-id": providerRequestId,
      "Content-Type": "application/json",
      "return-client-request-id": "true",
    },
    method: "POST",
  });

  if (!response.ok) {
    const message = await readMicrosoftGraphError(response);
    const errorMessage = `Outlook send failed: ${message}`;
    await updateConnectionLastError({
      connectionId: connection.id,
      message: errorMessage,
      supabase,
      workspaceId,
    });
    throw new Error(errorMessage);
  }

  await updateConnectionLastError({
    connectionId: connection.id,
    message: null,
    supabase,
    workspaceId,
  });

  return {
    accountEmail: textValue(connection.account_email),
    connectionId: connection.id,
    messageId: null,
    provider: "microsoft",
    providerRequestId:
      response.headers.get("client-request-id") ??
      response.headers.get("request-id") ??
      providerRequestId,
    service: "outlook_mail",
    threadId: null,
  };
}
