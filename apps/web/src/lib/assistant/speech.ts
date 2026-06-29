import { createUsageEvent } from "@kyro/api";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  applyUsageMarkup,
  roundUsageMoney,
  usageMarkupRate,
} from "../usage/pricing";
import {
  getActivePronunciationEntries,
  pronunciationGuideText,
  type AssistantPronunciationEntry,
} from "./pronunciation";
import { getVoiceSettings, type VoiceSettings } from "./voice-settings";

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "ballad";
const DEFAULT_TTS_FORMAT = "wav";
const DEFAULT_TTS_SPEED = 1;
const MIN_USABLE_TTS_SPEED = 1;
const OPENAI_PRICE_SOURCE = "openai_api_pricing_2026_05_24";
const OPENAI_TTS_AUDIO_TOKENS_PER_SECOND = 20;
const DEFAULT_TTS_INSTRUCTIONS =
  "Speak as Kyro, a practical AI assistant for a trades CRM. Use a normal, brisk conversational pace with short pauses. Keep the delivery warm, concise, and easy to understand for a busy tradesperson.";
const DEFAULT_OPENAI_TTS_MODEL_PRICES: Record<
  string,
  { audioOutputPer1M: number; textInputPer1M: number }
> = {
  "gpt-4o-mini-tts": { audioOutputPer1M: 12, textInputPer1M: 0.6 },
};
const MAX_TTS_CHARACTERS = 4096;

type TtsProvider = "openai" | "elevenlabs";
type TtsUsageType = "text_to_speech_characters" | "text_to_speech_seconds";

type ProviderSpeechResult = SynthesizeAssistantSpeechResult & {
  responseFormat: string;
  usage: {
    costSnapshot: number;
    customerChargeSnapshot: number;
    markupSnapshot: number;
    priceEstimated: boolean;
    priceSource: string;
    quantity: number;
    unit: string;
    unitCostSnapshot: number;
    usageType: TtsUsageType;
  };
};

type WorkspaceInput = {
  id: string;
};

type SynthesizeAssistantSpeechInput = {
  pronunciationEntries?: AssistantPronunciationEntry[];
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
  provider: TtsProvider;
  speed: number;
  voice: string;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function openAiTtsModel() {
  return envValue("OPENAI_TTS_MODEL") || DEFAULT_TTS_MODEL;
}

function openAiTtsVoice(voiceSettings: VoiceSettings) {
  return (
    voiceSettings.openAiVoice ||
    envValue("OPENAI_TTS_VOICE") ||
    DEFAULT_TTS_VOICE
  );
}

function openAiTtsFormat() {
  return envValue("OPENAI_TTS_FORMAT") || DEFAULT_TTS_FORMAT;
}

function openAiTtsInstructions(entries: AssistantPronunciationEntry[]) {
  const baseInstructions =
    envValue("OPENAI_TTS_INSTRUCTIONS") || DEFAULT_TTS_INSTRUCTIONS;
  const guide = pronunciationGuideText(entries);

  return guide
    ? [
        baseInstructions,
        "Use this workspace pronunciation vocabulary when speaking names, places, acronyms, and business terms:",
        guide,
      ].join("\n\n")
    : baseInstructions;
}

function openAiTtsMarkupRate() {
  return usageMarkupRate("OPENAI_TTS_MARKUP_RATE");
}

function openAiTtsSpeed() {
  const parsed = Number(envValue("OPENAI_TTS_SPEED"));

  if (!Number.isFinite(parsed) || parsed < MIN_USABLE_TTS_SPEED) {
    return DEFAULT_TTS_SPEED;
  }

  return Math.min(4, parsed);
}

function estimateTextTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function openAiTtsCost(input: {
  estimatedSeconds: number;
  model: string;
  text: string;
}) {
  const override = envValue("OPENAI_TTS_UNIT_COST_PER_SECOND_USD");
  const parsed = override ? Number(override) : null;

  if (parsed !== null && Number.isFinite(parsed) && parsed >= 0) {
    return {
      cost: Number((input.estimatedSeconds * parsed).toFixed(8)),
      priceEstimated: false,
      priceSource: "env:OPENAI_TTS_UNIT_COST_PER_SECOND_USD",
      unitCost: parsed,
    };
  }

  const pricing = DEFAULT_OPENAI_TTS_MODEL_PRICES[input.model];

  if (!pricing) {
    return {
      cost: 0,
      priceEstimated: true,
      priceSource: `${OPENAI_PRICE_SOURCE}:fallback:unknown_tts_model`,
      unitCost: 0,
    };
  }

  const audioTokens = Math.ceil(
    input.estimatedSeconds * OPENAI_TTS_AUDIO_TOKENS_PER_SECOND,
  );
  const textTokens = estimateTextTokens(input.text);
  const audioCost = (audioTokens * pricing.audioOutputPer1M) / 1_000_000;
  const textCost = (textTokens * pricing.textInputPer1M) / 1_000_000;
  const cost = Number((audioCost + textCost).toFixed(8));

  return {
    cost,
    priceEstimated: true,
    priceSource: `${OPENAI_PRICE_SOURCE}:${input.model}:estimated_text_input_audio_output`,
    unitCost:
      input.estimatedSeconds > 0
        ? Number((cost / input.estimatedSeconds).toFixed(10))
        : cost,
  };
}

function elevenLabsApiKey() {
  return envValue("ELEVENLABS_API_KEY");
}

function elevenLabsTtsMarkupRate() {
  return usageMarkupRate("ELEVENLABS_TTS_MARKUP_RATE");
}

function elevenLabsTtsUnitCostPerCharacter() {
  const parsed = Number(envValue("ELEVENLABS_TTS_UNIT_COST_PER_CHARACTER_USD"));

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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

function providerErrorMessage(payload: unknown) {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = "error" in payload ? payload.error : null;

  if (error && typeof error === "object" && "message" in error) {
    return textValue(error.message);
  }

  if (error && typeof error === "string") {
    return textValue(error);
  }

  const detail = "detail" in payload ? payload.detail : null;

  if (typeof detail === "string") {
    return textValue(detail);
  }

  if (detail && typeof detail === "object" && "message" in detail) {
    return textValue(detail.message);
  }

  if ("message" in payload) {
    return textValue(payload.message);
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

function contentTypeForElevenLabsFormat(format: string) {
  if (format.startsWith("pcm_")) {
    return "audio/pcm";
  }

  if (format.startsWith("opus_")) {
    return "audio/opus";
  }

  if (format.startsWith("ulaw_") || format.startsWith("mulaw_")) {
    return "audio/basic";
  }

  if (format.startsWith("alaw_")) {
    return "audio/alaw";
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
      view.setUint32(
        offset + 4,
        Math.max(0, output.byteLength - offset - 8),
        true,
      );
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
  priceEstimated: boolean;
  priceSource: string;
  provider: TtsProvider;
  quantity: number;
  sourceMessageId: string | null;
  unit: string;
  unitCostSnapshot: number;
  usageType: TtsUsageType;
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
    provider: input.provider,
    quantity: input.quantity,
    service: "text_to_speech",
    sourceId: sourceMessageId ?? undefined,
    sourceType: "assistant_message",
    unit: input.unit,
    unitCostSnapshot: input.unitCostSnapshot,
    usageType: input.usageType,
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
      priceEstimated: input.priceEstimated,
      priceSource: input.priceSource,
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

async function parseProviderErrorPayload(response: Response) {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => null)) as unknown;
  }

  return response.text().catch(() => null);
}

async function synthesizeOpenAiSpeech(
  input: string,
  pronunciationEntries: AssistantPronunciationEntry[],
  voiceSettings: VoiceSettings,
): Promise<ProviderSpeechResult> {
  const apiKey = openAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for text-to-speech.");
  }

  const model = openAiTtsModel();
  const voice = openAiTtsVoice(voiceSettings);
  const responseFormat = openAiTtsFormat();
  const speed = openAiTtsSpeed();
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    body: JSON.stringify({
      input,
      model,
      response_format: responseFormat,
      speed,
      voice,
      ...(!["tts-1", "tts-1-hd"].includes(model)
        ? { instructions: openAiTtsInstructions(pronunciationEntries) }
        : {}),
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = await parseProviderErrorPayload(response);

    throw new Error(
      providerErrorMessage(payload) ??
        `OpenAI speech synthesis failed with HTTP ${response.status}.`,
    );
  }

  const audio = normalizeWavHeader(
    await response.arrayBuffer(),
    responseFormat,
  );
  const estimatedSeconds = estimatedSpeechSeconds(input, speed);
  const pricing = openAiTtsCost({ estimatedSeconds, model, text: input });
  const markup = openAiTtsMarkupRate();

  return {
    audio,
    contentType: contentTypeForFormat(responseFormat),
    estimatedSeconds,
    model,
    provider: "openai",
    responseFormat,
    speed,
    usage: {
      costSnapshot: pricing.cost,
      customerChargeSnapshot: roundUsageMoney(
        applyUsageMarkup(pricing.cost, markup),
      ),
      markupSnapshot: markup,
      priceEstimated: pricing.priceEstimated,
      priceSource: pricing.priceSource,
      quantity: estimatedSeconds,
      unit: "second",
      unitCostSnapshot: pricing.unitCost,
      usageType: "text_to_speech_seconds",
    },
    voice,
  };
}

async function synthesizeElevenLabsSpeech(
  input: string,
  voiceSettings: VoiceSettings,
): Promise<ProviderSpeechResult> {
  const apiKey = elevenLabsApiKey();

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured for text-to-speech.");
  }

  const model = voiceSettings.elevenLabsModel;
  const voice = voiceSettings.elevenLabsVoiceId;
  const responseFormat = voiceSettings.elevenLabsOutputFormat;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voice,
    )}/stream?output_format=${encodeURIComponent(responseFormat)}`,
    {
      body: JSON.stringify({
        model_id: model,
        text: input,
        voice_settings: {
          similarity_boost: voiceSettings.elevenLabsSimilarityBoost,
          stability: voiceSettings.elevenLabsStability,
          style: voiceSettings.elevenLabsStyle,
          use_speaker_boost: voiceSettings.elevenLabsUseSpeakerBoost,
        },
      }),
      headers: {
        Accept: contentTypeForElevenLabsFormat(responseFormat),
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const payload = await parseProviderErrorPayload(response);

    throw new Error(
      providerErrorMessage(payload) ??
        `ElevenLabs speech synthesis failed with HTTP ${response.status}.`,
    );
  }

  const audio = await response.arrayBuffer();
  const speed = 1;
  const estimatedSeconds = estimatedSpeechSeconds(input, speed);
  const quantity = input.length;
  const unitCost = elevenLabsTtsUnitCostPerCharacter();
  const markup = elevenLabsTtsMarkupRate();
  const cost = Number((quantity * unitCost).toFixed(8));

  return {
    audio,
    contentType:
      response.headers.get("Content-Type") ??
      contentTypeForElevenLabsFormat(responseFormat),
    estimatedSeconds,
    model,
    provider: "elevenlabs",
    responseFormat,
    speed,
    usage: {
      costSnapshot: cost,
      customerChargeSnapshot: roundUsageMoney(applyUsageMarkup(cost, markup)),
      markupSnapshot: markup,
      priceEstimated: false,
      priceSource: "elevenlabs_pricing_env",
      quantity,
      unit: "character",
      unitCostSnapshot: unitCost,
      usageType: "text_to_speech_characters",
    },
    voice,
  };
}

export async function synthesizeAssistantSpeech({
  pronunciationEntries: pronunciationEntriesOverride,
  sourceMessageId,
  supabase,
  text,
  user,
  workspace,
}: SynthesizeAssistantSpeechInput): Promise<SynthesizeAssistantSpeechResult> {
  const input = sanitizeSpeechText(text);

  if (!input) {
    throw new Error("No assistant text was provided for speech.");
  }

  const voiceSettings = await getVoiceSettings(supabase, workspace.id);
  const pronunciationEntries =
    pronunciationEntriesOverride ??
    (await getActivePronunciationEntries(supabase, workspace.id));
  const speech =
    voiceSettings.provider === "elevenlabs"
      ? await synthesizeElevenLabsSpeech(input, voiceSettings)
      : await synthesizeOpenAiSpeech(
          input,
          pronunciationEntries,
          voiceSettings,
        );

  const { error: usageError } = await supabase.from("usage_events").insert(
    toUsageEventRow({
      costSnapshot: speech.usage.costSnapshot,
      customerChargeSnapshot: speech.usage.customerChargeSnapshot,
      markupSnapshot: speech.usage.markupSnapshot,
      model: speech.model,
      priceEstimated: speech.usage.priceEstimated,
      priceSource: speech.usage.priceSource,
      provider: speech.provider,
      quantity: speech.usage.quantity,
      sourceMessageId,
      unit: speech.usage.unit,
      unitCostSnapshot: speech.usage.unitCostSnapshot,
      usageType: speech.usage.usageType,
      userId: user.id,
      workspaceId: workspace.id,
    }),
  );

  if (usageError) {
    throw new Error(
      `Unable to record text-to-speech usage: ${usageError.message}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "assistant.voice_reply_synthesized",
    actorId: user.id,
    actorType: "user",
    after: {
      audioBytes: speech.audio.byteLength,
      estimatedSeconds: speech.estimatedSeconds,
      model: speech.model,
      provider: speech.provider,
      pronunciationEntryCount: pronunciationEntries.length,
      sourceMessageId,
      speed: speech.speed,
      textCharacters: input.length,
      voice: speech.voice,
    },
    entityId: uuidValue(sourceMessageId) ?? undefined,
    entityType: "assistant_message",
    metadata: {
      responseFormat: speech.responseFormat,
      source: "assistant.voice_reply",
    },
  });

  return {
    audio: speech.audio,
    contentType: speech.contentType,
    estimatedSeconds: speech.estimatedSeconds,
    model: speech.model,
    provider: speech.provider,
    speed: speech.speed,
    voice: speech.voice,
  };
}
