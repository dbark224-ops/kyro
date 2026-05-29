import type { SupabaseClient } from "@supabase/supabase-js";

export const COMMUNICATION_POLICY_TYPE = "communication_outbound";
export const DEFAULT_FOLLOW_UP_DELAY_DAYS = 2;
export const MIN_FOLLOW_UP_DELAY_DAYS = 1;
export const MAX_FOLLOW_UP_DELAY_DAYS = 30;

export const OUTBOUND_CHANNELS = ["email", "sms", "phone", "manual"] as const;
export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number];

export type SignatureVariant = "manual" | "ai_generated";
export const REPLY_MESSAGE_LENGTH_OPTIONS = [
  "short",
  "balanced",
  "detailed",
] as const;
export type ReplyMessageLength = (typeof REPLY_MESSAGE_LENGTH_OPTIONS)[number];

export type ReplyWritingSettings = {
  messageLength: ReplyMessageLength;
  reusableInstructions: string;
  signOff: string;
  tone: string;
  tradePhrasing: string;
  wordingStyle: string;
};

export type EmailSignatureSettings = {
  logoContentBase64: string;
  logoContentType: string;
  logoFilename: string;
  logoSizeBytes: number;
  logoUrl: string;
  logoWidthPx: number;
  text: string;
};

export type CommunicationSettings = {
  approvalRequired: boolean;
  allowedChannels: OutboundChannel[];
  aiGeneratedSignature: EmailSignatureSettings;
  defaultTone: string;
  followUpDelayDays: number;
  followUpRemindersEnabled: boolean;
  manualSignature: EmailSignatureSettings;
  replyWriting: ReplyWritingSettings;
  businessSignature: string;
  dryRunOnly: boolean;
  useSeparateAiSignature: boolean;
};

export const DEFAULT_EMAIL_SIGNATURE: EmailSignatureSettings = {
  logoContentBase64: "",
  logoContentType: "",
  logoFilename: "",
  logoSizeBytes: 0,
  logoUrl: "",
  logoWidthPx: 96,
  text: "",
};

export const DEFAULT_REPLY_WRITING_SETTINGS: ReplyWritingSettings = {
  messageLength: "balanced",
  reusableInstructions: "",
  signOff:
    "Use the saved email signature. Do not duplicate the signature text inside the reply body.",
  tone: "Friendly and direct",
  tradePhrasing:
    "Use practical trade/service language. Be specific about jobs, quotes, site visits, missing details, photos, timing, and next steps.",
  wordingStyle:
    "Plain English, concise, helpful, and natural. Avoid corporate fluff and over-explaining.",
};

export const DEFAULT_COMMUNICATION_SETTINGS: CommunicationSettings = {
  approvalRequired: true,
  allowedChannels: ["email", "sms", "manual"],
  aiGeneratedSignature: DEFAULT_EMAIL_SIGNATURE,
  businessSignature: "",
  defaultTone: "friendly_direct",
  dryRunOnly: true,
  followUpDelayDays: DEFAULT_FOLLOW_UP_DELAY_DAYS,
  followUpRemindersEnabled: true,
  manualSignature: DEFAULT_EMAIL_SIGNATURE,
  replyWriting: DEFAULT_REPLY_WRITING_SETTINGS,
  useSeparateAiSignature: false,
};

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

function cappedTextValue(value: unknown, fallback: string, maxLength = 1200) {
  const text = textValue(value);

  if (!text) {
    return fallback;
  }

  return text.slice(0, maxLength);
}

function legacyToneLabel(value: unknown) {
  const tone = textValue(value);

  if (!tone) {
    return DEFAULT_REPLY_WRITING_SETTINGS.tone;
  }

  if (tone === "friendly_direct") {
    return "Friendly and direct";
  }

  return tone
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clampLogoWidth(value: unknown) {
  const parsed = numberValue(value) ?? DEFAULT_EMAIL_SIGNATURE.logoWidthPx;

  return Math.max(32, Math.min(240, Math.round(parsed)));
}

export function normalizeFollowUpDelayDays(value: unknown) {
  const parsed = numberValue(value) ?? DEFAULT_FOLLOW_UP_DELAY_DAYS;

  return Math.max(
    MIN_FOLLOW_UP_DELAY_DAYS,
    Math.min(MAX_FOLLOW_UP_DELAY_DAYS, Math.round(parsed)),
  );
}

export function normalizeReplyMessageLength(
  value: unknown,
): ReplyMessageLength {
  return REPLY_MESSAGE_LENGTH_OPTIONS.includes(value as ReplyMessageLength)
    ? (value as ReplyMessageLength)
    : DEFAULT_REPLY_WRITING_SETTINGS.messageLength;
}

export function normalizeReplyWritingSettings(
  value: unknown,
  fallback: Partial<ReplyWritingSettings> = {},
): ReplyWritingSettings {
  const settings = objectRecord(value);

  return {
    messageLength: normalizeReplyMessageLength(
      settings.messageLength ?? fallback.messageLength,
    ),
    reusableInstructions: cappedTextValue(
      settings.reusableInstructions,
      fallback.reusableInstructions ??
        DEFAULT_REPLY_WRITING_SETTINGS.reusableInstructions,
      2400,
    ),
    signOff: cappedTextValue(
      settings.signOff,
      fallback.signOff ?? DEFAULT_REPLY_WRITING_SETTINGS.signOff,
    ),
    tone: cappedTextValue(
      settings.tone,
      fallback.tone ?? DEFAULT_REPLY_WRITING_SETTINGS.tone,
    ),
    tradePhrasing: cappedTextValue(
      settings.tradePhrasing,
      fallback.tradePhrasing ?? DEFAULT_REPLY_WRITING_SETTINGS.tradePhrasing,
      1800,
    ),
    wordingStyle: cappedTextValue(
      settings.wordingStyle,
      fallback.wordingStyle ?? DEFAULT_REPLY_WRITING_SETTINGS.wordingStyle,
      1800,
    ),
  };
}

export function normalizeEmailSignatureSettings(
  value: unknown,
  fallback: Partial<EmailSignatureSettings> = {},
): EmailSignatureSettings {
  const signature = objectRecord(value);

  return {
    logoContentBase64:
      textValue(signature.logoContentBase64) ??
      fallback.logoContentBase64 ??
      DEFAULT_EMAIL_SIGNATURE.logoContentBase64,
    logoContentType:
      textValue(signature.logoContentType) ??
      fallback.logoContentType ??
      DEFAULT_EMAIL_SIGNATURE.logoContentType,
    logoFilename:
      textValue(signature.logoFilename) ??
      fallback.logoFilename ??
      DEFAULT_EMAIL_SIGNATURE.logoFilename,
    logoSizeBytes: Math.max(
      0,
      numberValue(signature.logoSizeBytes ?? fallback.logoSizeBytes) ??
        DEFAULT_EMAIL_SIGNATURE.logoSizeBytes,
    ),
    logoUrl:
      textValue(signature.logoUrl) ??
      fallback.logoUrl ??
      DEFAULT_EMAIL_SIGNATURE.logoUrl,
    logoWidthPx: clampLogoWidth(signature.logoWidthPx ?? fallback.logoWidthPx),
    text:
      textValue(signature.text) ??
      fallback.text ??
      DEFAULT_EMAIL_SIGNATURE.text,
  };
}

export function isOutboundChannel(value: string): value is OutboundChannel {
  return OUTBOUND_CHANNELS.includes(value as OutboundChannel);
}

export function normalizeCommunicationSettings(
  value: unknown,
): CommunicationSettings {
  const settings = objectRecord(value);
  const allowedChannels = Array.isArray(settings.allowedChannels)
    ? settings.allowedChannels.filter(
        (channel): channel is OutboundChannel =>
          typeof channel === "string" && isOutboundChannel(channel),
      )
    : DEFAULT_COMMUNICATION_SETTINGS.allowedChannels;

  return {
    approvalRequired:
      typeof settings.approvalRequired === "boolean"
        ? settings.approvalRequired
        : DEFAULT_COMMUNICATION_SETTINGS.approvalRequired,
    allowedChannels: allowedChannels.length
      ? [...new Set(allowedChannels)]
      : DEFAULT_COMMUNICATION_SETTINGS.allowedChannels,
    aiGeneratedSignature: normalizeEmailSignatureSettings(
      settings.aiGeneratedSignature,
      normalizeEmailSignatureSettings(settings.manualSignature, {
        text: textValue(settings.businessSignature) ?? "",
      }),
    ),
    businessSignature:
      textValue(objectRecord(settings.manualSignature).text) ??
      textValue(settings.businessSignature) ??
      "",
    defaultTone:
      textValue(settings.defaultTone) ??
      DEFAULT_COMMUNICATION_SETTINGS.defaultTone,
    dryRunOnly: true,
    followUpDelayDays: normalizeFollowUpDelayDays(settings.followUpDelayDays),
    followUpRemindersEnabled:
      typeof settings.followUpRemindersEnabled === "boolean"
        ? settings.followUpRemindersEnabled
        : DEFAULT_COMMUNICATION_SETTINGS.followUpRemindersEnabled,
    manualSignature: normalizeEmailSignatureSettings(settings.manualSignature, {
      text: textValue(settings.businessSignature) ?? "",
    }),
    replyWriting: normalizeReplyWritingSettings(settings.replyWriting, {
      tone: legacyToneLabel(settings.defaultTone),
    }),
    useSeparateAiSignature:
      typeof settings.useSeparateAiSignature === "boolean"
        ? settings.useSeparateAiSignature
        : DEFAULT_COMMUNICATION_SETTINGS.useSeparateAiSignature,
  };
}

export function replyWritingPromptContext(settings: ReplyWritingSettings) {
  return {
    messageLength: settings.messageLength,
    reusableInstructions: settings.reusableInstructions,
    signOff: settings.signOff,
    tone: settings.tone,
    tradePhrasing: settings.tradePhrasing,
    wordingStyle: settings.wordingStyle,
  };
}

export function replyWritingPromptRules(settings: ReplyWritingSettings) {
  const rules = [
    `Tone: ${settings.tone}`,
    `Wording style: ${settings.wordingStyle}`,
    `Message length: ${settings.messageLength}`,
    `Sign-off: ${settings.signOff}`,
    `Trade-specific phrasing: ${settings.tradePhrasing}`,
  ];

  if (settings.reusableInstructions) {
    rules.push(`Reusable reply instructions: ${settings.reusableInstructions}`);
  }

  return rules;
}

export async function getCommunicationSettings(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("settings")
    .eq("workspace_id", workspaceId)
    .eq("policy_type", COMMUNICATION_POLICY_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load communication settings: ${error.message}`);
  }

  return normalizeCommunicationSettings(data?.settings);
}
