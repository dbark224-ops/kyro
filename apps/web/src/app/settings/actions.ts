"use server";

import {
  COMMUNICATION_POLICY_TYPE,
  DEFAULT_COMMUNICATION_SETTINGS,
  OUTBOUND_CHANNELS,
  isOutboundChannel,
  normalizeEmailSignatureSettings,
  type CommunicationSettings
} from "../../lib/communication/settings";
import {
  ELEVENLABS_VOICE_PRESETS,
  VOICE_SETTINGS_POLICY_TYPE,
  VOICE_TTS_PROVIDERS,
  elevenLabsVoicePresetById,
  normalizeVoiceSettings,
  type VoiceSettings,
  type VoiceTtsProvider,
} from "../../lib/assistant/voice-settings";
import { insertAuditLog } from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const MAX_SIGNATURE_LOGO_BYTES = 512 * 1024;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formChannels(formData: FormData) {
  return formData
    .getAll("allowedChannels")
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(isOutboundChannel);
}

function formBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function isUploadFile(value: FormDataEntryValue): value is File {
  if (typeof value !== "object" || !value) {
    return false;
  }

  const maybeFile = value as {
    arrayBuffer?: unknown;
    name?: unknown;
    size?: unknown;
    type?: unknown;
  };

  return (
    typeof maybeFile.arrayBuffer === "function" &&
    typeof maybeFile.name === "string" &&
    typeof maybeFile.size === "number"
  );
}

async function signatureLogoPayload(
  formData: FormData,
  prefix: "manualSignature" | "aiGeneratedSignature",
) {
  const upload = formData.get(`${prefix}LogoFile`);

  if (upload && isUploadFile(upload) && upload.name.trim() && upload.size > 0) {
    if (!upload.type.startsWith("image/")) {
      redirectWithSettingsMessage("engine_error", "Signature logos must be image files.");
    }

    if (upload.size > MAX_SIGNATURE_LOGO_BYTES) {
      redirectWithSettingsMessage("engine_error", "Signature logos are limited to 512 KB for now.");
    }

    return {
      logoContentBase64: Buffer.from(await upload.arrayBuffer()).toString("base64"),
      logoContentType: upload.type,
      logoFilename: upload.name,
      logoSizeBytes: upload.size,
    };
  }

  return {
    logoContentBase64: formString(formData, `${prefix}LogoContentBase64`),
    logoContentType: formString(formData, `${prefix}LogoContentType`),
    logoFilename: formString(formData, `${prefix}LogoFilename`),
    logoSizeBytes: formString(formData, `${prefix}LogoSizeBytes`),
  };
}

function redirectWithSectionMessage(
  section: "communication" | "voice",
  key: "engine_error" | "engine_message",
  message: string,
): never {
  redirect(`/settings?section=${section}&${key}=${encodeURIComponent(message)}`);
}

function redirectWithSettingsMessage(key: "engine_error" | "engine_message", message: string): never {
  redirectWithSectionMessage("communication", key, message);
}

export async function updateCommunicationSettingsAction(formData: FormData) {
  const approvalMode = formString(formData, "approvalMode");
  const defaultTone = formString(formData, "defaultTone");
  const allowedChannels = [...new Set(formChannels(formData))];
  const manualLogo = await signatureLogoPayload(formData, "manualSignature");
  const aiLogo = await signatureLogoPayload(formData, "aiGeneratedSignature");
  const manualSignature = normalizeEmailSignatureSettings({
    ...manualLogo,
    logoUrl: formString(formData, "manualSignatureLogoUrl"),
    logoWidthPx: formString(formData, "manualSignatureLogoWidthPx"),
    text: formString(formData, "manualSignatureText"),
  });
  const duplicateManualSignature = formBoolean(formData, "duplicateManualSignature");
  const aiGeneratedSignature = duplicateManualSignature
    ? manualSignature
    : normalizeEmailSignatureSettings({
        ...aiLogo,
        logoUrl: formString(formData, "aiGeneratedSignatureLogoUrl"),
        logoWidthPx: formString(formData, "aiGeneratedSignatureLogoWidthPx"),
        text: formString(formData, "aiGeneratedSignatureText"),
      });

  if (!["approval_required", "auto_dry_run"].includes(approvalMode)) {
    redirectWithSettingsMessage("engine_error", "Outbound approval mode is invalid.");
  }

  if (allowedChannels.length === 0) {
    redirectWithSettingsMessage("engine_error", "Select at least one outbound channel.");
  }

  const unsupportedChannel = allowedChannels.find((channel) => !OUTBOUND_CHANNELS.includes(channel));

  if (unsupportedChannel) {
    redirectWithSettingsMessage("engine_error", `${unsupportedChannel} is not a supported channel.`);
  }

  const settings: CommunicationSettings = {
    approvalRequired: approvalMode === "approval_required",
    aiGeneratedSignature,
    allowedChannels,
    businessSignature: manualSignature.text,
    defaultTone: defaultTone || DEFAULT_COMMUNICATION_SETTINGS.defaultTone,
    dryRunOnly: true,
    manualSignature,
    useSeparateAiSignature: formBoolean(formData, "useSeparateAiSignature"),
  };

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", COMMUNICATION_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithSettingsMessage("engine_error", beforeError.message);
  }

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        workspace_id: workspace.id,
        policy_type: COMMUNICATION_POLICY_TYPE,
        settings
      },
      {
        onConflict: "workspace_id,policy_type"
      }
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithSettingsMessage(
      "engine_error",
      saveError?.message ?? "Unable to save communication settings."
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "communication_settings.updated",
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    after: { settings }
  });

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirectWithSettingsMessage("engine_message", "Communication settings saved.");
}

export async function updateVoiceSettingsAction(formData: FormData) {
  const provider = formString(formData, "voiceProvider") as VoiceTtsProvider;

  if (!VOICE_TTS_PROVIDERS.includes(provider)) {
    redirectWithSectionMessage("voice", "engine_error", "Voice provider is invalid.");
  }

  const requestedPresetId = formString(formData, "elevenLabsVoicePresetId");
  const requestedPreset =
    ELEVENLABS_VOICE_PRESETS.find((preset) => preset.id === requestedPresetId) ??
    elevenLabsVoicePresetById(requestedPresetId);
  const settings: VoiceSettings = normalizeVoiceSettings({
    elevenLabsOutputFormat: formString(formData, "elevenLabsOutputFormat"),
    elevenLabsSimilarityBoost: formString(formData, "elevenLabsSimilarityBoost"),
    elevenLabsStability: formString(formData, "elevenLabsStability"),
    elevenLabsStyle: formString(formData, "elevenLabsStyle"),
    elevenLabsUseSpeakerBoost: formBoolean(formData, "elevenLabsUseSpeakerBoost"),
    elevenLabsVoiceId: requestedPreset.voiceId,
    elevenLabsVoicePresetId: requestedPreset.id,
    provider,
  });

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", VOICE_SETTINGS_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithSectionMessage("voice", "engine_error", beforeError.message);
  }

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: VOICE_SETTINGS_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      saveError?.message ?? "Unable to save voice assistant settings.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "assistant_voice_settings.updated",
    actorId: user.id,
    actorType: "user",
    after: { settings },
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    entityId: String(savedPolicy.id),
    entityType: "workspace_policy",
  });

  revalidatePath("/settings");
  revalidatePath("/voice");
  redirectWithSectionMessage("voice", "engine_message", "Voice assistant settings saved.");
}
