import { randomUUID } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "../supabase/service";

const ASSISTANT_ATTACHMENT_BUCKET =
  process.env.KYRO_FILE_STORAGE_BUCKET?.trim() || "kyro-files";
const MAX_ASSISTANT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ASSISTANT_ATTACHMENT_COUNT = 8;
const MAX_ATTACHMENT_TEXT_BYTES = 48 * 1024;
const ensuredAssistantAttachmentBuckets = new Set<string>();

export type StoredAssistantAttachment = {
  contentType: string | null;
  filename: string;
  fileId: string;
  href: string;
  isImage: boolean;
  previewText: string | null;
  sizeBytes: number;
  storageBucket: string;
  storagePath: string;
};

function safeStorageSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || "attachment"
  );
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isTextLikeContentType(contentType: string | null) {
  if (!contentType) {
    return false;
  }

  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("csv") ||
    contentType.includes("markdown")
  );
}

function isImageContentType(contentType: string | null) {
  return (
    contentType === "image/png" ||
    contentType === "image/jpeg" ||
    contentType === "image/jpg" ||
    contentType === "image/webp"
  );
}

async function ensureAssistantAttachmentBucket(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  bucket: string,
) {
  if (ensuredAssistantAttachmentBuckets.has(bucket)) {
    return;
  }

  const { error } = await serviceSupabase.storage.getBucket(bucket);

  if (!error) {
    ensuredAssistantAttachmentBuckets.add(bucket);
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

  ensuredAssistantAttachmentBuckets.add(bucket);
}

export function assistantAttachmentFormFiles(formData: FormData) {
  return formData
    .getAll("assistantFiles")
    .filter((value): value is File => value instanceof File && value.size > 0)
    .slice(0, MAX_ASSISTANT_ATTACHMENT_COUNT);
}

export async function storeAssistantAttachmentsFromFormData({
  formData,
  user,
  workspaceId,
}: {
  formData: FormData;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const files = assistantAttachmentFormFiles(formData);

  if (files.length === 0) {
    return [] as StoredAssistantAttachment[];
  }

  const serviceSupabase = createServiceSupabaseClient();
  const bucket = ASSISTANT_ATTACHMENT_BUCKET;
  const now = new Date();
  const batchId = safeStorageSegment(
    `${now.toISOString()}-${user.id}-${randomUUID()}`,
  );

  await ensureAssistantAttachmentBucket(serviceSupabase, bucket);

  const stored: StoredAssistantAttachment[] = [];

  for (const [index, file] of files.entries()) {
    if (file.size > MAX_ASSISTANT_ATTACHMENT_BYTES) {
      throw new Error(
        `${file.name} is over the current 25 MB assistant attachment limit.`,
      );
    }

    const filename = file.name || `attachment-${index + 1}`;
    const contentType = textValue(file.type) ?? "application/octet-stream";
    const bytes = Buffer.from(await file.arrayBuffer());
    const storagePath = [
      workspaceId,
      "assistant-uploads",
      `${now.getUTCFullYear()}`,
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      batchId,
      `${index + 1}-${safeStorageSegment(filename)}`,
    ].join("/");

    const { error: uploadError } = await serviceSupabase.storage
      .from(bucket)
      .upload(storagePath, bytes, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Unable to store assistant attachment: ${uploadError.message}`);
    }

    const { data: fileRow, error: fileError } = await serviceSupabase
      .from("files")
      .insert({
        workspace_id: workspaceId,
        storage_bucket: bucket,
        storage_path: storagePath,
        filename,
        content_type: contentType,
        size_bytes: bytes.byteLength,
        source: "assistant_upload",
      })
      .select("id")
      .single();

    if (fileError || !fileRow) {
      throw new Error(
        `Unable to record assistant attachment metadata: ${
          fileError?.message ?? "unknown error"
        }`,
      );
    }

    const previewText =
      isTextLikeContentType(contentType) && bytes.byteLength <= MAX_ATTACHMENT_TEXT_BYTES
        ? bytes.toString("utf8").slice(0, MAX_ATTACHMENT_TEXT_BYTES)
        : null;
    const fileId = String(fileRow.id);

    stored.push({
      contentType,
      filename,
      fileId,
      href: `/api/files/${fileId}?disposition=inline`,
      isImage: isImageContentType(contentType),
      previewText,
      sizeBytes: bytes.byteLength,
      storageBucket: bucket,
      storagePath,
    });
  }

  return stored;
}

export function appendStoredAttachmentContext(
  prompt: string,
  attachments: StoredAssistantAttachment[],
) {
  if (attachments.length === 0) {
    return prompt;
  }

  const attachmentContext = attachments
    .map((attachment) => {
      const lines = [
        `File: ${attachment.filename} (${attachment.contentType ?? "unknown type"}, ${attachment.sizeBytes} bytes)`,
        `Kyro file ID: ${attachment.fileId}`,
        `Kyro file URL: ${attachment.href}`,
        `Image reference: ${attachment.isImage ? "yes" : "no"}`,
      ];

      if (attachment.previewText) {
        lines.push(`Content preview:\n${attachment.previewText}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");

  return `${prompt.trim() || "Please review the attached file context."}\n\nStored Kyro attachment context:\n${attachmentContext}`;
}
