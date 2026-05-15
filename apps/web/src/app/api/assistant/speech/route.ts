import { NextResponse, type NextRequest } from "next/server";
import { synthesizeAssistantSpeech } from "../../../../lib/assistant/speech";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { getPrimaryWorkspace } from "../../../../lib/workspace/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TEXT_CHARACTERS = 4096;

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

  const payload = (await request.json().catch(() => null)) as unknown;
  const body: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const text = textValue("text" in body ? body.text : null);
  const sourceMessageId = textValue(
    "sourceMessageId" in body ? body.sourceMessageId : null,
  );

  if (!text) {
    return NextResponse.json(
      { error: "Assistant text is required." },
      { status: 400 },
    );
  }

  if (text.length > MAX_TEXT_CHARACTERS) {
    return NextResponse.json(
      { error: "Assistant text is too long for one speech response." },
      { status: 413 },
    );
  }

  try {
    const result = await synthesizeAssistantSpeech({
      sourceMessageId,
      supabase,
      text,
      user,
      workspace,
    });

    return new NextResponse(result.audio, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": result.contentType,
        "X-Kyro-TTS-Estimated-Seconds": String(result.estimatedSeconds),
        "X-Kyro-TTS-Model": result.model,
        "X-Kyro-TTS-Provider": result.provider,
        "X-Kyro-TTS-Speed": String(result.speed),
        "X-Kyro-TTS-Voice": result.voice,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to synthesize assistant speech.";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
