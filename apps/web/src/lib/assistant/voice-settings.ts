import type { SupabaseClient } from "@supabase/supabase-js";

export const VOICE_SETTINGS_POLICY_TYPE = "assistant_voice";

export const VOICE_TTS_PROVIDERS = ["openai", "elevenlabs"] as const;
export type VoiceTtsProvider = (typeof VOICE_TTS_PROVIDERS)[number];

export const OPENAI_VOICE_OPTIONS = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;
export type OpenAiVoice = (typeof OPENAI_VOICE_OPTIONS)[number];

export const OUTBOUND_VOICE_PRONUNCIATION_POLICIES = [
  "strict",
  "balanced",
  "flexible",
  "off",
] as const;
export type OutboundVoicePronunciationPolicy =
  (typeof OUTBOUND_VOICE_PRONUNCIATION_POLICIES)[number];

export const PHONE_AGENT_DEMEANORS = [
  "friendly_direct",
  "polished_professional",
  "warm_conversational",
] as const;
export type PhoneAgentDemeanor = (typeof PHONE_AGENT_DEMEANORS)[number];

export const PHONE_AGENT_VERBOSITIES = ["concise", "balanced", "detailed"] as const;
export type PhoneAgentVerbosity = (typeof PHONE_AGENT_VERBOSITIES)[number];

export const PHONE_AGENT_HUMOUR_LEVELS = ["none", "light"] as const;
export type PhoneAgentHumourLevel = (typeof PHONE_AGENT_HUMOUR_LEVELS)[number];

export const PHONE_AGENT_ESCALATION_MODES = [
  "take_message",
  "request_callback",
  "urgent_interrupt",
] as const;
export type PhoneAgentEscalationMode =
  (typeof PHONE_AGENT_ESCALATION_MODES)[number];

export type ElevenLabsVoicePreset = {
  accent: string;
  id: string;
  label: string;
  voiceId: string;
};

export const ELEVENLABS_VOICE_PRESETS = [
  {
    accent: "Australian",
    id: "male_australian",
    label: "Male - Australian",
    voiceId: "DYkrAHD8iwork3YSUBbs",
  },
  {
    accent: "Australian",
    id: "female_australian",
    label: "Female - Australian",
    voiceId: "56bWURjYFHyYyVf490Dp",
  },
  {
    accent: "American",
    id: "female_usa",
    label: "Female - USA",
    voiceId: "DODLEQrClDo8wCz460ld",
  },
  {
    accent: "Italian",
    id: "male_italian",
    label: "Male - Italian",
    voiceId: "yowh82B72eMNrxcxHgBh",
  },
  {
    accent: "American",
    id: "male_usa_young_urban_african_american",
    label: "Male - USA - Young urban African American",
    voiceId: "YjlcD3XHztjJEo2wNszv",
  },
  {
    accent: "American",
    id: "male_usa_deep_calming",
    label: "Male - USA - Deep and calming",
    voiceId: "sB7vwSCyX0tQmU24cW2C",
  },
  {
    accent: "American",
    id: "male_usa_upbeat",
    label: "Male - USA - Upbeat",
    voiceId: "7EzWGsX10sAS4c9m9cPf",
  },
  {
    accent: "English",
    id: "male_english_deeper",
    label: "Male - English - Deeper",
    voiceId: "xYo5z1CSHgIA8XSPGcsR",
  },
  {
    accent: "English",
    id: "female_english",
    label: "Female - English",
    voiceId: "lcMyyd2HUfFzxdCaC4Ta",
  },
  {
    accent: "English",
    id: "male_english_upbeat",
    label: "Male - English - Upbeat",
    voiceId: "jRAAK67SEFE9m7ci5DhD",
  },
  {
    accent: "American",
    id: "male_usa_boston",
    label: "Male - USA (Boston)",
    voiceId: "UZvBfqEdvCFLqsBOo9Zr",
  },
  {
    accent: "Irish",
    id: "female_irish",
    label: "Female - Irish",
    voiceId: "sgk995upfe3tYLvoGcBN",
  },
  {
    accent: "Irish",
    id: "male_irish",
    label: "Male - Irish",
    voiceId: "hmMWXCj9K7N5mCPcRkfC",
  },
] as const satisfies ElevenLabsVoicePreset[];

export const DEFAULT_VOICE_TTS_PROVIDER: VoiceTtsProvider = "openai";
export const DEFAULT_OPENAI_VOICE: OpenAiVoice = "ballad";
export const DEFAULT_ELEVENLABS_MODEL = "eleven_v3";
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
export const DEFAULT_ELEVENLABS_VOICE_PRESET_ID = "female_australian";
export const DEFAULT_ELEVENLABS_STABILITY = 0.45;
export const DEFAULT_ELEVENLABS_SIMILARITY_BOOST = 0.85;
export const DEFAULT_ELEVENLABS_STYLE = 0;
export const DEFAULT_ELEVENLABS_USE_SPEAKER_BOOST = true;
const DEFAULT_VAPI_ELEVENLABS_MODEL = "eleven_v3";
const VAPI_ELEVENLABS_MODELS = [
  "eleven_v3",
  "eleven_multilingual_v2",
  "eleven_turbo_v2",
  "eleven_turbo_v2_5",
  "eleven_flash_v2",
  "eleven_flash_v2_5",
  "eleven_monolingual_v1",
] as const;
export const DEFAULT_OUTBOUND_VOICE_PRONUNCIATION_POLICY: OutboundVoicePronunciationPolicy =
  "balanced";
export const DEFAULT_PHONE_AGENT_DEMEANOR: PhoneAgentDemeanor =
  "friendly_direct";
export const DEFAULT_PHONE_AGENT_VERBOSITY: PhoneAgentVerbosity = "balanced";
export const DEFAULT_PHONE_AGENT_HUMOUR_LEVEL: PhoneAgentHumourLevel = "light";
export const DEFAULT_PHONE_AGENT_ESCALATION_MODE: PhoneAgentEscalationMode =
  "request_callback";

export type VoiceSettings = {
  elevenLabsModel: string;
  elevenLabsOutputFormat: string;
  elevenLabsSimilarityBoost: number;
  elevenLabsStability: number;
  elevenLabsStyle: number;
  elevenLabsUseSpeakerBoost: boolean;
  elevenLabsVoiceId: string;
  elevenLabsVoicePresetId: string;
  openAiVoice: OpenAiVoice;
  outboundVoicePronunciationPolicy: OutboundVoicePronunciationPolicy;
  phoneAgentEnabled: boolean;
  phoneAgentDemeanor: PhoneAgentDemeanor;
  phoneAgentEscalationMode: PhoneAgentEscalationMode;
  phoneAgentHumourLevel: PhoneAgentHumourLevel;
  phoneAgentInboundEnabled: boolean;
  phoneAgentOutboundEnabled: boolean;
  phoneAgentUserNumbers: string[];
  phoneAgentVerbosity: PhoneAgentVerbosity;
  phoneAgentVoicemailOverflowEnabled: boolean;
  vapiInternalAssistantId: string | null;
  vapiInboundAssistantId: string | null;
  vapiOutboundAssistantId: string | null;
  vapiPhoneNumberId: string | null;
  vapiVoicemailAssistantId: string | null;
  provider: VoiceTtsProvider;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function clampUnit(value: unknown, fallback: number) {
  const parsed = numberValue(value);

  if (parsed === null) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsed));
}

function openAiVoiceValue(value: unknown, fallback: OpenAiVoice) {
  return OPENAI_VOICE_OPTIONS.includes(value as OpenAiVoice)
    ? (value as OpenAiVoice)
    : fallback;
}

function outboundVoicePronunciationPolicyValue(
  value: unknown,
  fallback: OutboundVoicePronunciationPolicy,
) {
  return OUTBOUND_VOICE_PRONUNCIATION_POLICIES.includes(
    value as OutboundVoicePronunciationPolicy,
  )
    ? (value as OutboundVoicePronunciationPolicy)
    : fallback;
}

function enumValue<T extends readonly string[]>(
  options: T,
  value: unknown,
  fallback: T[number],
) {
  return options.includes(value as T[number]) ? (value as T[number]) : fallback;
}

function stringArrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => textValue(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function findElevenLabsVoicePresetById(value: string | null | undefined) {
  return ELEVENLABS_VOICE_PRESETS.find((preset) => preset.id === value);
}

export function elevenLabsVoicePresetById(value: string | null | undefined) {
  return (
    findElevenLabsVoicePresetById(value) ??
    findElevenLabsVoicePresetById(DEFAULT_ELEVENLABS_VOICE_PRESET_ID) ??
    ELEVENLABS_VOICE_PRESETS[0]
  );
}

function elevenLabsVoicePresetByVoiceId(value: string | null | undefined) {
  return ELEVENLABS_VOICE_PRESETS.find((preset) => preset.voiceId === value);
}

function defaultProvider() {
  return DEFAULT_VOICE_TTS_PROVIDER;
}

function defaultOpenAiVoice() {
  return openAiVoiceValue(
    envValue("OPENAI_REALTIME_VOICE") || envValue("OPENAI_TTS_VOICE"),
    DEFAULT_OPENAI_VOICE,
  );
}

function defaultElevenLabsVoicePreset() {
  const envPreset = elevenLabsVoicePresetById(
    envValue("ELEVENLABS_TTS_VOICE_PRESET_ID"),
  );
  const envVoicePreset = elevenLabsVoicePresetByVoiceId(
    envValue("ELEVENLABS_TTS_VOICE_ID") || envValue("ELEVENLABS_VOICE_ID"),
  );

  return envVoicePreset ?? envPreset;
}

function elevenLabsVapiModel(value: string) {
  return VAPI_ELEVENLABS_MODELS.includes(
    value as (typeof VAPI_ELEVENLABS_MODELS)[number],
  )
    ? value
    : DEFAULT_VAPI_ELEVENLABS_MODEL;
}

function vapiVoiceModelOverrideEnabled() {
  return booleanValue(envValue("VAPI_ENABLE_VOICE_MODEL_OVERRIDE"), false);
}

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  const settings = objectRecord(value);
  const defaultPreset = defaultElevenLabsVoicePreset();
  const selectedPreset =
    findElevenLabsVoicePresetById(
      textValue(settings.elevenLabsVoicePresetId),
    ) ??
    elevenLabsVoicePresetByVoiceId(textValue(settings.elevenLabsVoiceId)) ??
    defaultPreset;

  return {
    elevenLabsModel:
      textValue(envValue("ELEVENLABS_TTS_MODEL")) ?? DEFAULT_ELEVENLABS_MODEL,
    elevenLabsOutputFormat:
      textValue(settings.elevenLabsOutputFormat) ??
      textValue(envValue("ELEVENLABS_TTS_OUTPUT_FORMAT")) ??
      DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    elevenLabsSimilarityBoost: clampUnit(
      settings.elevenLabsSimilarityBoost ??
        envValue("ELEVENLABS_TTS_SIMILARITY_BOOST"),
      DEFAULT_ELEVENLABS_SIMILARITY_BOOST,
    ),
    elevenLabsStability: clampUnit(
      settings.elevenLabsStability ?? envValue("ELEVENLABS_TTS_STABILITY"),
      DEFAULT_ELEVENLABS_STABILITY,
    ),
    elevenLabsStyle: clampUnit(
      settings.elevenLabsStyle ?? envValue("ELEVENLABS_TTS_STYLE"),
      DEFAULT_ELEVENLABS_STYLE,
    ),
    elevenLabsUseSpeakerBoost: booleanValue(
      settings.elevenLabsUseSpeakerBoost ??
        envValue("ELEVENLABS_TTS_USE_SPEAKER_BOOST"),
      DEFAULT_ELEVENLABS_USE_SPEAKER_BOOST,
    ),
    elevenLabsVoiceId: selectedPreset.voiceId,
    elevenLabsVoicePresetId: selectedPreset.id,
    openAiVoice: openAiVoiceValue(settings.openAiVoice, defaultOpenAiVoice()),
    outboundVoicePronunciationPolicy: outboundVoicePronunciationPolicyValue(
      settings.outboundVoicePronunciationPolicy ??
        envValue("OUTBOUND_VOICE_PRONUNCIATION_POLICY"),
      DEFAULT_OUTBOUND_VOICE_PRONUNCIATION_POLICY,
    ),
    phoneAgentEnabled: booleanValue(settings.phoneAgentEnabled, false),
    phoneAgentDemeanor: enumValue(
      PHONE_AGENT_DEMEANORS,
      settings.phoneAgentDemeanor,
      DEFAULT_PHONE_AGENT_DEMEANOR,
    ),
    phoneAgentEscalationMode: enumValue(
      PHONE_AGENT_ESCALATION_MODES,
      settings.phoneAgentEscalationMode,
      DEFAULT_PHONE_AGENT_ESCALATION_MODE,
    ),
    phoneAgentHumourLevel: enumValue(
      PHONE_AGENT_HUMOUR_LEVELS,
      settings.phoneAgentHumourLevel,
      DEFAULT_PHONE_AGENT_HUMOUR_LEVEL,
    ),
    phoneAgentInboundEnabled: booleanValue(
      settings.phoneAgentInboundEnabled,
      true,
    ),
    phoneAgentOutboundEnabled: booleanValue(
      settings.phoneAgentOutboundEnabled,
      true,
    ),
    phoneAgentUserNumbers: stringArrayValue(settings.phoneAgentUserNumbers),
    phoneAgentVerbosity: enumValue(
      PHONE_AGENT_VERBOSITIES,
      settings.phoneAgentVerbosity,
      DEFAULT_PHONE_AGENT_VERBOSITY,
    ),
    phoneAgentVoicemailOverflowEnabled: booleanValue(
      settings.phoneAgentVoicemailOverflowEnabled,
      true,
    ),
    vapiInternalAssistantId:
      textValue(settings.vapiInternalAssistantId) ??
      textValue(envValue("VAPI_INTERNAL_ASSISTANT_ID")) ??
      textValue(envValue("VAPI_DEFAULT_ASSISTANT_ID")),
    vapiInboundAssistantId:
      textValue(settings.vapiInboundAssistantId) ??
      textValue(envValue("VAPI_INBOUND_ASSISTANT_ID")) ??
      textValue(envValue("VAPI_DEFAULT_ASSISTANT_ID")),
    vapiOutboundAssistantId:
      textValue(settings.vapiOutboundAssistantId) ??
      textValue(envValue("VAPI_OUTBOUND_ASSISTANT_ID")),
    vapiPhoneNumberId:
      textValue(settings.vapiPhoneNumberId) ??
      textValue(envValue("VAPI_PHONE_NUMBER_ID")),
    vapiVoicemailAssistantId:
      textValue(settings.vapiVoicemailAssistantId) ??
      textValue(envValue("VAPI_VOICEMAIL_OVERFLOW_ASSISTANT_ID")) ??
      textValue(envValue("VAPI_DEFAULT_ASSISTANT_ID")),
    provider: defaultProvider(),
  };
}

export async function getVoiceSettings(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("settings")
    .eq("workspace_id", workspaceId)
    .eq("policy_type", VOICE_SETTINGS_POLICY_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load voice settings: ${error.message}`);
  }

  return normalizeVoiceSettings(data?.settings);
}

export function elevenLabsVapiVoiceOverride(settings: VoiceSettings) {
  return {
    provider: "11labs",
    voiceId: settings.elevenLabsVoiceId,
    ...(vapiVoiceModelOverrideEnabled()
      ? { model: elevenLabsVapiModel(settings.elevenLabsModel) }
      : {}),
    stability: settings.elevenLabsStability,
    similarityBoost: settings.elevenLabsSimilarityBoost,
    style: settings.elevenLabsStyle,
    useSpeakerBoost: settings.elevenLabsUseSpeakerBoost,
    optimizeStreamingLatency: 3,
    speed: 1,
  };
}
