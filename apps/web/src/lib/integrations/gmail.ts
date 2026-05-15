import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GOOGLE_PROVIDER,
  GOOGLE_SERVICE,
  getGoogleOAuthConfig,
} from "./google";
import {
  decryptIntegrationTokenSet,
  encryptIntegrationTokenSet,
} from "./token-vault";
import type { EmailAttachment, EmailSendResult } from "./mail-types";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000;

type GoogleTokenSet = {
  accessToken?: string;
  expiresIn?: number | null;
  idToken?: string | null;
  obtainedAt?: string | null;
  refreshToken?: string | null;
  scopes?: string[];
  tokenType?: string | null;
};

type GoogleConnectionRow = {
  account_email: string | null;
  id: string;
  scopes: unknown;
  token_set: unknown;
};

type GmailSendResponse = {
  id?: string;
  labelIds?: string[];
  threadId?: string;
};

export type GmailAttachment = EmailAttachment;

type GoogleApiErrorPayload = {
  error?: {
    code?: number;
    errors?: Array<{
      message?: string;
      reason?: string;
    }>;
    message?: string;
    status?: string;
  };
};

export type GmailSendResult = EmailSendResult;

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeScopes(value: unknown) {
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
    : [];
}

function tokenExpiresAt(tokenSet: GoogleTokenSet) {
  const obtainedAt = textValue(tokenSet.obtainedAt);
  const expiresIn = typeof tokenSet.expiresIn === "number" ? tokenSet.expiresIn : null;

  if (!obtainedAt || !expiresIn) {
    return null;
  }

  return new Date(new Date(obtainedAt).getTime() + expiresIn * 1000).toISOString();
}

function isExpiring(tokenSet: GoogleTokenSet) {
  const expiresAt = tokenExpiresAt(tokenSet);

  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() - Date.now() < ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

function encodeMimeHeader(value: string) {
  return /[^\x20-\x7E]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value.replace(/\r?\n/g, " ");
}

function sanitizeFilename(value: string) {
  const clean = value
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .trim();

  return clean || "attachment";
}

function safeContentType(value: string) {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
    ? value
    : "application/octet-stream";
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function mimeBoundary(label: string) {
  return `kyro_${label}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function textPart(body: string) {
  return [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
}

function htmlPart(htmlBody: string) {
  return [
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody,
  ];
}

function alternativePart(body: string, htmlBody: string, boundary: string) {
  return [
    `--${boundary}`,
    ...textPart(body),
    `--${boundary}`,
    ...htmlPart(htmlBody),
    `--${boundary}--`,
  ];
}

function buildRawEmail({
  attachments = [],
  body,
  from,
  htmlBody,
  subject,
  to,
}: {
  attachments?: GmailAttachment[];
  body: string;
  from: string | null;
  htmlBody?: string | null;
  subject: string;
  to: string;
}) {
  const baseHeaders = [
    `To: ${to}`,
    from ? `From: ${from}` : null,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  if (attachments.length === 0 && !htmlBody) {
    const headers = [
      ...baseHeaders,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
    ];

    return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
  }

  if (attachments.length === 0 && htmlBody) {
    const boundary = mimeBoundary("alt");
    const headers = [
      ...baseHeaders,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];

    return Buffer.from(
      `${headers.join("\r\n")}\r\n\r\n${alternativePart(body, htmlBody, boundary).join("\r\n")}\r\n`,
      "utf8",
    ).toString("base64url");
  }

  const boundary = mimeBoundary("mixed");
  const headers = [
    ...baseHeaders,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const bodyParts = htmlBody
    ? [
        `--${boundary}`,
        `Content-Type: multipart/alternative; boundary="${mimeBoundary("alt")}"`,
      ]
    : [
        `--${boundary}`,
        ...textPart(body),
      ];
  const alternativeBoundary = htmlBody
    ? bodyParts[1]?.match(/boundary="([^"]+)"/)?.[1]
    : null;
  const parts = [
    ...bodyParts,
    ...(htmlBody && alternativeBoundary
      ? ["", ...alternativePart(body, htmlBody, alternativeBoundary)]
      : []),
    ...attachments.flatMap((attachment) => {
      const filename = sanitizeFilename(attachment.filename);
      const disposition = attachment.disposition ?? (
        attachment.contentId ? "inline" : "attachment"
      );

      return [
        `--${boundary}`,
        `Content-Type: ${safeContentType(attachment.contentType)}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        attachment.contentId ? `Content-ID: <${attachment.contentId}>` : null,
        `Content-Disposition: ${disposition}; filename="${filename}"`,
        "",
        wrapBase64(attachment.contentBase64),
      ].filter(Boolean);
    }),
    `--${boundary}--`,
    "",
  ];

  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`, "utf8").toString("base64url");
}

function simplifyGoogleApiError(message: string) {
  const projectMatch = message.match(/project\s+(\d+)/i);

  if (
    message.includes("Gmail API has not been used") ||
    message.toLowerCase().includes("gmail api") &&
      message.toLowerCase().includes("disabled")
  ) {
    const projectText = projectMatch?.[1]
      ? ` for Google Cloud project ${projectMatch[1]}`
      : "";

    return `Gmail API is disabled${projectText}. Enable the Gmail API in Google Cloud, wait a few minutes for Google to propagate the change, then retry the send.`;
  }

  return message;
}

async function readGoogleApiError(response: Response) {
  const rawText = await response.text();

  try {
    const parsed = JSON.parse(rawText) as GoogleApiErrorPayload;
    const primaryMessage =
      parsed.error?.message ??
      parsed.error?.errors?.find((item) => item.message)?.message;

    if (primaryMessage) {
      return simplifyGoogleApiError(primaryMessage);
    }
  } catch {
    // Fall through to the raw response text below.
  }

  return simplifyGoogleApiError(rawText.slice(0, 500) || response.statusText);
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
    console.warn("Unable to update Google integration status", error.message);
  }
}

async function loadActiveGoogleConnection(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from("integration_connections")
    .select("id,account_email,scopes,token_set")
    .eq("workspace_id", workspaceId)
    .eq("provider", GOOGLE_PROVIDER)
    .eq("service", GOOGLE_SERVICE)
    .eq("status", "connected")
    .order("last_connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load connected Google account: ${error.message}`);
  }

  if (!data) {
    throw new Error("Connect a Google account in Settings before sending real email.");
  }

  return data as GoogleConnectionRow;
}

async function refreshAccessToken({
  connection,
  supabase,
  tokenSet,
  workspaceId,
}: {
  connection: GoogleConnectionRow;
  supabase: SupabaseClient;
  tokenSet: GoogleTokenSet;
  workspaceId: string;
}) {
  const config = getGoogleOAuthConfig();
  const refreshToken = textValue(tokenSet.refreshToken);

  if (!config || !refreshToken) {
    throw new Error("Google access expired. Reconnect Google in Settings to refresh Gmail access.");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const message = await readGoogleApiError(response);
    await updateConnectionLastError({
      connectionId: connection.id,
      message: `Google token refresh failed: ${message}`,
      supabase,
      workspaceId,
    });

    throw new Error("Google access expired and refresh failed. Reconnect Google in Settings.");
  }

  const refreshed = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
    token_type?: string;
  };
  const updatedTokenSet: GoogleTokenSet = {
    ...tokenSet,
    accessToken: refreshed.access_token ?? tokenSet.accessToken,
    expiresIn: refreshed.expires_in ?? tokenSet.expiresIn ?? null,
    idToken: refreshed.id_token ?? tokenSet.idToken ?? null,
    obtainedAt: new Date().toISOString(),
    refreshToken,
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
    throw new Error(`Unable to save refreshed Google access token: ${error.message}`);
  }

  return updatedTokenSet;
}

export async function sendGmailMessage(
  supabase: SupabaseClient,
  {
    attachments,
    body,
    htmlBody,
    subject,
    to,
    workspaceId,
  }: {
    attachments?: GmailAttachment[];
    body: string;
    htmlBody?: string | null;
    subject: string;
    to: string;
    workspaceId: string;
  },
): Promise<GmailSendResult> {
  const connection = await loadActiveGoogleConnection(supabase, workspaceId);
  const scopes = normalizeScopes(connection.scopes);

  if (!scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new Error("The connected Google account is missing the Gmail send scope.");
  }

  let tokenSet = decryptIntegrationTokenSet<GoogleTokenSet>(
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
    throw new Error("The connected Google account does not have a usable access token.");
  }

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    body: JSON.stringify({
      raw: buildRawEmail({
        attachments,
        body,
        from: textValue(connection.account_email),
        htmlBody,
        subject,
        to,
      }),
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const message = await readGoogleApiError(response);
    const errorMessage = `Gmail send failed: ${message}`;
    await updateConnectionLastError({
      connectionId: connection.id,
      message: errorMessage,
      supabase,
      workspaceId,
    });
    throw new Error(errorMessage);
  }

  const sent = (await response.json()) as GmailSendResponse;

  if (!sent.id) {
    throw new Error("Gmail did not return a message id for the sent email.");
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
    messageId: sent.id,
    provider: "google",
    service: "gmail",
    threadId: textValue(sent.threadId),
  };
}
