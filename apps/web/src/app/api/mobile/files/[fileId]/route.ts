import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeDownloadName(value: string) {
  return value.replace(/[^\w .()-]+/g, "_").trim() || "attachment";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const { workspace } = await requireMobileWorkspaceContext(request);
    const serviceSupabase = createServiceSupabaseClient();
    const { data: file, error: fileError } = await serviceSupabase
      .from("files")
      .select("id,workspace_id,storage_bucket,storage_path,filename,content_type")
      .eq("workspace_id", workspace.id)
      .eq("id", fileId)
      .maybeSingle();

    if (fileError) {
      return Response.json(
        { error: `Unable to load file metadata: ${fileError.message}` },
        { status: 400 },
      );
    }

    if (!file) {
      return Response.json({ error: "File not found." }, { status: 404 });
    }

    const { data, error } = await serviceSupabase.storage
      .from(String(file.storage_bucket))
      .download(String(file.storage_path));

    if (error || !data) {
      return Response.json(
        { error: error?.message ?? "Unable to download file." },
        { status: 404 },
      );
    }

    const disposition =
      new URL(request.url).searchParams.get("disposition") === "inline"
        ? "inline"
        : "attachment";

    return new Response(data, {
      headers: {
        "Content-Disposition": `${disposition}; filename="${safeDownloadName(
          String(file.filename),
        )}"`,
        "Content-Type": String(file.content_type ?? "application/octet-stream"),
      },
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
