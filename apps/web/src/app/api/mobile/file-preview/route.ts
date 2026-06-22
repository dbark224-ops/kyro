import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const fileId = new URL(request.url).searchParams.get("fileId")?.trim();

    if (!fileId) {
      return Response.json({ error: "File id is required." }, { status: 400 });
    }

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

    const contentType = String(file.content_type ?? "application/octet-stream");

    if (!contentType.startsWith("image/")) {
      return Response.json(
        { error: "Only image previews are supported." },
        { status: 415 },
      );
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

    const bytes = Buffer.from(await data.arrayBuffer());

    return Response.json({
      contentType,
      dataUri: `data:${contentType};base64,${bytes.toString("base64")}`,
      filename: String(file.filename),
      id: String(file.id),
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
