import { NextResponse, type NextRequest } from "next/server";

import {
  getPronunciationEntry,
  pronunciationPreviewText,
} from "../../../../../lib/assistant/pronunciation";
import { synthesizeAssistantSpeech } from "../../../../../lib/assistant/speech";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const entryId = request.nextUrl.searchParams.get("entryId")?.trim();

    if (!entryId) {
      return NextResponse.json(
        { error: "Pronunciation entry is required." },
        { status: 400 },
      );
    }

    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const entry = await getPronunciationEntry(supabase, workspace.id, entryId);

    if (!entry) {
      return NextResponse.json(
        { error: "Pronunciation entry not found." },
        { status: 404 },
      );
    }

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
    return mobileErrorResponse(error);
  }
}
