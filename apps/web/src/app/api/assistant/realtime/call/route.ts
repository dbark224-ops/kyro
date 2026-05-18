import { createHash } from "node:crypto";
import { getAssistantThreadState } from "../../../../../lib/assistant/persistence";
import { assistantWebSearchEnabled } from "../../../../../lib/assistant/web-search";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function realtimeModel() {
  return envValue("OPENAI_REALTIME_MODEL") || "gpt-realtime-2";
}

function realtimeVoice() {
  return envValue("OPENAI_REALTIME_VOICE") || "marin";
}

function realtimeStyleInstructions() {
  return (
    envValue("OPENAI_REALTIME_STYLE_INSTRUCTIONS") ||
    [
      "Voice affect: calm, composed, warm, and quietly confident.",
      "Tone: helpful, practical, and reassuring, like a capable operations assistant who understands service businesses.",
      "Pacing: steady and conversational; pause naturally after important details.",
      "Delivery: concise and clear, with enough warmth to feel human but no exaggerated cheerfulness.",
      "Personality: professional, attentive, lightly upbeat, and grounded. Avoid sounding theatrical, salesy, or robotic.",
    ].join(" ")
  );
}

function sttModel() {
  return envValue("OPENAI_STT_MODEL") || "gpt-4o-mini-transcribe";
}

function realtimeVadThreshold() {
  const parsed = Number(envValue("OPENAI_REALTIME_VAD_THRESHOLD"));

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(1, parsed) : 0.74;
}

function realtimeVadSilenceDurationMs() {
  const parsed = Number(envValue("OPENAI_REALTIME_VAD_SILENCE_DURATION_MS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200;
}

function realtimeVadPrefixPaddingMs() {
  const parsed = Number(envValue("OPENAI_REALTIME_VAD_PREFIX_PADDING_MS"));

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
}

function safetyIdentifier(userId: string) {
  return createHash("sha256").update(userId).digest("hex");
}

function recentThreadContext(state: Awaited<ReturnType<typeof getAssistantThreadState>>) {
  return state.messages
    .slice(-12)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

function memoryContext(state: Awaited<ReturnType<typeof getAssistantThreadState>>) {
  return (state.memories ?? [])
    .slice(0, 8)
    .map((memory) => `- ${memory.content}`)
    .join("\n");
}

function buildInstructions({
  state,
  workspaceName,
}: {
  state: Awaited<ReturnType<typeof getAssistantThreadState>>;
  workspaceName: string;
}) {
  return [
    "You are Kyro, pronounced like Cairo, a live voice assistant inside a trades CRM.",
    "You are the same assistant as the text Assistant page. Keep continuity with the active assistant thread.",
    "Speak naturally and briefly. Prefer one or two spoken paragraphs unless the user asks for detail.",
    "When the user asks about CRM data, quotes, contacts, inquiries, work queue, documents, or saved business state, call kyro_context_lookup before answering.",
    "Use kyro_context_lookup results as the source of truth for CRM/business records. Do not invent customers, prices, dates, links, or business actions.",
    "When the user asks for current public information, news, product details, supplier details, regulations, or anything that needs the internet, call kyro_web_search if it is available.",
    "Never use web search as a substitute for Kyro workspace data. Use CRM tools for private business state and web search for public internet facts.",
    "Do not autonomously send email/SMS or perform external side effects. If an action requires approval, say what can be reviewed in the app.",
    "If the user says remember, note, or for future reference, call kyro_context_lookup so Kyro's normal memory path can handle it.",
    "If speech recognition hears Cara, Kara, Cairo, Kiro, or Kyra near the start of the request, treat it as Kyro unless clearly referring to a real person.",
    realtimeStyleInstructions(),
    `Workspace: ${workspaceName}`,
    state.summary ? `Thread summary: ${state.summary}` : null,
    state.memories?.length ? `Explicit memories:\n${memoryContext(state)}` : null,
    state.messages.length ? `Recent assistant thread:\n${recentThreadContext(state)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function sessionConfig({
  state,
  workspaceName,
}: {
  state: Awaited<ReturnType<typeof getAssistantThreadState>>;
  workspaceName: string;
}) {
  const tools: Array<Record<string, unknown>> = [
    {
      description:
        "Resolve a user request against Kyro's workspace CRM, contacts, inquiries, quote drafts, work queue, memories, and safe backend command router. Call this before answering CRM or business-state questions.",
      name: "kyro_context_lookup",
      parameters: {
        additionalProperties: false,
        properties: {
          prompt: {
            description: "The user's request, cleaned up from the spoken turn.",
            type: "string",
          },
        },
        required: ["prompt"],
        type: "object",
      },
      type: "function",
    },
  ];

  if (assistantWebSearchEnabled()) {
    tools.push({
      description:
        "Search the public internet for current information, news, product details, supplier details, regulations, or other public facts. Do not use it for Kyro CRM or private workspace records.",
      name: "kyro_web_search",
      parameters: {
        additionalProperties: false,
        properties: {
          query: {
            description: "The public web search query to answer.",
            type: "string",
          },
        },
        required: ["query"],
        type: "object",
      },
      type: "function",
    });
  }

  return {
    audio: {
      input: {
        transcription: {
          model: sttModel(),
        },
        turn_detection: {
          prefix_padding_ms: realtimeVadPrefixPaddingMs(),
          silence_duration_ms: realtimeVadSilenceDurationMs(),
          threshold: realtimeVadThreshold(),
          type: "server_vad",
        },
      },
      output: {
        voice: realtimeVoice(),
      },
    },
    instructions: buildInstructions({ state, workspaceName }),
    model: realtimeModel(),
    output_modalities: ["audio"],
    tool_choice: "auto",
    tools,
    type: "realtime",
  };
}

function errorMessage(payload: unknown) {
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

export async function POST(request: Request) {
  const apiKey = envValue("OPENAI_API_KEY");

  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
  }

  const offerSdp = await request.text();

  if (!offerSdp.trim()) {
    return Response.json({ error: "Missing WebRTC SDP offer." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("threadId");
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const state = await getAssistantThreadState({
    supabase,
    threadId,
    user,
    workspace,
  });
  const formData = new FormData();

  formData.set("sdp", offerSdp);
  formData.set(
    "session",
    JSON.stringify(sessionConfig({ state, workspaceName: workspace.name })),
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
      message = errorMessage(JSON.parse(answer)) ?? message;
    } catch {
      // Keep the raw provider response if it was not JSON.
    }

    return Response.json(
      { error: message || "Unable to start OpenAI Realtime session." },
      { status: response.status },
    );
  }

  return new Response(answer, {
    headers: {
      "Content-Type": "application/sdp",
    },
  });
}
