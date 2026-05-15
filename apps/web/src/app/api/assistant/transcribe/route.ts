import { NextResponse, type NextRequest } from "next/server";
import { transcribeAssistantAudio } from "../../../../lib/assistant/transcription";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { getPrimaryWorkspace } from "../../../../lib/workspace/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function numberValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const audio = formData.get("audio");

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
  }

  if (audio.size <= 0) {
    return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Audio file is too large. Keep voice notes under 25 MB." },
      { status: 413 },
    );
  }

  try {
    const result = await transcribeAssistantAudio({
      audioFile: audio,
      durationMs: numberValue(formData.get("durationMs")),
      supabase,
      user,
      workspace,
    });

    return NextResponse.json({
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to transcribe voice input.";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
