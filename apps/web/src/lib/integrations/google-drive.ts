import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_PROVIDER,
  GOOGLE_SERVICE,
  getGoogleOAuthConfig,
} from "./google";
import {
  decryptIntegrationTokenSet,
  encryptIntegrationTokenSet,
} from "./token-vault";
import { createServiceSupabaseClient } from "../supabase/service";
import { insertAuditLog } from "../engine/event-action-audit";

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

type GoogleDriveConnectionRow = {
  account_email: string | null;
  id: string;
  scopes: unknown;
  token_set: unknown;
};

type DriveUploadResponse = {
  id?: string;
  webViewLink?: string;
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

function tokenExpiresAt(tokenSet: GoogleTokenSet) {
  const obtainedAt = textValue(tokenSet.obtainedAt);
  const expiresIn =
    typeof tokenSet.expiresIn === "number" ? tokenSet.expiresIn : null;

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

async function readGoogleApiError(response: Response) {
  const rawText = await response.text();

  try {
    const parsed = JSON.parse(rawText) as {
      error?: { message?: string; status?: string };
    };

    return parsed.error?.message ?? parsed.error?.status ?? response.statusText;
  } catch {
    return rawText.slice(0, 500) || response.statusText;
  }
}

async function loadActiveGoogleDriveConnection(
  supabase: SupabaseClient,
  workspaceId: string,
) {
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
    throw new Error("Connect Google in Settings before filing documents to Drive.");
  }

  return data as GoogleDriveConnectionRow;
}

async function refreshAccessToken({
  connection,
  supabase,
  tokenSet,
  workspaceId,
}: {
  connection: GoogleDriveConnectionRow;
  supabase: SupabaseClient;
  tokenSet: GoogleTokenSet;
  workspaceId: string;
}) {
  const config = getGoogleOAuthConfig();
  const refreshToken = textValue(tokenSet.refreshToken);

  if (!config || !refreshToken) {
    throw new Error("Google access expired. Reconnect Google in Settings to refresh Drive access.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const message = await readGoogleApiError(response);

    await supabase
      .from("integration_connections")
      .update({ last_error: `Google token refresh failed: ${message}` })
      .eq("workspace_id", workspaceId)
      .eq("id", connection.id);

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
    throw new Error(`Unable to save refreshed Google access token: ${error.message}`);
  }

  return updatedTokenSet;
}

function multipartDriveBody({
  contentType,
  data,
  filename,
  metadata,
}: {
  contentType: string;
  data: Buffer;
  filename: string;
  metadata: Record<string, unknown>;
}) {
  const boundary = `kyro_drive_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
  const head = Buffer.from(
    [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({
        mimeType: contentType,
        name: filename,
        ...metadata,
      }),
      `--${boundary}`,
      `Content-Type: ${contentType}`,
      "",
    ].join("\r\n"),
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  return {
    body: Buffer.concat([head, data, tail]),
    contentType: `multipart/related; boundary="${boundary}"`,
  };
}

export async function fileGeneratedDocumentToGoogleDrive(
  supabase: SupabaseClient,
  {
    generatedDocumentId,
    userId,
    workspaceId,
  }: {
    generatedDocumentId: string;
    userId: string;
    workspaceId: string;
  },
) {
  const { data: document, error: documentError } = await supabase
    .from("generated_documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", generatedDocumentId)
    .maybeSingle();

  if (documentError) {
    throw new Error(`Unable to load generated document: ${documentError.message}`);
  }

  if (!document) {
    throw new Error("Generated document was not found.");
  }

  const fileId = textValue(document.file_id);
  const storageBucket = textValue(document.storage_bucket);
  const storagePath = textValue(document.storage_path);
  const filename = textValue(document.filename) ?? "kyro-document.pdf";
  const contentType = textValue(document.content_type) ?? "application/pdf";

  if (!fileId || !storageBucket || !storagePath) {
    throw new Error("This document does not have a stored PDF file yet.");
  }

  const connection = await loadActiveGoogleDriveConnection(supabase, workspaceId);
  const scopes = normalizeScopes(connection.scopes);

  if (!scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) {
    throw new Error("The connected Google account is missing the Drive file scope.");
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

  const serviceSupabase = createServiceSupabaseClient();
  const { data: file, error: downloadError } = await serviceSupabase.storage
    .from(storageBucket)
    .download(storagePath);

  if (downloadError || !file) {
    throw new Error(
      `Unable to download stored PDF for Drive filing: ${
        downloadError?.message ?? "download failed"
      }`,
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const { body, contentType: multipartContentType } = multipartDriveBody({
    contentType,
    data: fileBuffer,
    filename,
    metadata: {
      appProperties: {
        documentType: String(document.document_type),
        generatedDocumentId,
        kyroWorkspaceId: workspaceId,
        quoteDraftId: textValue(document.quote_draft_id) ?? "",
      },
      description: `Kyro ${String(document.document_type)} document`,
    },
  });
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": multipartContentType,
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const message = await readGoogleApiError(response);

    await supabase
      .from("integration_connections")
      .update({ last_error: `Google Drive upload failed: ${message}` })
      .eq("workspace_id", workspaceId)
      .eq("id", connection.id);

    throw new Error(`Google Drive upload failed: ${message}`);
  }

  const uploaded = (await response.json()) as DriveUploadResponse;
  const driveFileId = textValue(uploaded.id);

  if (!driveFileId) {
    throw new Error("Google Drive did not return a file id.");
  }

  const now = new Date().toISOString();
  const currentStatus =
    document.lifecycle_status === "sent" || document.lifecycle_status === "voided"
      ? String(document.lifecycle_status)
      : "filed";
  const { data: updated, error: updateError } = await supabase
    .from("generated_documents")
    .update({
      filed_at: document.filed_at ?? now,
      google_drive_file_id: driveFileId,
      google_drive_synced_at: now,
      google_drive_web_url: textValue(uploaded.webViewLink),
      lifecycle_status: currentStatus,
      metadata: {
        ...objectRecord(document.metadata),
        drive: {
          accountEmail: textValue(connection.account_email),
          filedAt: now,
          fileId: driveFileId,
          source: "documents.google_drive_file",
          webViewLink: textValue(uploaded.webViewLink),
        },
      },
    })
    .eq("workspace_id", workspaceId)
    .eq("id", generatedDocumentId)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error(
      `Unable to update generated document after Drive upload: ${
        updateError?.message ?? "unknown error"
      }`,
    );
  }

  await supabase
    .from("integration_connections")
    .update({ last_error: null })
    .eq("workspace_id", workspaceId)
    .eq("id", connection.id);

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "generated_document.drive_filed",
    entityType: "generated_document",
    entityId: generatedDocumentId,
    after: {
      driveFileId,
      webViewLink: textValue(uploaded.webViewLink),
    },
    metadata: {
      accountEmail: textValue(connection.account_email),
      documentType: String(document.document_type),
      fileId,
      source: "documents.google_drive_file",
    },
  });

  return {
    driveFileId,
    webViewLink: textValue(uploaded.webViewLink),
    document: updated,
  };
}
