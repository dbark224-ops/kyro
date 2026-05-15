import type { SupabaseClient } from "@supabase/supabase-js";

export const COMMUNICATION_POLICY_TYPE = "communication_outbound";

export const OUTBOUND_CHANNELS = ["email", "sms", "phone", "manual"] as const;
export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number];

export type SignatureVariant = "manual" | "ai_generated";

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
  manualSignature: EmailSignatureSettings;
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
  text: ""
};

export const DEFAULT_COMMUNICATION_SETTINGS: CommunicationSettings = {
  approvalRequired: true,
  allowedChannels: ["email", "sms", "manual"],
  aiGeneratedSignature: DEFAULT_EMAIL_SIGNATURE,
  businessSignature: "",
  defaultTone: "friendly_direct",
  dryRunOnly: true,
  manualSignature: DEFAULT_EMAIL_SIGNATURE,
  useSeparateAiSignature: false
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

function clampLogoWidth(value: unknown) {
  const parsed = numberValue(value) ?? DEFAULT_EMAIL_SIGNATURE.logoWidthPx;

  return Math.max(32, Math.min(240, Math.round(parsed)));
}

export function normalizeEmailSignatureSettings(
  value: unknown,
  fallback: Partial<EmailSignatureSettings> = {}
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
    logoSizeBytes:
      Math.max(
        0,
        numberValue(signature.logoSizeBytes ?? fallback.logoSizeBytes) ??
          DEFAULT_EMAIL_SIGNATURE.logoSizeBytes
      ),
    logoUrl: textValue(signature.logoUrl) ?? fallback.logoUrl ?? DEFAULT_EMAIL_SIGNATURE.logoUrl,
    logoWidthPx: clampLogoWidth(signature.logoWidthPx ?? fallback.logoWidthPx),
    text: textValue(signature.text) ?? fallback.text ?? DEFAULT_EMAIL_SIGNATURE.text
  };
}

export function isOutboundChannel(value: string): value is OutboundChannel {
  return OUTBOUND_CHANNELS.includes(value as OutboundChannel);
}

export function normalizeCommunicationSettings(value: unknown): CommunicationSettings {
  const settings = objectRecord(value);
  const allowedChannels = Array.isArray(settings.allowedChannels)
    ? settings.allowedChannels.filter(
        (channel): channel is OutboundChannel =>
          typeof channel === "string" && isOutboundChannel(channel)
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
        text: textValue(settings.businessSignature) ?? ""
      })
    ),
    businessSignature:
      textValue(objectRecord(settings.manualSignature).text) ??
      textValue(settings.businessSignature) ??
      "",
    defaultTone: textValue(settings.defaultTone) ?? DEFAULT_COMMUNICATION_SETTINGS.defaultTone,
    dryRunOnly: true,
    manualSignature: normalizeEmailSignatureSettings(settings.manualSignature, {
      text: textValue(settings.businessSignature) ?? ""
    }),
    useSeparateAiSignature:
      typeof settings.useSeparateAiSignature === "boolean"
        ? settings.useSeparateAiSignature
        : DEFAULT_COMMUNICATION_SETTINGS.useSeparateAiSignature
  };
}

export async function getCommunicationSettings(
  supabase: SupabaseClient,
  workspaceId: string
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
