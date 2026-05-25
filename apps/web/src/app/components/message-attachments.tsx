"use client";

type MessageAttachment = {
  contentType: string | null;
  fileId: string | null;
  filename: string;
  sizeBytes: number | null;
  storageStatus: string | null;
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function messageAttachments(metadata: Record<string, unknown>) {
  const attachments = Array.isArray(metadata.attachments)
    ? metadata.attachments
    : [];

  return attachments
    .map((value) => {
      const attachment = objectRecord(value);
      const filename = textValue(attachment.filename);

      if (!filename) {
        return null;
      }

      return {
        contentType: textValue(attachment.contentType),
        fileId: textValue(attachment.fileId),
        filename,
        sizeBytes: numberValue(attachment.sizeBytes),
        storageStatus: textValue(attachment.storageStatus),
      } satisfies MessageAttachment;
    })
    .filter((attachment): attachment is MessageAttachment => Boolean(attachment));
}

function formatSize(value: number | null) {
  if (!value || value < 1) {
    return null;
  }

  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function MessageAttachmentList({
  metadata,
}: Readonly<{
  metadata: Record<string, unknown>;
}>) {
  const attachments = messageAttachments(metadata);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div aria-label="Message attachments" className="message-attachment-list">
      {attachments.map((attachment, index) => {
        const label = [
          attachment.filename,
          formatSize(attachment.sizeBytes),
        ]
          .filter(Boolean)
          .join(" - ");
        const className =
          attachment.storageStatus === "stored"
            ? "message-attachment-chip"
            : "message-attachment-chip unavailable";

        return attachment.fileId ? (
          <a
            className={className}
            href={`/api/files/${attachment.fileId}`}
            key={`${attachment.filename}-${index}`}
          >
            {label}
          </a>
        ) : (
          <span className={className} key={`${attachment.filename}-${index}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
