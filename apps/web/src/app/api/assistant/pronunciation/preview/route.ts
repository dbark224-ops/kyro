import { NextResponse, type NextRequest } from "next/server";
import {
  getPronunciationEntry,
  pronunciationPreviewText,
} from "../../../../../lib/assistant/pronunciation";
import { synthesizeAssistantSpeech } from "../../../../../lib/assistant/speech";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const entryId = request.nextUrl.searchParams.get("entryId")?.trim();

  if (!entryId) {
    return NextResponse.json(
      { error: "Pronunciation entry is required." },
      { status: 400 },
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const entry = await getPronunciationEntry(supabase, workspace.id, entryId);

  if (!entry) {
    return NextResponse.json(
      { error: "Pronunciation entry not found." },
      { status: 404 },
    );
  }

  try {
    const result = await synthesizeAssistantSpeech({
      pronunciationEntries: [{ ...entry, status: "approved" }],
      sourceMessageId: null,
      supabase,
      text: pronunciationPreviewText(entry),
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
        : "Unable to synthesize pronunciation preview.";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
