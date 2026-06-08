import { runAssistantTurn } from "../../../../../lib/assistant/engine";
import {
  appendAssistantTurnMessage,
  appendUserAssistantMessage,
  getAssistantThreadState,
  getAssistantTurnContext,
  getOrCreateAssistantThread,
  maybeSaveAssistantMemory,
  updateAssistantThreadSummary,
} from "../../../../../lib/assistant/persistence";
import { synthesizeAssistantSpeech } from "../../../../../lib/assistant/speech";
import { transcribeAssistantAudio } from "../../../../../lib/assistant/transcription";
import type { AssistantThreadState } from "../../../../../lib/assistant/types";
import { getAssistantRouteMetrics } from "../../../../../lib/assistant/route-metrics";
import {
  mobileErrorResponse,
  MobileApiError,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      throw new MobileApiError("Audio file is required.", 400);
    }

    if (audio.size <= 0) {
      throw new MobileApiError("Audio file is empty.", 400);
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      throw new MobileApiError(
        "Audio file is too large. Keep voice turns under 25 MB.",
        413,
      );
    }

    const thread = await getOrCreateAssistantThread(supabase, workspace, user);
    const threadId = String(thread.id);
    const transcription = await transcribeAssistantAudio({
      audioFile: audio,
      durationMs: numberValue(formData.get("durationMs")),
      supabase,
      user,
      workspace,
    });
    const prompt = transcription.text.trim();

    if (!prompt) {
      throw new MobileApiError("Kyro could not hear anything in that voice turn.", 400);
    }

    const userMessageId = await appendUserAssistantMessage({
      content: prompt,
      inputSource: "voice",
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const context = await getAssistantTurnContext({
      prompt,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const assistantMessage = await runAssistantTurn({
      inputSource: "voice",
      memories: context.memories,
      prompt,
      recentMessages: context.recentMessages,
      supabase,
      threadId,
      threadSummary: context.summary,
      user,
      workspace,
    });
    const memorySaved = await maybeSaveAssistantMemory({
      prompt,
      sourceMessageId: userMessageId,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });

    await appendAssistantTurnMessage({
      memorySaved,
      result: assistantMessage,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    await updateAssistantThreadSummary({
      prompt,
      result: assistantMessage,
      supabase,
      threadId,
      workspaceId: workspace.id,
    });

    const speech = await synthesizeSpeechPayload({
      supabase,
      text: assistantMessage.content,
      user,
      workspace,
    });

    return Response.json({
      assistantTranscript: assistantMessage.content,
      speech: speech.payload,
      speechError: speech.error,
      state: await getMobileAssistantState({
        supabase,
        threadId,
        user,
        workspace,
      }),
      userTranscript: prompt,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

function numberValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function synthesizeSpeechPayload({
  supabase,
  text,
  user,
  workspace,
}: {
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
  text: string;
  user: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["user"];
  workspace: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["workspace"];
}) {
  try {
    const speech = await synthesizeAssistantSpeech({
      sourceMessageId: null,
      supabase,
      text,
      user,
      workspace,
    });

    return {
      error: null,
      payload: {
        audioBase64: Buffer.from(speech.audio).toString("base64"),
        contentType: speech.contentType,
        estimatedSeconds: speech.estimatedSeconds,
        model: speech.model,
        provider: speech.provider,
        speed: speech.speed,
        voice: speech.voice,
      },
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to synthesize voice response.",
      payload: null,
    };
  }
}

async function getMobileAssistantState({
  supabase,
  threadId,
  user,
  workspace,
}: Parameters<typeof getAssistantThreadState>[0]) {
  const metrics = await getAssistantRouteMetrics(supabase, workspace.id);
  const welcomeMessage: AssistantThreadState["messages"][number] = {
    content:
      "I am connected to Kyro's CRM data, help manual, and assistant model. Ask me about the work queue, quotes, customers, settings, or how to use Kyro.",
    createdAt: new Date().toISOString(),
    id: "assistant-welcome",
    links: [
      { href: "/inbox", label: "Inbox", meta: `${metrics.needsReply} need reply` },
      {
        href: "/documents",
        label: "Documents",
        meta: `${metrics.readyQuotes} ready quotes`,
      },
    ],
    role: "assistant",
  };
  const state = await getAssistantThreadState({
    supabase,
    threadId,
    user,
    welcomeMessage,
    workspace,
  });

  return {
    ...state,
    metrics,
    workspace,
  };
}
