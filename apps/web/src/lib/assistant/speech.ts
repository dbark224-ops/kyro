import { createUsageEvent } from "@kyro/api";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";

const DEFAULT_TTS_MODEL = "tts-1";
const DEFAULT_TTS_VOICE = "alloy";
const DEFAULT_TTS_FORMAT = "wav";
const DEFAULT_TTS_SPEED = 1;
const MIN_USABLE_TTS_SPEED = 1;
const DEFAULT_MARKUP_RATE = 0.25;
const DEFAULT_TTS_INSTRUCTIONS =
  "Speak as Kyro, a practical AI assistant for a trades CRM. Use a normal, brisk conversational pace with short pauses. Keep the delivery warm, concise, and easy to understand for a busy tradesperson.";
const DEFAULT_UNIT_COSTS_PER_SECOND: Record<string, number> = {};
const MAX_TTS_CHARACTERS = 4096;

type WorkspaceInput = {
  id: string;
};

type SynthesizeAssistantSpeechInput = {
  sourceMessageId: string | null;
  supabase: SupabaseClient;
  text: string;
  user: User;
  workspace: WorkspaceInput;
};

export type SynthesizeAssistantSpeechResult = {
  audio: ArrayBuffer;
  contentType: string;
  estimatedSeconds: number;
  model: string;
  provider: "openai";
  speed: number;
  voice: string;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function ttsModel() {
  return envValue("OPENAI_TTS_MODEL") || DEFAULT_TTS_MODEL;
}

function ttsVoice() {
  return envValue("OPENAI_TTS_VOICE") || DEFAULT_TTS_VOICE;
}

function ttsFormat() {
  return envValue("OPENAI_TTS_FORMAT") || DEFAULT_TTS_FORMAT;
}

function ttsInstructions() {
  return envValue("OPENAI_TTS_INSTRUCTIONS") || DEFAULT_TTS_INSTRUCTIONS;
}

function ttsMarkupRate() {
  const parsed = Number(envValue("OPENAI_TTS_MARKUP_RATE"));

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MARKUP_RATE;
}

function ttsSpeed() {
  const parsed = Number(envValue("OPENAI_TTS_SPEED"));

  if (!Number.isFinite(parsed) || parsed < MIN_USABLE_TTS_SPEED) {
    return DEFAULT_TTS_SPEED;
  }

  return Math.min(4, parsed);
}

function ttsUnitCostPerSecond(model: string) {
  const parsed = Number(envValue("OPENAI_TTS_UNIT_COST_PER_SECOND_USD"));

  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return DEFAULT_UNIT_COSTS_PER_SECOND[model] ?? 0;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uuidValue(value: string | null) {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

function openAiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = "error" in payload ? payload.error : null;

  if (error && typeof error === "object" && "message" in error) {
    return textValue(error.message);
  }

  return null;
}

function sanitizeSpeechText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TTS_CHARACTERS);
}

function estimatedSpeechSeconds(text: string, speed: number) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const seconds = Math.max(1, words / 2.55 / speed);

  return Number(seconds.toFixed(3));
}

function contentTypeForFormat(format: string) {
  if (format === "aac") {
    return "audio/aac";
  }

  if (format === "flac") {
    return "audio/flac";
  }

  if (format === "opus") {
    return "audio/opus";
  }

  if (format === "pcm") {
    return "audio/pcm";
  }

  if (format === "wav") {
    return "audio/wav";
  }

  return "audio/mpeg";
}

function fourCc(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function normalizeWavHeader(audio: ArrayBuffer, format: string) {
  if (format !== "wav" || audio.byteLength < 44) {
    return audio;
  }

  const input = new Uint8Array(audio);

  if (fourCc(input, 0) !== "RIFF" || fourCc(input, 8) !== "WAVE") {
    return audio;
  }

  const output = new Uint8Array(audio.byteLength);

  output.set(input);

  const view = new DataView(output.buffer);

  view.setUint32(4, Math.max(0, output.byteLength - 8), true);

  let offset = 12;

  while (offset + 8 <= output.byteLength) {
    const chunkId = fourCc(output, offset);
    const rawChunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "data") {
      view.setUint32(offset + 4, Math.max(0, output.byteLength - offset - 8), true);
      break;
    }

    if (rawChunkSize === 0xffffffff) {
      break;
    }

    offset += 8 + rawChunkSize + (rawChunkSize % 2);
  }

  return output.buffer;
}

function toUsageEventRow(input: {
  costSnapshot: number;
  customerChargeSnapshot: number;
  markupSnapshot: number;
  model: string;
  quantity: number;
  sourceMessageId: string | null;
  unitCostSnapshot: number;
  userId: string;
  workspaceId: string;
}) {
  const sourceMessageId = uuidValue(input.sourceMessageId);
  const event = createUsageEvent({
    costSnapshot: input.costSnapshot,
    currency: "USD",
    customerChargeSnapshot: input.customerChargeSnapshot,
    markupSnapshot: input.markupSnapshot,
    model: input.model,
    provider: "openai",
    quantity: input.quantity,
    service: "text_to_speech",
    sourceId: sourceMessageId ?? undefined,
    sourceType: "assistant_message",
    unit: "second",
    unitCostSnapshot: input.unitCostSnapshot,
    usageType: "text_to_speech_seconds",
    userId: input.userId,
    workspaceId: input.workspaceId,
  });

  return {
    action_id: event.actionId ?? null,
    ai_run_id: event.aiRunId ?? null,
    cost_snapshot: String(event.costSnapshot),
    currency: event.currency,
    customer_charge_snapshot: String(event.customerChargeSnapshot),
    markup_snapshot: String(event.markupSnapshot),
    metadata: {
      source: "assistant.voice_reply",
    },
    model: event.model ?? null,
    provider: event.provider,
    quantity: String(event.quantity),
    service: event.service,
    source_id: event.sourceId ?? null,
    source_type: event.sourceType ?? "assistant_message",
    unit: event.unit,
    unit_cost_snapshot: String(event.unitCostSnapshot),
    unit_price_snapshot: event.unitPriceSnapshot
      ? String(event.unitPriceSnapshot)
      : null,
    usage_type: event.usageType,
    user_id: event.userId ?? null,
    workflow_run_id: event.workflowRunId ?? null,
    workspace_id: event.workspaceId,
  };
}

export async function synthesizeAssistantSpeech({
  sourceMessageId,
  supabase,
  text,
  user,
  workspace,
}: SynthesizeAssistantSpeechInput): Promise<SynthesizeAssistantSpeechResult> {
  const apiKey = openAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for text-to-speech.");
  }

  const input = sanitizeSpeechText(text);

  if (!input) {
    throw new Error("No assistant text was provided for speech.");
  }

  const model = ttsModel();
  const voice = ttsVoice();
  const responseFormat = ttsFormat();
  const speed = ttsSpeed();
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    body: JSON.stringify({
      input,
      model,
      response_format: responseFormat,
      speed,
      voice,
      ...(!["tts-1", "tts-1-hd"].includes(model)
        ? { instructions: ttsInstructions() }
        : {}),
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;

    throw new Error(
      openAiErrorMessage(payload) ??
        `OpenAI speech synthesis failed with HTTP ${response.status}.`,
    );
  }

  const audio = normalizeWavHeader(await response.arrayBuffer(), responseFormat);
  const estimatedSeconds = estimatedSpeechSeconds(input, speed);
  const unitCost = ttsUnitCostPerSecond(model);
  const markup = ttsMarkupRate();
  const cost = Number((estimatedSeconds * unitCost).toFixed(8));
  const customerCharge = Number((cost * (1 + markup)).toFixed(8));

  const { error: usageError } = await supabase.from("usage_events").insert(
    toUsageEventRow({
      costSnapshot: cost,
      customerChargeSnapshot: customerCharge,
      markupSnapshot: markup,
      model,
      quantity: estimatedSeconds,
      sourceMessageId,
      unitCostSnapshot: unitCost,
      userId: user.id,
      workspaceId: workspace.id,
    }),
  );

  if (usageError) {
    throw new Error(`Unable to record text-to-speech usage: ${usageError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "assistant.voice_reply_synthesized",
    actorId: user.id,
    actorType: "user",
    after: {
      audioBytes: audio.byteLength,
      estimatedSeconds,
      model,
      provider: "openai",
      sourceMessageId,
      speed,
      textCharacters: input.length,
      voice,
    },
    entityId: uuidValue(sourceMessageId) ?? undefined,
    entityType: "assistant_message",
    metadata: {
      responseFormat,
      source: "assistant.voice_reply",
    },
  });

  return {
    audio,
    contentType: contentTypeForFormat(responseFormat),
    estimatedSeconds,
    model,
    provider: "openai",
    speed,
    voice,
  };
}
