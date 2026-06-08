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

    const { data, error } = await serviceSupabase.storage
      .from(String(file.storage_bucket))
      .createSignedUrl(String(file.storage_path), 120);

    if (error || !data?.signedUrl) {
      return Response.json(
        { error: error?.message ?? "Unable to create file link." },
        { status: 404 },
      );
    }

    return Response.json({
      contentType: String(file.content_type ?? "application/octet-stream"),
      expiresIn: 120,
      filename: String(file.filename),
      id: String(file.id),
      url: data.signedUrl,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
