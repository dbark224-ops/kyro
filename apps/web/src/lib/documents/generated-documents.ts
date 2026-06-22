import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "../supabase/service";
import type { QuotePdfArtifact } from "./pdf";
import { quoteRevisionState } from "./revisions";

export const GENERATED_DOCUMENT_STORAGE_BUCKET =
  process.env.KYRO_FILE_STORAGE_BUCKET?.trim() || "kyro-files";

export type GeneratedDocumentType = "quote" | "invoice";
export type GeneratedDocumentLifecycleStatus =
  | "generated"
  | "filed"
  | "sent"
  | "voided";

export type GeneratedDocumentRecord = {
  id: string;
  workspaceId: string;
  documentType: GeneratedDocumentType;
  lifecycleStatus: GeneratedDocumentLifecycleStatus;
  title: string;
  contactId: string | null;
  leadId: string | null;
  conversationId: string | null;
  quoteDraftId: string | null;
  fileId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentHash: string | null;
  renderer: string | null;
  documentVersion: string | null;
  googleDriveFileId: string | null;
  googleDriveWebUrl: string | null;
  googleDriveSyncedAt: string | null;
  sentMessageId: string | null;
  sentAt: string | null;
  filedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type QuoteDraftDocumentRow = {
  id: string;
  title: string;
  status: string;
  contact_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  metadata: unknown;
};

const ensuredGeneratedDocumentBuckets = new Set<string>();

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function lifecycleStatus(value: unknown): GeneratedDocumentLifecycleStatus {
  return value === "filed" || value === "sent" || value === "voided"
    ? value
    : "generated";
}

function documentType(value: unknown): GeneratedDocumentType {
  return value === "invoice" ? "invoice" : "quote";
}

function safeStorageSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || "document"
  );
}

function generatedDocumentStatusRank(status: GeneratedDocumentLifecycleStatus) {
  if (status === "voided") {
    return 4;
  }

  if (status === "sent") {
    return 3;
  }

  if (status === "filed") {
    return 2;
  }

  return 1;
}

function strongestStatus(
  current: GeneratedDocumentLifecycleStatus,
  next: GeneratedDocumentLifecycleStatus,
) {
  return generatedDocumentStatusRank(next) > generatedDocumentStatusRank(current)
    ? next
    : current;
}

function normalizeGeneratedDocument(row: Record<string, unknown>): GeneratedDocumentRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    documentType: documentType(row.document_type),
    lifecycleStatus: lifecycleStatus(row.lifecycle_status),
    title: String(row.title),
    contactId: textValue(row.contact_id),
    leadId: textValue(row.lead_id),
    conversationId: textValue(row.conversation_id),
    quoteDraftId: textValue(row.quote_draft_id),
    fileId: textValue(row.file_id),
    storageBucket: textValue(row.storage_bucket),
    storagePath: textValue(row.storage_path),
    filename: String(row.filename),
    contentType: String(row.content_type ?? "application/pdf"),
    sizeBytes: numberValue(row.size_bytes),
    contentHash: textValue(row.content_hash),
    renderer: textValue(row.renderer),
    documentVersion: textValue(row.document_version),
    googleDriveFileId: textValue(row.google_drive_file_id),
    googleDriveWebUrl: textValue(row.google_drive_web_url),
    googleDriveSyncedAt: textValue(row.google_drive_synced_at),
    sentMessageId: textValue(row.sent_message_id),
    sentAt: textValue(row.sent_at),
    filedAt: textValue(row.filed_at),
    metadata: objectRecord(row.metadata),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function isGeneratedDocumentsSchemaMiss(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "PGRST205" ||
    (message.includes("schema cache") &&
      message.includes("generated_documents"))
  );
}

async function ensureGeneratedDocumentBucket(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  bucket: string,
) {
  if (ensuredGeneratedDocumentBuckets.has(bucket)) {
    return;
  }

  const { error } = await serviceSupabase.storage.getBucket(bucket);

  if (!error) {
    ensuredGeneratedDocumentBuckets.add(bucket);
    return;
  }

  const { error: createError } = await serviceSupabase.storage.createBucket(
    bucket,
    {
      public: false,
    },
  );

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(createError.message);
  }

  ensuredGeneratedDocumentBuckets.add(bucket);
}

export function generatedDocumentMetadata(document: GeneratedDocumentRecord) {
  return {
    contentHash: document.contentHash,
    contentType: document.contentType,
    filename: document.filename,
    generatedDocumentId: document.id,
    googleDriveFileId: document.googleDriveFileId,
    googleDriveWebUrl: document.googleDriveWebUrl,
    lifecycleStatus: document.lifecycleStatus,
    renderer: document.renderer,
    sizeBytes: document.sizeBytes,
    storageBucket: document.storageBucket,
    storagePath: document.storagePath,
  };
}

export async function getGeneratedDocumentsForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 40,
) {
  const { data, error } = await supabase
    .from("generated_documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isGeneratedDocumentsSchemaMiss(error)) {
      return [];
    }

    throw new Error(`Unable to load generated documents: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    normalizeGeneratedDocument(row as Record<string, unknown>),
  );
}

export async function getGeneratedDocumentsForQuoteDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  quoteDraftId: string,
) {
  const { data, error } = await supabase
    .from("generated_documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("quote_draft_id", quoteDraftId)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    if (isGeneratedDocumentsSchemaMiss(error)) {
      return [];
    }

    throw new Error(`Unable to load quote documents: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    normalizeGeneratedDocument(row as Record<string, unknown>),
  );
}

export async function recordQuoteGeneratedDocument(
  supabase: SupabaseClient,
  {
    artifact,
    createdByUserId,
    documentType,
    lifecycleStatus: requestedStatus = "generated",
    source,
    workspaceId,
    quoteDraft,
  }: {
    artifact: QuotePdfArtifact;
    createdByUserId: string | null;
    documentType: GeneratedDocumentType;
    lifecycleStatus?: GeneratedDocumentLifecycleStatus;
    source: string;
    workspaceId: string;
    quoteDraft:
      | QuoteDraftDocumentRow
      | {
          id: string;
          title: string;
          status: string;
          contact_id?: string | null;
          lead_id?: string | null;
          conversation_id?: string | null;
          metadata?: unknown;
        };
  }) {
  const quoteDraftId = String(quoteDraft.id);
  const metadata = objectRecord(quoteDraft.metadata);
  const { data: existing, error: existingError } = await supabase
    .from("generated_documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("quote_draft_id", quoteDraftId)
    .eq("document_type", documentType)
    .eq("content_hash", artifact.contentHash)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to inspect generated document records: ${existingError.message}`,
    );
  }

  if (existing) {
    const current = normalizeGeneratedDocument(
      existing as Record<string, unknown>,
    );
    const nextStatus = strongestStatus(current.lifecycleStatus, requestedStatus);

    if (nextStatus === current.lifecycleStatus) {
      return current;
    }

    const statusPatch: Record<string, unknown> = {
      lifecycle_status: nextStatus,
    };

    if (nextStatus === "sent") {
      statusPatch.sent_at = new Date().toISOString();
    }

    if (nextStatus === "filed") {
      statusPatch.filed_at = new Date().toISOString();
    }

    const { data: updated, error: updateError } = await supabase
      .from("generated_documents")
      .update(statusPatch)
      .eq("workspace_id", workspaceId)
      .eq("id", current.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw new Error(
        `Unable to update generated document status: ${
          updateError?.message ?? "unknown error"
        }`,
      );
    }

    return normalizeGeneratedDocument(updated as Record<string, unknown>);
  }

  const serviceSupabase = createServiceSupabaseClient();
  const bucket = GENERATED_DOCUMENT_STORAGE_BUCKET;
  const version = quoteRevisionState(metadata).currentVersion;
  const filename = artifact.filename;
  const storagePath = [
    workspaceId,
    "generated-documents",
    documentType,
    quoteDraftId,
    `${safeStorageSegment(artifact.contentHash)}-${safeStorageSegment(filename)}`,
  ].join("/");

  await ensureGeneratedDocumentBucket(serviceSupabase, bucket);

  const { error: uploadError } = await serviceSupabase.storage
    .from(bucket)
    .upload(storagePath, Buffer.from(artifact.bytes), {
      contentType: artifact.contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Unable to store generated PDF: ${uploadError.message}`);
  }

  const { data: file, error: fileError } = await serviceSupabase
    .from("files")
    .insert({
      workspace_id: workspaceId,
      storage_bucket: bucket,
      storage_path: storagePath,
      filename,
      content_type: artifact.contentType,
      size_bytes: artifact.sizeBytes,
      source: `generated_${documentType}`,
    })
    .select("id")
    .single();

  if (fileError || !file) {
    throw new Error(
      `Unable to store generated document file metadata: ${
        fileError?.message ?? "unknown error"
      }`,
    );
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("generated_documents")
    .insert({
      workspace_id: workspaceId,
      document_type: documentType,
      lifecycle_status: requestedStatus,
      title:
        documentType === "invoice" &&
        !String(quoteDraft.title).toLowerCase().startsWith("invoice")
          ? `Invoice - ${String(quoteDraft.title)}`
          : String(quoteDraft.title),
      contact_id: quoteDraft.contact_id ?? null,
      lead_id: quoteDraft.lead_id ?? null,
      conversation_id: quoteDraft.conversation_id ?? null,
      quote_draft_id: quoteDraftId,
      file_id: String(file.id),
      storage_bucket: bucket,
      storage_path: storagePath,
      filename,
      content_type: artifact.contentType,
      size_bytes: artifact.sizeBytes,
      content_hash: artifact.contentHash,
      renderer: "pdf-lib",
      document_version: `v${version}`,
      created_by_user_id: createdByUserId,
      sent_at: requestedStatus === "sent" ? now : null,
      filed_at: requestedStatus === "filed" ? now : null,
      metadata: {
        generatedAt: artifact.generatedAt,
        quoteDraftStatus: quoteDraft.status,
        quoteVersion: version,
        source,
      },
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `Unable to record generated document: ${
        insertError?.message ?? "unknown error"
      }`,
    );
  }

  return normalizeGeneratedDocument(inserted as Record<string, unknown>);
}

export async function markGeneratedDocumentSent(
  supabase: SupabaseClient,
  {
    generatedDocumentId,
    messageId,
    workspaceId,
  }: {
    generatedDocumentId: string;
    messageId: string;
    workspaceId: string;
  },
) {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("generated_documents")
    .select("id,lifecycle_status")
    .eq("workspace_id", workspaceId)
    .eq("id", generatedDocumentId)
    .maybeSingle();

  if (existingError || !existing) {
    return;
  }

  const nextStatus = strongestStatus(
    lifecycleStatus(existing.lifecycle_status),
    "sent",
  );

  await supabase
    .from("generated_documents")
    .update({
      lifecycle_status: nextStatus,
      sent_at: now,
      sent_message_id: messageId,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", generatedDocumentId);
}
