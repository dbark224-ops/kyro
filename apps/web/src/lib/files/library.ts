import { createServiceSupabaseClient } from "../supabase/service";

export type WorkspaceFileKind =
  | "document"
  | "email"
  | "generated"
  | "image"
  | "system"
  | "upload";

export type WorkspaceFileLibraryItem = {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  source: string;
  sourceLabel: string;
  kind: WorkspaceFileKind;
  createdAt: string;
  downloadHref: string;
  inlineHref: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceLabel(source: string) {
  return source
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function fileKind({
  contentType,
  source,
}: {
  contentType: string | null;
  source: string;
}): WorkspaceFileKind {
  if (source.startsWith("generated_")) {
    return "generated";
  }

  if (source.includes("upload")) {
    return "upload";
  }

  if (contentType?.startsWith("image/")) {
    return "image";
  }

  if (source.includes("email") || source.includes("outbound")) {
    return "email";
  }

  if (contentType === "application/pdf" || source.includes("document")) {
    return "document";
  }

  return "system";
}

function isSchemaCacheMiss(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "PGRST205" ||
    (message.includes("schema cache") && message.includes("files"))
  );
}

function normalizeFile(row: Record<string, unknown>): WorkspaceFileLibraryItem {
  const id = String(row.id);
  const contentType = textValue(row.content_type);
  const source = textValue(row.source) ?? "unknown";

  return {
    contentType,
    createdAt: String(row.created_at),
    downloadHref: `/api/files/${id}`,
    filename: textValue(row.filename) ?? "Untitled file",
    id,
    inlineHref: `/api/files/${id}?disposition=inline`,
    kind: fileKind({ contentType, source }),
    sizeBytes: numberValue(row.size_bytes),
    source,
    sourceLabel: sourceLabel(source),
  };
}

export async function getWorkspaceFileLibrary(workspaceId: string, limit = 80) {
  const serviceSupabase = createServiceSupabaseClient();
  const { data, error } = await serviceSupabase
    .from("files")
    .select("id,filename,content_type,size_bytes,source,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isSchemaCacheMiss(error)) {
      return [];
    }

    throw new Error(`Unable to load saved files: ${error.message}`);
  }

  return (data ?? []).map((row) => normalizeFile(row as Record<string, unknown>));
}
