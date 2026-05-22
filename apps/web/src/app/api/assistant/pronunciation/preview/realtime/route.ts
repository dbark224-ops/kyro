import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  getPronunciationEntry,
  pronunciationPreviewInstructions,
} from "../../../../../../lib/assistant/pronunciation";
import { getVoiceSettings } from "../../../../../../lib/assistant/voice-settings";
import { requireWorkspaceContext } from "../../../../../../lib/workspace/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function realtimeModel() {
  return envValue("OPENAI_REALTIME_MODEL") || "gpt-realtime-2";
}

function safetyIdentifier(userId: string) {
  return createHash("sha256").update(userId).digest("hex");
}

function providerErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const error = (payload as { error?: unknown }).error;

  if (!error || typeof error !== "object" || !("message" in error)) {
    return null;
  }

  const message = (error as { message?: unknown }).message;

  return typeof message === "string" ? message : null;
}

export async function POST(request: NextRequest) {
  const apiKey = envValue("OPENAI_API_KEY");

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const offerSdp = await request.text();

  if (!offerSdp.trim()) {
    return NextResponse.json(
      { error: "Missing WebRTC SDP offer." },
      { status: 400 },
    );
  }

  const entryId = request.nextUrl.searchParams.get("entryId")?.trim();

  if (!entryId) {
    return NextResponse.json(
      { error: "Pronunciation entry is required." },
      { status: 400 },
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const [entry, voiceSettings] = await Promise.all([
    getPronunciationEntry(supabase, workspace.id, entryId),
    getVoiceSettings(supabase, workspace.id),
  ]);

  if (!entry) {
    return NextResponse.json(
      { error: "Pronunciation entry not found." },
      { status: 404 },
    );
  }

  const formData = new FormData();

  formData.set("sdp", offerSdp);
  formData.set(
    "session",
    JSON.stringify({
      audio: {
        output: {
          voice: voiceSettings.openAiVoice,
        },
      },
      instructions: pronunciationPreviewInstructions({
        ...entry,
        status: "approved",
      }),
      model: realtimeModel(),
      output_modalities: ["audio"],
      type: "realtime",
    }),
  );

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    body: formData,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": safetyIdentifier(user.id),
    },
    method: "POST",
  });
  const answer = await response.text();

  if (!response.ok) {
    let message = answer;

    try {
      message = providerErrorMessage(JSON.parse(answer)) ?? message;
    } catch {
      // Keep the raw provider response if it was not JSON.
    }

    return NextResponse.json(
      { error: message || "Unable to start pronunciation preview." },
      { status: response.status },
    );
  }

  return new Response(answer, {
    headers: {
      "Content-Type": "application/sdp",
    },
  });
}
