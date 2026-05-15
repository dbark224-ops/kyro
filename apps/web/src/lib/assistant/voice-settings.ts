import type { SupabaseClient } from "@supabase/supabase-js";

export const VOICE_SETTINGS_POLICY_TYPE = "assistant_voice";

export const VOICE_TTS_PROVIDERS = ["openai", "elevenlabs"] as const;
export type VoiceTtsProvider = (typeof VOICE_TTS_PROVIDERS)[number];

export type ElevenLabsVoicePreset = {
  accent: string;
  id: string;
  label: string;
  voiceId: string;
};

export const ELEVENLABS_VOICE_PRESETS = [
  {
    accent: "Australian",
    id: "australian_male",
    label: "Australian Male",
    voiceId: "WLKp2jV6nrS8aMkPPDRO",
  },
  {
    accent: "Australian",
    id: "australian_female",
    label: "Australian Female",
    voiceId: "56bWURjYFHyYyVf490Dp",
  },
  {
    accent: "Australian",
    id: "australian_male_2",
    label: "Australian Male 2",
    voiceId: "DYkrAHD8iwork3YSUBbs",
  },
  {
    accent: "British",
    id: "british_male_manchester",
    label: "British Male Manchester",
    voiceId: "c8MZcZcr0JnMAwkwnTIu",
  },
  {
    accent: "British",
    id: "british_male_1",
    label: "British Male 1",
    voiceId: "xYo5z1CSHgIA8XSPGcsR",
  },
  {
    accent: "British",
    id: "british_female_1",
    label: "British Female 1",
    voiceId: "rfkTsdZrVWEVhDycUYn9",
  },
  {
    accent: "British",
    id: "british_female_2",
    label: "British Female 2",
    voiceId: "lcMyyd2HUfFzxdCaC4Ta",
  },
  {
    accent: "American",
    id: "american_male_2",
    label: "American Male 2",
    voiceId: "c6SfcYrb2t09NHXiT80T",
  },
] as const satisfies ElevenLabsVoicePreset[];

export const DEFAULT_VOICE_TTS_PROVIDER: VoiceTtsProvider = "openai";
export const DEFAULT_ELEVENLABS_MODEL = "eleven_v3";
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
export const DEFAULT_ELEVENLABS_VOICE_PRESET_ID = "british_male_manchester";
export const DEFAULT_ELEVENLABS_STABILITY = 0.45;
export const DEFAULT_ELEVENLABS_SIMILARITY_BOOST = 0.85;
export const DEFAULT_ELEVENLABS_STYLE = 0;
export const DEFAULT_ELEVENLABS_USE_SPEAKER_BOOST = true;

export type VoiceSettings = {
  elevenLabsModel: string;
  elevenLabsOutputFormat: string;
  elevenLabsSimilarityBoost: number;
  elevenLabsStability: number;
  elevenLabsStyle: number;
  elevenLabsUseSpeakerBoost: boolean;
  elevenLabsVoiceId: string;
  elevenLabsVoicePresetId: string;
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

function providerValue(value: unknown, fallback: VoiceTtsProvider) {
  return value === "openai" || value === "elevenlabs" ? value : fallback;
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
  return providerValue(
    envValue("VOICE_TTS_PROVIDER") || envValue("TTS_PROVIDER"),
    DEFAULT_VOICE_TTS_PROVIDER,
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

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  const settings = objectRecord(value);
  const defaultPreset = defaultElevenLabsVoicePreset();
  const selectedPreset =
    findElevenLabsVoicePresetById(textValue(settings.elevenLabsVoicePresetId)) ??
    elevenLabsVoicePresetByVoiceId(textValue(settings.elevenLabsVoiceId)) ??
    defaultPreset;

  return {
    elevenLabsModel:
      textValue(envValue("ELEVENLABS_TTS_MODEL")) ??
      DEFAULT_ELEVENLABS_MODEL,
    elevenLabsOutputFormat:
      textValue(settings.elevenLabsOutputFormat) ??
      textValue(envValue("ELEVENLABS_TTS_OUTPUT_FORMAT")) ??
      DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    elevenLabsSimilarityBoost: clampUnit(
      settings.elevenLabsSimilarityBoost ?? envValue("ELEVENLABS_TTS_SIMILARITY_BOOST"),
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
      settings.elevenLabsUseSpeakerBoost ?? envValue("ELEVENLABS_TTS_USE_SPEAKER_BOOST"),
      DEFAULT_ELEVENLABS_USE_SPEAKER_BOOST,
    ),
    elevenLabsVoiceId: selectedPreset.voiceId,
    elevenLabsVoicePresetId: selectedPreset.id,
    provider: providerValue(settings.provider, defaultProvider()),
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
