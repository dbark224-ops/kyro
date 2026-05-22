import { createUsageEvent } from "@kyro/api";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  getActivePronunciationEntries,
  pronunciationGuideText,
  type AssistantPronunciationEntry,
} from "./pronunciation";

const DEFAULT_STT_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_MARKUP_RATE = 0.25;
const DEFAULT_STT_PROMPT =
  "This audio is a voice note inside Kyro, an AI assistant for a trades CRM. The assistant is named Kyro, pronounced like Cairo. When the speaker addresses the assistant, transcribe variants such as Cairo, Kiro, Kyra, Cara, Kara, or Chiro as Kyro. Common product words include CRM, quote, invoice, inbox, lead, customer, tradie, Gmail, Outlook, Supabase, and Ollama.";
const DEFAULT_UNIT_COSTS_PER_MINUTE: Record<string, number> = {
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-4o-transcribe": 0.006,
  "gpt-4o-transcribe-diarize": 0.006,
  "whisper-1": 0.006,
};

type WorkspaceInput = {
  id: string;
};

type TranscribeAudioInput = {
  audioFile: File;
  durationMs: number | null;
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceInput;
};

export type TranscribeAudioResult = {
  durationMinutes: number;
  model: string;
  provider: "openai";
  text: string;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function sttModel() {
  return envValue("OPENAI_STT_MODEL") || DEFAULT_STT_MODEL;
}

function sttMarkupRate() {
  const parsed = Number(envValue("OPENAI_STT_MARKUP_RATE"));

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MARKUP_RATE;
}

function sttPrompt(entries: AssistantPronunciationEntry[]) {
  const basePrompt = envValue("OPENAI_STT_PROMPT") || DEFAULT_STT_PROMPT;
  const guide = pronunciationGuideText(entries);

  return guide
    ? [
        basePrompt,
        "Workspace pronunciation vocabulary. Prefer these spellings and terms when the audio is ambiguous:",
        guide,
      ].join("\n\n")
    : basePrompt;
}

function sttUnitCostPerMinute(model: string) {
  const parsed = Number(envValue("OPENAI_STT_UNIT_COST_PER_MINUTE_USD"));

  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return DEFAULT_UNIT_COSTS_PER_MINUTE[model] ?? 0;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeKyroAssistantName(transcript: string) {
  const variant = "(?:cairo|kiro|kyro|kyra|cara|kara|chiro|caira)";

  return transcript
    .replace(
      new RegExp(
        `\\b(hey|hi|hello|yo|okay|ok|thanks|thank you|dear)\\s+${variant}\\b`,
        "gi",
      ),
      (_match, prefix: string) => `${prefix} Kyro`,
    )
    .replace(new RegExp(`^\\s*${variant}\\b`, "i"), "Kyro")
    .replace(new RegExp(`\\b${variant}\\s*,`, "gi"), "Kyro,");
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

function durationMinutesForBilling(durationMs: number | null) {
  if (!durationMs || durationMs <= 0) {
    return 0;
  }

  return Number((durationMs / 60_000).toFixed(6));
}

function toUsageEventRow(input: {
  costSnapshot: number;
  customerChargeSnapshot: number;
  markupSnapshot: number;
  model: string;
  quantity: number;
  unitCostSnapshot: number;
  userId: string;
  workspaceId: string;
}) {
  const event = createUsageEvent({
    costSnapshot: input.costSnapshot,
    currency: "USD",
    customerChargeSnapshot: input.customerChargeSnapshot,
    markupSnapshot: input.markupSnapshot,
    model: input.model,
    provider: "openai",
    quantity: input.quantity,
    service: "speech_to_text",
    unit: "minute",
    unitCostSnapshot: input.unitCostSnapshot,
    usageType: "speech_to_text_minutes",
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
      source: "assistant.voice_input",
    },
    model: event.model ?? null,
    provider: event.provider,
    quantity: String(event.quantity),
    service: event.service,
    source_id: event.sourceId ?? null,
    source_type: event.sourceType ?? "assistant_voice_input",
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

export async function transcribeAssistantAudio({
  audioFile,
  durationMs,
  supabase,
  user,
  workspace,
}: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  const apiKey = openAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for speech-to-text.");
  }

  const model = sttModel();
  const pronunciationEntries = await getActivePronunciationEntries(
    supabase,
    workspace.id,
  );
  const body = new FormData();

  body.set("file", audioFile, audioFile.name || "kyro-voice.webm");
  body.set("model", model);
  body.set("response_format", "json");

  if (!model.includes("diarize")) {
    body.set("prompt", sttPrompt(pronunciationEntries));
  }

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      body,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      method: "POST",
    },
  );

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(
      openAiErrorMessage(payload) ??
        `OpenAI transcription failed with HTTP ${response.status}.`,
    );
  }

  const rawText = textValue(
    payload && typeof payload === "object" && "text" in payload
      ? payload.text
      : null,
  );

  if (!rawText) {
    throw new Error("OpenAI returned an empty transcription.");
  }

  const text = normalizeKyroAssistantName(rawText);
  const durationMinutes = durationMinutesForBilling(durationMs);
  const unitCost = sttUnitCostPerMinute(model);
  const markup = sttMarkupRate();
  const cost = Number((durationMinutes * unitCost).toFixed(8));
  const customerCharge = Number((cost * (1 + markup)).toFixed(8));

  const { error: usageError } = await supabase.from("usage_events").insert(
    toUsageEventRow({
      costSnapshot: cost,
      customerChargeSnapshot: customerCharge,
      markupSnapshot: markup,
      model,
      quantity: durationMinutes,
      unitCostSnapshot: unitCost,
      userId: user.id,
      workspaceId: workspace.id,
    }),
  );

  if (usageError) {
    throw new Error(
      `Unable to record speech-to-text usage: ${usageError.message}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "assistant.voice_transcribed",
    actorId: user.id,
    actorType: "user",
    after: {
      audioBytes: audioFile.size,
      durationMinutes,
      model,
      normalizedAssistantName: text !== rawText,
      promptProfile: "kyro_assistant_voice",
      pronunciationEntryCount: pronunciationEntries.length,
      provider: "openai",
      transcriptCharacters: text.length,
    },
    entityType: "assistant_voice_input",
    metadata: {
      fileType: audioFile.type,
      source: "assistant.composer",
    },
  });

  return {
    durationMinutes,
    model,
    provider: "openai",
    text,
  };
}
