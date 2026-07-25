import { NextResponse, type NextRequest } from "next/server";
import { getVoiceCallPreview } from "../../../../../lib/voice/calls";
import { getApiWorkspaceContext } from "../../../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;

  try {
    const context = await getApiWorkspaceContext(_request);

    if (context instanceof NextResponse) {
      return context;
    }

    const { supabase, workspace } = context;
    const preview = await getVoiceCallPreview(supabase, workspace.id, callId);

    if (!preview) {
      return NextResponse.json({ error: "Voice call not found." }, { status: 404 });
    }

    return NextResponse.json({ data: preview });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load voice call.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
