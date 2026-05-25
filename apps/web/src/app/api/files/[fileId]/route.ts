import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeDownloadName(value: string) {
  return value.replace(/[^\w .()-]+/g, "_").trim() || "attachment";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const { workspace } = await requireWorkspaceContext();
  const serviceSupabase = createServiceSupabaseClient();
  const { data: file, error: fileError } = await serviceSupabase
    .from("files")
    .select("id,workspace_id,storage_bucket,storage_path,filename,content_type")
    .eq("workspace_id", workspace.id)
    .eq("id", fileId)
    .maybeSingle();

  if (fileError) {
    return NextResponse.json(
      { error: `Unable to load file metadata: ${fileError.message}` },
      { status: 400 },
    );
  }

  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const { data, error } = await serviceSupabase.storage
    .from(String(file.storage_bucket))
    .download(String(file.storage_path));

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to download file." },
      { status: 404 },
    );
  }

  return new Response(data, {
    headers: {
      "Content-Disposition": `attachment; filename="${safeDownloadName(
        String(file.filename),
      )}"`,
      "Content-Type": String(file.content_type ?? "application/octet-stream"),
    },
  });
}
