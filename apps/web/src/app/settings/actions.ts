"use server";

import {
  COMMUNICATION_POLICY_TYPE,
  DEFAULT_COMMUNICATION_SETTINGS,
  OUTBOUND_CHANNELS,
  isOutboundChannel,
  normalizeCommunicationSettings,
  normalizeEmailSignatureSettings,
  normalizeFollowUpDelayDays,
  normalizeReplyWritingSettings,
  type CommunicationSettings,
} from "../../lib/communication/settings";
import {
  ELEVENLABS_VOICE_PRESETS,
  OPENAI_VOICE_OPTIONS,
  OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
  PHONE_AGENT_DEMEANORS,
  PHONE_AGENT_ESCALATION_MODES,
  PHONE_AGENT_HUMOUR_LEVELS,
  PHONE_AGENT_VERBOSITIES,
  VOICE_SETTINGS_POLICY_TYPE,
  getVoiceSettings,
  normalizeVoiceSettings,
  type OpenAiVoice,
  type OutboundVoicePronunciationPolicy,
  type VoiceSettings,
} from "../../lib/assistant/voice-settings";
import {
  PRONUNCIATION_CATEGORIES,
  PRONUNCIATION_STATUSES,
  defaultPronunciationHint,
  pronunciationCategoryValue,
  pronunciationStatusValue,
  splitPronunciationAliases,
  updatePronunciationEntry,
  upsertPronunciationEntry,
  type PronunciationStatus,
} from "../../lib/assistant/pronunciation";
import { insertAuditLog } from "../../lib/engine/event-action-audit";
import {
  DISPLAY_CURRENCIES,
  normalizeDisplayCurrency,
} from "../../lib/billing/display-currency";
import {
  DEFAULT_INBOUND_EMAIL_SETTINGS,
  INBOUND_EMAIL_POLICY_TYPE,
  INBOUND_EMAIL_POLL_INTERVALS,
  INBOUND_EMAIL_SENDER_RULE_ACTIONS,
  INBOUND_EMAIL_SYNC_MODES,
  normalizeInboundEmailSettings,
  removeInboundEmailSenderRule,
  senderRuleTargetFromInput,
  upsertInboundEmailSenderRule,
  type InboundEmailSettings,
  type InboundEmailSenderRule,
  type InboundEmailSenderRuleAction,
} from "../../lib/integrations/inbound-email-settings";
import { syncInboundEmail } from "../../lib/integrations/inbound-email-sync";
import { GOOGLE_PROVIDER, GOOGLE_SERVICE } from "../../lib/integrations/google";
import {
  MICROSOFT_PROVIDER,
  MICROSOFT_SERVICE,
} from "../../lib/integrations/microsoft";
import {
  DEFAULT_PHONE_REGION,
  normalizePhoneRegion,
  PHONE_REGION_OPTIONS,
} from "../../lib/crm/identity";
import {
  WORKSPACE_GENERAL_POLICY_TYPE,
  getWorkspaceGeneralSettings,
  normalizeWorkspaceBusinessProfileSettings,
  normalizeWorkspaceGeneralSettings,
} from "../../lib/workspace/general-settings";
import {
  isOperatingCountry,
  operatingCountryPhoneRegion,
} from "../../lib/workspace/operating-countries";
import { createStripeConnectOnboardingLink } from "../../lib/payments/accounts";
import {
  createKyroUserBillingPortalUrl,
  createKyroUserBillingSetupUrl,
} from "../../lib/billing/kyro-user-billing";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { createServiceSupabaseClient } from "../../lib/supabase/service";
import {
  assignWorkspacePhoneNumberFromPool,
  ensureWorkspacePhoneNumberFromPool,
  getWorkspaceAssignedPhoneNumbers,
  releaseWorkspacePhoneNumberToPool,
  type WorkspacePhoneNumberPoolRow,
} from "../../lib/voice/phone-number-pool";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const MAX_SIGNATURE_LOGO_BYTES = 512 * 1024;

type TutorialSupabaseClient = {
  from(table: "workspace_tutorial_state"): {
    upsert(
      values: Record<string, unknown>,
      options: { onConflict: string },
    ): Promise<{ error: { message: string } | null }>;
  };
};

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

function phoneNumberMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function voicemailOverflowMetadata(
  metadata: Record<string, unknown>,
  userId: string,
) {
  return {
    ...metadata,
    voicePurpose: "voicemail_overflow",
    voicemailOverflowEnabledAt: new Date().toISOString(),
    voicemailOverflowEnabledBy: userId,
  };
}

function clearVoicemailOverflowMetadata(metadata: Record<string, unknown>) {
  const next = { ...metadata };

  if (next.voicePurpose === "voicemail_overflow") {
    delete next.voicePurpose;
  }

  if (next.purpose === "voicemail_overflow") {
    delete next.purpose;
  }

  delete next.voicemailOverflowEnabledAt;
  delete next.voicemailOverflowEnabledBy;

  return next;
}

function numberHasVoicemailOverflowPurpose(number: WorkspacePhoneNumberPoolRow) {
  const purpose =
    number.metadata.voicePurpose ?? number.metadata.purpose ?? null;

  return purpose === "voicemail_overflow";
}

function formStringList(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? value.trim() : ""));
}

function phoneAgentUserNumberDetailsFromForm(formData: FormData) {
  const phones = formStringList(formData, "phoneAgentTeamPhone");
  const names = formStringList(formData, "phoneAgentTeamName");
  const roles = formStringList(formData, "phoneAgentTeamRole");

  return phones
    .map((phoneNumber, index) => ({
      name: names[index] || null,
      phoneNumber,
      role: roles[index] || null,
    }))
    .filter((row) => row.phoneNumber);
}

function workplaceContactsFromForm(formData: FormData) {
  const ids = formStringList(formData, "workplaceContactId");
  const names = formStringList(formData, "workplaceContactName");
  const roles = formStringList(formData, "workplaceContactRole");
  const phones = formStringList(formData, "workplaceContactPhone");
  const privatePhones = formStringList(formData, "workplaceContactPrivatePhone");
  const emails = formStringList(formData, "workplaceContactEmail");
  const specialties = formStringList(formData, "workplaceContactSpecialty");
  const activeDays = formStringList(formData, "workplaceContactActiveDays");
  const workingHours = formStringList(formData, "workplaceContactWorkingHours");
  const vehicleRegistrations = formStringList(
    formData,
    "workplaceContactVehicleRegistration",
  );
  const notes = formStringList(formData, "workplaceContactNotes");
  const receivesEscalations = formStringList(
    formData,
    "workplaceContactReceivesEscalations",
  );
  const preferredChannels = formStringList(
    formData,
    "workplaceContactPreferredChannel",
  );

  return ids
    .map((id, index) => ({
      activeDays: activeDays[index] || "",
      email: emails[index] || "",
      id: id || `contact-${index + 1}`,
      name: names[index] || "",
      notes: notes[index] || "",
      phoneNumber: phones[index] || "",
      preferredChannel: preferredChannels[index] || "sms",
      privatePhoneNumber: privatePhones[index] || "",
      receivesEscalations: receivesEscalations[index] !== "false",
      role: roles[index] || "",
      tradeSpecialty: specialties[index] || "",
      vehicleRegistration: vehicleRegistrations[index] || "",
      workingHours: workingHours[index] || "",
    }))
    .filter(
      (contact) =>
        contact.name ||
        contact.phoneNumber ||
        contact.email ||
        contact.role ||
        contact.tradeSpecialty,
    );
}

function urgentEscalationStepsFromForm(formData: FormData) {
  const ids = formStringList(formData, "urgentEscalationStepId");
  const channels = formStringList(formData, "urgentEscalationStepChannel");
  const contactIds = formStringList(formData, "urgentEscalationStepContactId");
  const delays = formStringList(formData, "urgentEscalationStepDelayMinutes");

  return ids
    .map((id, index) => ({
      channel: channels[index] || "sms",
      contactId: contactIds[index] || "primary",
      delayMinutes: delays[index] || "0",
      id: id || `step-${index + 1}`,
    }))
    .filter((step) => step.channel && step.contactId);
}

function formInteger(formData: FormData, key: string) {
  const parsed = Number(formString(formData, key));

  return Number.isFinite(parsed) ? parsed : null;
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

async function imagePayload(
  formData: FormData,
  prefix: string,
  section: "general" | "integrations" | "voice",
  label: string,
) {
  const upload = formData.get(`${prefix}LogoFile`);

  if (upload && isUploadFile(upload) && upload.name.trim() && upload.size > 0) {
    if (!upload.type.startsWith("image/")) {
      redirectWithSectionMessage(
        section,
        "engine_error",
        `${label} must be image files.`,
      );
    }

    if (upload.size > MAX_SIGNATURE_LOGO_BYTES) {
      redirectWithSectionMessage(
        section,
        "engine_error",
        `${label} are limited to 512 KB for now.`,
      );
    }

    return {
      logoContentBase64: Buffer.from(await upload.arrayBuffer()).toString(
        "base64",
      ),
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

async function signatureLogoPayload(
  formData: FormData,
  prefix: "manualSignature" | "aiGeneratedSignature",
  section: "general" | "integrations" = "integrations",
) {
  return imagePayload(formData, prefix, section, "Signature logos");
}

async function businessLogoPayload(formData: FormData) {
  return imagePayload(formData, "businessProfile", "general", "Business logos");
}

function redirectWithSectionMessage(
  section: "general" | "integrations" | "voice" | "developer",
  key: "engine_error" | "engine_message",
  message: string,
  options: { focus?: string; panel?: string; senderRules?: boolean } = {},
): never {
  const params = new URLSearchParams({ section, [key]: message });

  if (options.focus) {
    params.set("focus", options.focus);
  }

  if (options.panel) {
    params.set("panel", options.panel);
  }

  if (options.senderRules) {
    params.set("senderRules", "1");
  }

  redirect(`/settings?${params.toString()}`);
}

function redirectWithSettingsMessage(
  key: "engine_error" | "engine_message",
  message: string,
  focus?: string | null,
): never {
  redirectWithSectionMessage("integrations", key, message, {
    ...(focus ? { focus } : {}),
    panel: "outbound",
  });
}

function integrationService(provider: string) {
  if (provider === GOOGLE_PROVIDER) {
    return GOOGLE_SERVICE;
  }

  if (provider === MICROSOFT_PROVIDER) {
    return MICROSOFT_SERVICE;
  }

  return null;
}

function integrationLabel(provider: string) {
  return provider === MICROSOFT_PROVIDER
    ? "Microsoft Outlook"
    : "Google Workspace";
}

function formSenderRuleMatch(
  value: string,
): InboundEmailSenderRule["match"] | null {
  return value === "email" || value === "domain" ? value : null;
}

function formSenderRuleActionValue(
  value: string,
): InboundEmailSenderRuleAction | null {
  return INBOUND_EMAIL_SENDER_RULE_ACTIONS.includes(
    value as InboundEmailSenderRuleAction,
  )
    ? (value as InboundEmailSenderRuleAction)
    : null;
}

function senderRuleActionLabel(action: InboundEmailSenderRuleAction) {
  return action === "always_promote" ? "relevant" : "ignored";
}

async function saveInboundEmailPolicyUpdate({
  action,
  afterSettings,
  beforePolicy,
  beforeSettings,
  metadata,
  supabase,
  userId,
  workspaceId,
}: {
  action: string;
  afterSettings: InboundEmailSettings;
  beforePolicy: { id?: string; settings?: unknown } | null;
  beforeSettings: InboundEmailSettings;
  metadata?: Record<string, unknown>;
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"];
  userId: string;
  workspaceId: string;
}) {
  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        workspace_id: workspaceId,
        policy_type: INBOUND_EMAIL_POLICY_TYPE,
        settings: afterSettings,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      saveError?.message ?? "Unable to save inbound email settings.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action,
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: beforePolicy ? { settings: beforeSettings } : null,
    after: { settings: afterSettings },
    metadata,
  });

  return savedPolicy;
}

export async function updateCommunicationSettingsAction(formData: FormData) {
  const settingsFocusRaw = formString(formData, "settingsFocus");
  const settingsFocus =
    settingsFocusRaw === "email-signatures" ||
    settingsFocusRaw === "outbound-writing"
      ? settingsFocusRaw
      : null;
  const approvalMode = formString(formData, "approvalMode");
  const defaultTone = formString(formData, "defaultTone");
  const allowedChannels = [...new Set(formChannels(formData))];
  const replyWriting = normalizeReplyWritingSettings({
    messageLength: formString(formData, "replyMessageLength"),
    reusableInstructions: formString(formData, "replyReusableInstructions"),
    signOff: formString(formData, "replySignOff"),
    tone: formString(formData, "replyTone"),
    tradePhrasing: formString(formData, "replyTradePhrasing"),
    wordingStyle: formString(formData, "replyWordingStyle"),
  });
  const followUpDelayDays = normalizeFollowUpDelayDays(
    formInteger(formData, "followUpDelayDays"),
  );
  const manualLogo = await signatureLogoPayload(formData, "manualSignature");
  const aiLogo = await signatureLogoPayload(formData, "aiGeneratedSignature");
  const manualSignature = normalizeEmailSignatureSettings({
    ...manualLogo,
    logoUrl: formString(formData, "manualSignatureLogoUrl"),
    logoWidthPx: formString(formData, "manualSignatureLogoWidthPx"),
    text: formString(formData, "manualSignatureText"),
  });
  const duplicateManualSignature = formBoolean(
    formData,
    "duplicateManualSignature",
  );
  const aiGeneratedSignature = duplicateManualSignature
    ? manualSignature
    : normalizeEmailSignatureSettings({
        ...aiLogo,
        logoUrl: formString(formData, "aiGeneratedSignatureLogoUrl"),
        logoWidthPx: formString(formData, "aiGeneratedSignatureLogoWidthPx"),
        text: formString(formData, "aiGeneratedSignatureText"),
      });

  if (!["approval_required", "auto_dry_run"].includes(approvalMode)) {
    redirectWithSettingsMessage(
      "engine_error",
      "Outbound approval mode is invalid.",
      settingsFocus,
    );
  }

  if (allowedChannels.length === 0) {
    redirectWithSettingsMessage(
      "engine_error",
      "Select at least one outbound channel.",
      settingsFocus,
    );
  }

  const unsupportedChannel = allowedChannels.find(
    (channel) => !OUTBOUND_CHANNELS.includes(channel),
  );

  if (unsupportedChannel) {
    redirectWithSettingsMessage(
      "engine_error",
      `${unsupportedChannel} is not a supported channel.`,
      settingsFocus,
    );
  }

  const settings: CommunicationSettings = {
    approvalRequired: approvalMode === "approval_required",
    aiGeneratedSignature,
    allowedChannels,
    businessSignature: manualSignature.text,
    defaultTone:
      replyWriting.tone || defaultTone || DEFAULT_COMMUNICATION_SETTINGS.defaultTone,
    dryRunOnly: true,
    followUpDelayDays,
    followUpRemindersEnabled: formBoolean(formData, "followUpRemindersEnabled"),
    manualSignature,
    replyWriting,
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
    redirectWithSettingsMessage(
      "engine_error",
      beforeError.message,
      settingsFocus,
    );
  }

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        workspace_id: workspace.id,
        policy_type: COMMUNICATION_POLICY_TYPE,
        settings,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithSettingsMessage(
      "engine_error",
      saveError?.message ?? "Unable to save communication settings.",
      settingsFocus,
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
    after: { settings },
  });

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirectWithSettingsMessage(
    "engine_message",
    "Communication settings saved.",
    settingsFocus,
  );
}

function assertValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
  } catch {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      "Enter a valid IANA timezone such as Australia/Brisbane or America/Denver.",
    );
  }
}

export async function updateGeneralSettingsAction(formData: FormData) {
  const timeZone = formString(formData, "workspaceTimeZone");
  const defaultPhoneRegion = normalizePhoneRegion(
    formString(formData, "workspaceDefaultPhoneRegion"),
  );
  const displayCurrency = normalizeDisplayCurrency(
    formString(formData, "workspaceDisplayCurrency"),
  );
  const operatingCountry = formString(formData, "businessOperatingCountry");
  const businessLogo = await businessLogoPayload(formData);
  const manualLogo = await signatureLogoPayload(
    formData,
    "manualSignature",
    "general",
  );

  if (!timeZone) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      "Add a workspace timezone first.",
    );
  }

  assertValidTimeZone(timeZone);

  if (!DISPLAY_CURRENCIES.includes(displayCurrency)) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      "Choose a supported display currency.",
    );
  }

  if (
    !PHONE_REGION_OPTIONS.some((option) => option.value === defaultPhoneRegion)
  ) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      `Choose a supported phone region such as ${DEFAULT_PHONE_REGION}.`,
    );
  }

  if (!isOperatingCountry(operatingCountry)) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      "Choose the country this workspace operates in.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const [
    beforeGeneralResult,
    beforeInboundResult,
    beforeCommunicationResult,
  ] = await Promise.all([
    supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", WORKSPACE_GENERAL_POLICY_TYPE)
      .maybeSingle(),
    supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
      .maybeSingle(),
    supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", COMMUNICATION_POLICY_TYPE)
      .maybeSingle(),
  ]);

  if (beforeGeneralResult.error) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      beforeGeneralResult.error.message,
    );
  }

  if (beforeInboundResult.error) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      beforeInboundResult.error.message,
    );
  }

  if (beforeCommunicationResult.error) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      beforeCommunicationResult.error.message,
    );
  }

  const beforeInboundSettings = normalizeInboundEmailSettings(
    beforeInboundResult.data?.settings,
  );
  const beforeGeneralSettings = normalizeWorkspaceGeneralSettings(
    beforeGeneralResult.data?.settings,
    { timeZone: beforeInboundSettings.timeZone },
  );
  const beforeCommunicationSettings = normalizeCommunicationSettings(
    beforeCommunicationResult.data?.settings,
  );
  const businessProfile = normalizeWorkspaceBusinessProfileSettings(
    {
      ...beforeGeneralSettings.businessProfile,
      ...businessLogo,
      brandAccentColor: formString(formData, "businessBrandAccentColor"),
      brandPrimaryColor: formString(formData, "businessBrandPrimaryColor"),
      brandStyle: formString(formData, "businessBrandStyle"),
      businessAddress: formString(formData, "businessAddress"),
      businessName: formString(formData, "businessName"),
      contactHours: formString(formData, "businessContactHours"),
      emergencyAfterHoursRate: formString(
        formData,
        "businessEmergencyAfterHoursRate",
      ),
      emergencyAvailabilityMode: formString(
        formData,
        "businessEmergencyAvailabilityMode",
      ),
      emergencyDays: formString(formData, "businessEmergencyDays"),
      emergencyEndTime: formString(formData, "businessEmergencyEndTime"),
      emergencyJobsEnabled: formBoolean(formData, "businessEmergencyJobsEnabled"),
      emergencyRateNotes: formString(formData, "businessEmergencyRateNotes"),
      emergencyStartTime: formString(formData, "businessEmergencyStartTime"),
      industry: formString(formData, "businessIndustry"),
      logoUrl: formString(formData, "businessProfileLogoUrl"),
      logoWidthPx: formString(formData, "businessProfileLogoWidthPx"),
      operatingCountry,
      publicEmail: formString(formData, "businessPublicEmail"),
      publicPhoneNumber: formString(formData, "businessPublicPhoneNumber"),
      serviceArea: formString(formData, "businessServiceArea"),
      servicePostcodes: formString(formData, "businessServicePostcodes"),
      serviceSuburbs: formString(formData, "businessServiceSuburbs"),
      staffCount: formString(formData, "businessStaffCount"),
      travelRadiusKm: formString(formData, "businessTravelRadiusKm"),
      urgentEscalation: {
        customDays: formString(formData, "urgentEscalationCustomDays"),
        customEndTime: formString(formData, "urgentEscalationCustomEndTime"),
        customStartTime: formString(formData, "urgentEscalationCustomStartTime"),
        enabled: formBoolean(formData, "urgentEscalationEnabled"),
        hoursMode: formString(formData, "urgentEscalationHoursMode"),
        requireAcknowledgement: formBoolean(
          formData,
          "urgentEscalationRequireAcknowledgement",
        ),
        steps: urgentEscalationStepsFromForm(formData),
        triggerKeys: formData
          .getAll("urgentEscalationTriggerKey")
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean),
      },
      workplaceContacts: workplaceContactsFromForm(formData),
      workingHours: formString(formData, "businessWorkingHours"),
    },
    {
      businessName: workspace.name,
      publicEmail: user.email ?? "",
    },
  );
  const manualSignature = normalizeEmailSignatureSettings(
    {
      ...manualLogo,
      logoUrl: formString(formData, "manualSignatureLogoUrl"),
      logoWidthPx: formString(formData, "manualSignatureLogoWidthPx"),
      text: formString(formData, "manualSignatureText"),
    },
    beforeCommunicationSettings.manualSignature,
  );
  const communicationSettings = normalizeCommunicationSettings({
    ...beforeCommunicationSettings,
    businessSignature: manualSignature.text,
    manualSignature,
  });
  const generalSettings = normalizeWorkspaceGeneralSettings({
    ...beforeGeneralSettings,
    businessProfile,
    defaultPhoneRegion,
    displayCurrency,
    timeZone,
  });
  const inboundSettings = normalizeInboundEmailSettings({
    ...beforeInboundSettings,
    timeZone: generalSettings.timeZone,
  });

  const { data: savedGeneralPolicy, error: saveGeneralError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        workspace_id: workspace.id,
        policy_type: WORKSPACE_GENERAL_POLICY_TYPE,
        settings: generalSettings,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveGeneralError || !savedGeneralPolicy) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      saveGeneralError?.message ?? "Unable to save workspace defaults.",
    );
  }

  const { error: saveInboundError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        workspace_id: workspace.id,
        policy_type: INBOUND_EMAIL_POLICY_TYPE,
        settings: inboundSettings,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    );

  if (saveInboundError) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      saveInboundError.message,
    );
  }

  const { data: savedCommunicationPolicy, error: saveCommunicationError } =
    await supabase
      .from("workspace_policies")
      .upsert(
        {
          workspace_id: workspace.id,
          policy_type: COMMUNICATION_POLICY_TYPE,
          settings: communicationSettings,
        },
        {
          onConflict: "workspace_id,policy_type",
        },
      )
      .select("id")
      .single();

  if (saveCommunicationError || !savedCommunicationPolicy) {
    redirectWithSectionMessage(
      "general",
      "engine_error",
      saveCommunicationError?.message ?? "Unable to save email signature.",
    );
  }

  if (businessProfile.businessName && businessProfile.businessName !== workspace.name) {
    const { error: workspaceNameError } = await supabase
      .from("workspaces")
      .update({
        name: businessProfile.businessName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspace.id);

    if (workspaceNameError) {
      redirectWithSectionMessage(
        "general",
        "engine_error",
        workspaceNameError.message,
      );
    }
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "workspace_general_settings.updated",
    entityType: "workspace_policy",
    entityId: String(savedGeneralPolicy.id),
    before: beforeGeneralResult.data
      ? { settings: beforeGeneralResult.data.settings }
      : null,
    after: {
      settings: generalSettings,
      syncedInboundEmailTimeZone: inboundSettings.timeZone,
    },
  });

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "workspace_business_profile.updated",
    entityType: "workspace_policy",
    entityId: String(savedGeneralPolicy.id),
    before: {
      businessProfile: beforeGeneralSettings.businessProfile,
      manualSignature: beforeCommunicationSettings.manualSignature,
    },
    after: {
      businessProfile: generalSettings.businessProfile,
      manualSignature: communicationSettings.manualSignature,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  redirectWithSectionMessage(
    "general",
    "engine_message",
    "Business profile saved.",
  );
}

export async function disconnectIntegrationAction(formData: FormData) {
  const connectionId = formString(formData, "connectionId");
  const provider = formString(formData, "provider");
  const service = integrationService(provider);

  if (!connectionId || !service) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "Choose a valid connected account to disconnect.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: connection, error: connectionError } = await supabase
    .from("integration_connections")
    .select(
      "id,provider,service,account_email,account_name,status,scopes,last_connected_at",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", connectionId)
    .eq("provider", provider)
    .eq("service", service)
    .maybeSingle();

  if (connectionError) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      `Unable to inspect ${integrationLabel(provider)} connection: ${connectionError.message}`,
    );
  }

  if (!connection) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      `${integrationLabel(provider)} connection was not found.`,
    );
  }

  const { error: disconnectError } = await supabase
    .from("integration_connections")
    .update({
      access_token_expires_at: null,
      last_error: null,
      last_sync_at: null,
      status: "disconnected",
      token_set: {},
    })
    .eq("workspace_id", workspace.id)
    .eq("id", connectionId);

  if (disconnectError) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      `Unable to disconnect ${integrationLabel(provider)}: ${disconnectError.message}`,
    );
  }

  const { error: channelError } = await supabase
    .from("channels")
    .update({ status: "inactive" })
    .eq("workspace_id", workspace.id)
    .eq("integration_id", connectionId);

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: `integration.${provider}.disconnected`,
    entityType: "integration_connection",
    entityId: String(connection.id),
    before: {
      accountEmail: connection.account_email,
      accountName: connection.account_name,
      lastConnectedAt: connection.last_connected_at,
      provider: connection.provider,
      scopes: connection.scopes,
      service: connection.service,
      status: connection.status,
    },
    after: {
      channelStatus: channelError ? "cleanup_failed" : "inactive",
      provider,
      service,
      status: "disconnected",
      tokenCleared: true,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirectWithSectionMessage(
    "integrations",
    channelError ? "engine_error" : "engine_message",
    channelError
      ? `${integrationLabel(provider)} was disconnected, but Kyro could not deactivate its email channel: ${channelError.message}`
      : `${integrationLabel(provider)} disconnected. Use Connect ${provider === GOOGLE_PROVIDER ? "Google" : "Outlook"} to reconnect or grant fresh permissions.`,
  );
}

export async function updateInboundEmailSettingsAction(formData: FormData) {
  const syncMode = formString(formData, "inboundSyncMode");

  if (
    !INBOUND_EMAIL_SYNC_MODES.includes(
      syncMode as InboundEmailSettings["syncMode"],
    )
  ) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "Inbound email sync mode is invalid.",
    );
  }

  const pollIntervalMinutes =
    formInteger(formData, "inboundPollIntervalMinutes") ??
    DEFAULT_INBOUND_EMAIL_SETTINGS.pollIntervalMinutes;

  if (
    !INBOUND_EMAIL_POLL_INTERVALS.includes(
      pollIntervalMinutes as 5 | 15 | 30 | 60,
    )
  ) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "Inbound email poll interval is invalid.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      beforeError.message,
    );
  }

  const beforeSettings = normalizeInboundEmailSettings(beforePolicy?.settings);
  const settings = normalizeInboundEmailSettings({
    ...beforeSettings,
    actionInstructions: formString(formData, "inboundActionInstructions"),
    autoPromoteActionable: true,
    includeAwarenessEvents: formBoolean(
      formData,
      "inboundIncludeAwarenessEvents",
    ),
    lookbackDays:
      formInteger(formData, "inboundLookbackDays") ??
      DEFAULT_INBOUND_EMAIL_SETTINGS.lookbackDays,
    maxMessagesPerSync:
      formInteger(formData, "inboundMaxMessagesPerSync") ??
      DEFAULT_INBOUND_EMAIL_SETTINGS.maxMessagesPerSync,
    pollIntervalMinutes,
    quietHoursEnabled: formBoolean(formData, "inboundQuietHoursEnabled"),
    quietHoursEnd: formString(formData, "inboundQuietHoursEnd"),
    quietHoursMode: "paused",
    quietHoursStart: formString(formData, "inboundQuietHoursStart"),
    syncMode,
    timeZone: beforeSettings.timeZone,
  });

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        workspace_id: workspace.id,
        policy_type: INBOUND_EMAIL_POLICY_TYPE,
        settings,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      saveError?.message ?? "Unable to save inbound email settings.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "inbound_email_settings.updated",
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    after: { settings },
  });

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirectWithSectionMessage(
    "integrations",
    "engine_message",
    "Inbound email settings saved.",
  );
}

async function loadInboundEmailPolicyForSenderRule() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      beforeError.message,
    );
  }

  return {
    beforePolicy,
    beforeSettings: normalizeInboundEmailSettings(beforePolicy?.settings),
    supabase,
    user,
    workspace,
  };
}

export async function upsertInboundEmailSenderRuleSettingsAction(
  formData: FormData,
) {
  const returnToSenderRules = formData.get("returnToSenderRules") === "1";
  const match = formSenderRuleMatch(formString(formData, "senderRuleMatch"));
  const action = formSenderRuleActionValue(
    formString(formData, "senderRuleAction"),
  );
  const value = match
    ? senderRuleTargetFromInput(formString(formData, "senderRuleValue"), match)
    : null;

  if (!match || !action || !value) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "Add a valid sender email or domain and choose what Kyro should do.",
      { senderRules: returnToSenderRules },
    );
  }

  const { beforePolicy, beforeSettings, supabase, user, workspace } =
    await loadInboundEmailPolicyForSenderRule();
  const existingRule = beforeSettings.senderRules.find(
    (rule) => rule.match === match && rule.value === value,
  );
  const rule: InboundEmailSenderRule = {
    action,
    createdAt: existingRule?.createdAt ?? new Date().toISOString(),
    createdFromEventId: existingRule?.createdFromEventId ?? null,
    match,
    value,
  };
  const settings = upsertInboundEmailSenderRule(beforeSettings, rule);

  await saveInboundEmailPolicyUpdate({
    action: existingRule
      ? "inbound_email.sender_rule_updated"
      : "inbound_email.sender_rule_created",
    afterSettings: settings,
    beforePolicy,
    beforeSettings,
    metadata: {
      match,
      ruleAction: action,
      source: "settings",
      value,
    },
    supabase,
    userId: user.id,
    workspaceId: workspace.id,
  });

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirectWithSectionMessage(
    "integrations",
    "engine_message",
    `${value} will be treated as ${senderRuleActionLabel(action)}.`,
    { senderRules: returnToSenderRules },
  );
}

export async function removeInboundEmailSenderRuleSettingsAction(
  formData: FormData,
) {
  const returnToSenderRules = formData.get("returnToSenderRules") === "1";
  const match = formSenderRuleMatch(formString(formData, "senderRuleMatch"));
  const value = match
    ? senderRuleTargetFromInput(formString(formData, "senderRuleValue"), match)
    : null;

  if (!match || !value) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "Choose a valid sender rule to remove.",
      { senderRules: returnToSenderRules },
    );
  }

  const { beforePolicy, beforeSettings, supabase, user, workspace } =
    await loadInboundEmailPolicyForSenderRule();
  const existingRule = beforeSettings.senderRules.find(
    (rule) => rule.match === match && rule.value === value,
  );

  if (!existingRule) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "That sender rule is no longer saved.",
      { senderRules: returnToSenderRules },
    );
  }

  const settings = removeInboundEmailSenderRule(beforeSettings, {
    match,
    value,
  });

  await saveInboundEmailPolicyUpdate({
    action: "inbound_email.sender_rule_removed",
    afterSettings: settings,
    beforePolicy,
    beforeSettings,
    metadata: {
      match,
      removedAction: existingRule.action,
      source: "settings",
      value,
    },
    supabase,
    userId: user.id,
    workspaceId: workspace.id,
  });

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirectWithSectionMessage(
    "integrations",
    "engine_message",
    `Removed the sender rule for ${value}.`,
    { senderRules: returnToSenderRules },
  );
}

export async function syncInboundEmailNowAction() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  let result: Awaited<ReturnType<typeof syncInboundEmail>>;

  try {
    result = await syncInboundEmail({
      supabase,
      trigger: "manual",
      user,
      workspaceId: workspace.id,
    });
  } catch (error) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      error instanceof Error ? error.message : "Unable to sync inbound email.",
    );
  }

  const reconnectText =
    result.needsReconnect.length > 0
      ? ` ${result.needsReconnect.length} account needs reconnect for read access.`
      : "";
  const errorText =
    result.errors.length > 0
      ? ` ${result.errors.length} message/account errors.`
      : "";

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirectWithSectionMessage(
    "integrations",
    result.errors.length > 0 || result.needsReconnect.length > 0
      ? "engine_error"
      : "engine_message",
    `Checked ${result.checkedConnections} email account(s), fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, observed ${result.observedMessages}, skipped ${result.duplicates} duplicate(s).${reconnectText}${errorText}`,
  );
}

export async function updateVoiceSettingsAction(formData: FormData) {
  const redirectSection =
    formString(formData, "redirectSection") === "developer"
      ? "developer"
      : "voice";
  const openAiVoice = formString(formData, "openAiVoice") as OpenAiVoice;
  const outboundVoicePronunciationPolicy = formString(
    formData,
    "outboundVoicePronunciationPolicy",
  ) as OutboundVoicePronunciationPolicy;
  const phoneAgentDemeanor = formString(formData, "phoneAgentDemeanor");
  const phoneAgentVerbosity = formString(formData, "phoneAgentVerbosity");
  const phoneAgentHumourLevel = formString(formData, "phoneAgentHumourLevel");
  const phoneAgentEscalationMode = formString(
    formData,
    "phoneAgentEscalationMode",
  );
  const elevenLabsVoicePresetId = formString(
    formData,
    "elevenLabsVoicePresetId",
  );
  const phoneAgentUserNumberDetails =
    phoneAgentUserNumberDetailsFromForm(formData);

  if (!OPENAI_VOICE_OPTIONS.includes(openAiVoice)) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      "OpenAI voice is invalid.",
    );
  }

  if (
    !OUTBOUND_VOICE_PRONUNCIATION_POLICIES.includes(
      outboundVoicePronunciationPolicy,
    )
  ) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      "Outbound pronunciation policy is invalid.",
    );
  }

  if (!PHONE_AGENT_DEMEANORS.includes(phoneAgentDemeanor as never)) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      "Phone assistant style is invalid.",
    );
  }

  if (!PHONE_AGENT_VERBOSITIES.includes(phoneAgentVerbosity as never)) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      "Phone assistant detail level is invalid.",
    );
  }

  if (!PHONE_AGENT_HUMOUR_LEVELS.includes(phoneAgentHumourLevel as never)) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      "Phone assistant warmth setting is invalid.",
    );
  }

  if (!PHONE_AGENT_ESCALATION_MODES.includes(phoneAgentEscalationMode as never)) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      "Phone assistant escalation mode is invalid.",
    );
  }

  if (
    !ELEVENLABS_VOICE_PRESETS.some(
      (preset) => preset.id === elevenLabsVoicePresetId,
    )
  ) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      "Vapi voice option is invalid.",
    );
  }

  const settings: VoiceSettings = normalizeVoiceSettings({
    elevenLabsVoicePresetId,
    openAiVoice,
    outboundVoicePronunciationPolicy,
    phoneAgentDemeanor,
    phoneAgentEnabled: formBoolean(formData, "phoneAgentEnabled"),
    phoneAgentEscalationMode,
    phoneAgentHumourLevel,
    phoneAgentInboundEnabled: formBoolean(formData, "phoneAgentInboundEnabled"),
    phoneAgentOutboundEnabled: formBoolean(
      formData,
      "phoneAgentOutboundEnabled",
    ),
    phoneAgentUserNumberDetails,
    phoneAgentUserNumbers:
      phoneAgentUserNumberDetails.length > 0
        ? phoneAgentUserNumberDetails.map((row) => row.phoneNumber)
        : formString(formData, "phoneAgentUserNumbers"),
    phoneAgentVerbosity,
    phoneAgentVoicemailOverflowEnabled: formBoolean(
      formData,
      "phoneAgentVoicemailOverflowEnabled",
    ),
    vapiInternalAssistantId: formString(formData, "vapiInternalAssistantId"),
    vapiInboundAssistantId: formString(formData, "vapiInboundAssistantId"),
    vapiOutboundAssistantId: formString(formData, "vapiOutboundAssistantId"),
    vapiPhoneNumberId: formString(formData, "vapiPhoneNumberId"),
    vapiVoicemailAssistantId: formString(
      formData,
      "vapiVoicemailAssistantId",
    ),
    provider: "openai",
  });

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let phoneNumberAssignment: Awaited<
    ReturnType<typeof ensureWorkspacePhoneNumberFromPool>
  > | null = null;
  const needsWorkspacePhoneNumber =
    settings.phoneAgentEnabled &&
    (settings.phoneAgentInboundEnabled ||
      settings.phoneAgentOutboundEnabled ||
      settings.phoneAgentVoicemailOverflowEnabled);

  if (needsWorkspacePhoneNumber) {
    try {
      const generalSettings = await getWorkspaceGeneralSettings(
        supabase,
        workspace.id,
      );
      phoneNumberAssignment = await ensureWorkspacePhoneNumberFromPool({
        actorId: user.id,
        countryCode: generalSettings.defaultPhoneRegion,
        supabase: createServiceSupabaseClient(),
        workspaceId: workspace.id,
      });

      if (
        !settings.vapiPhoneNumberId &&
        phoneNumberAssignment.number.vapiPhoneNumberId
      ) {
        settings.vapiPhoneNumberId =
          phoneNumberAssignment.number.vapiPhoneNumberId;
      }
    } catch (error) {
      redirectWithSectionMessage(
        redirectSection,
        "engine_error",
        error instanceof Error
          ? error.message
          : "Unable to assign a workspace phone number.",
      );
    }
  }

  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", VOICE_SETTINGS_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithSectionMessage(
      redirectSection,
      "engine_error",
      beforeError.message,
    );
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
      redirectSection,
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
    metadata: phoneNumberAssignment
      ? {
          phoneNumberAssigned: phoneNumberAssignment.assigned,
          phoneNumberCountryCode: phoneNumberAssignment.countryCode,
          workspacePhoneNumberId: phoneNumberAssignment.number.id,
        }
      : undefined,
  });

  revalidatePath("/settings");
  revalidatePath("/voice");
  revalidatePath("/voice-vapi");
  redirectWithSectionMessage(
    redirectSection,
    "engine_message",
    "Voice assistant settings saved.",
  );
}

export async function enableVoicemailOverflowNumberAction(formData: FormData) {
  const phoneNumberId = formString(formData, "phoneNumberId");

  if (!phoneNumberId) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Choose a voicemail overflow number first.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const serviceSupabase = createServiceSupabaseClient();
  let assignedNumbers: WorkspacePhoneNumberPoolRow[] = [];

  try {
    assignedNumbers = await getWorkspaceAssignedPhoneNumbers(
      serviceSupabase,
      workspace.id,
    );
  } catch (error) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to load assigned phone numbers.",
    );
  }

  const selectedNumber = assignedNumbers.find(
    (number) => number.id === phoneNumberId,
  );

  if (!selectedNumber) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "That phone number is not assigned to this workspace.",
    );
  }

  if (!selectedNumber.capabilities.voice) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Choose a number that supports voice calls.",
    );
  }

  const before = assignedNumbers.map((number) => ({
    id: number.id,
    metadata: number.metadata,
    phoneNumber: number.phoneNumber,
  }));

  for (const number of assignedNumbers) {
    const baseMetadata = phoneNumberMetadataRecord(number.metadata);
    const metadata =
      number.id === selectedNumber.id
        ? voicemailOverflowMetadata(baseMetadata, user.id)
        : clearVoicemailOverflowMetadata(baseMetadata);

    const { error } = await serviceSupabase
      .from("workspace_phone_numbers")
      .update({ metadata })
      .eq("id", number.id)
      .eq("workspace_id", workspace.id);

    if (error) {
      redirectWithSectionMessage(
        "voice",
        "engine_error",
        `Unable to save voicemail overflow number: ${error.message}`,
      );
    }
  }

  const existingVoiceSettings = await getVoiceSettings(supabase, workspace.id);
  const voiceSettings = normalizeVoiceSettings({
    ...existingVoiceSettings,
    phoneAgentEnabled: true,
    phoneAgentVoicemailOverflowEnabled: true,
    vapiPhoneNumberId:
      selectedNumber.vapiPhoneNumberId ?? existingVoiceSettings.vapiPhoneNumberId,
  });

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
        settings: voiceSettings,
        workspace_id: workspace.id,
      },
      { onConflict: "workspace_id,policy_type" },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      saveError?.message ?? "Unable to enable voicemail overflow.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "voice.voicemail_overflow_number.enabled",
    actorId: user.id,
    actorType: "user",
    after: {
      phoneNumber: selectedNumber.phoneNumber,
      phoneNumberId: selectedNumber.id,
      settings: voiceSettings,
    },
    before: {
      numbers: before,
      settings: beforePolicy?.settings ?? null,
    },
    entityId: selectedNumber.id,
    entityType: "workspace_phone_number",
    metadata: {
      vapiPhoneNumberId: selectedNumber.vapiPhoneNumberId,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/voice-vapi");
  revalidatePath("/assistant");
  redirectWithSectionMessage(
    "voice",
    "engine_message",
    `${selectedNumber.phoneNumber} is now the voicemail overflow number.`,
  );
}

export async function disableVoicemailOverflowNumberAction(formData: FormData) {
  const phoneNumberId = formString(formData, "phoneNumberId");
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const serviceSupabase = createServiceSupabaseClient();
  let assignedNumbers: WorkspacePhoneNumberPoolRow[] = [];

  try {
    assignedNumbers = await getWorkspaceAssignedPhoneNumbers(
      serviceSupabase,
      workspace.id,
    );
  } catch (error) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to load assigned phone numbers.",
    );
  }

  const overflowNumbers = assignedNumbers.filter((number) => {
    if (phoneNumberId && number.id !== phoneNumberId) {
      return false;
    }

    return numberHasVoicemailOverflowPurpose(number);
  });

  if (phoneNumberId && overflowNumbers.length === 0) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "That number is not currently set as voicemail overflow.",
    );
  }

  for (const number of overflowNumbers) {
    const { error } = await serviceSupabase
      .from("workspace_phone_numbers")
      .update({
        metadata: clearVoicemailOverflowMetadata(
          phoneNumberMetadataRecord(number.metadata),
        ),
      })
      .eq("id", number.id)
      .eq("workspace_id", workspace.id);

    if (error) {
      redirectWithSectionMessage(
        "voice",
        "engine_error",
        `Unable to remove voicemail overflow: ${error.message}`,
      );
    }
  }

  const existingVoiceSettings = await getVoiceSettings(supabase, workspace.id);
  const voiceSettings = normalizeVoiceSettings({
    ...existingVoiceSettings,
    phoneAgentVoicemailOverflowEnabled: false,
  });

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
        settings: voiceSettings,
        workspace_id: workspace.id,
      },
      { onConflict: "workspace_id,policy_type" },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      saveError?.message ?? "Unable to disable voicemail overflow.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "voice.voicemail_overflow_number.disabled",
    actorId: user.id,
    actorType: "user",
    after: {
      removedPhoneNumberIds: overflowNumbers.map((number) => number.id),
      settings: voiceSettings,
    },
    before: {
      numbers: overflowNumbers.map((number) => ({
        id: number.id,
        metadata: number.metadata,
        phoneNumber: number.phoneNumber,
      })),
      settings: beforePolicy?.settings ?? null,
    },
    entityId: phoneNumberId || workspace.id,
    entityType: phoneNumberId ? "workspace_phone_number" : "workspace",
  });

  revalidatePath("/settings");
  revalidatePath("/voice-vapi");
  revalidatePath("/assistant");
  redirectWithSectionMessage(
    "voice",
    "engine_message",
    "Voicemail overflow routing is disabled.",
  );
}

export async function enableWorkspacePhoneSmsAction(formData: FormData) {
  const phoneNumberId = formString(formData, "phoneNumberId");

  if (!phoneNumberId) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "Choose an available phone number first.",
      { panel: "phone-sms" },
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const serviceSupabase = createServiceSupabaseClient();
  const generalSettings = await getWorkspaceGeneralSettings(
    supabase,
    workspace.id,
  );
  const countryCode =
    operatingCountryPhoneRegion(generalSettings.businessProfile.operatingCountry) ??
    generalSettings.defaultPhoneRegion;

  let assignment: Awaited<
    ReturnType<typeof assignWorkspacePhoneNumberFromPool>
  >;

  try {
    assignment = await assignWorkspacePhoneNumberFromPool({
      actorId: user.id,
      countryCode,
      phoneNumberId,
      recordActivationCharge: true,
      supabase: serviceSupabase,
      workspaceId: workspace.id,
    });
  } catch (error) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to enable the phone and SMS assistant number.",
      { panel: "phone-sms" },
    );
  }

  const existingVoiceSettings = await getVoiceSettings(supabase, workspace.id);
  const voiceSettings = normalizeVoiceSettings({
    ...existingVoiceSettings,
    phoneAgentEnabled: true,
    phoneAgentInboundEnabled: true,
    phoneAgentOutboundEnabled: true,
    vapiPhoneNumberId:
      assignment.number.vapiPhoneNumberId ??
      existingVoiceSettings.vapiPhoneNumberId,
  });

  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", VOICE_SETTINGS_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      beforeError.message,
      { panel: "phone-sms" },
    );
  }

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: VOICE_SETTINGS_POLICY_TYPE,
        settings: voiceSettings,
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
      "integrations",
      "engine_error",
      saveError?.message ?? "Unable to enable phone voice settings.",
      { panel: "phone-sms" },
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "phone_sms_number.enabled",
    actorId: user.id,
    actorType: "user",
    after: {
      phoneNumber: assignment.number.phoneNumber,
      phoneNumberId: assignment.number.id,
      settings: voiceSettings,
      vapiPhoneNumberId: assignment.number.vapiPhoneNumberId,
    },
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    entityId: String(savedPolicy.id),
    entityType: "workspace_policy",
    metadata: {
      activationCharged: assignment.activationCharged,
      phoneNumberAssigned: assignment.assigned,
      phoneNumberCountryCode: assignment.countryCode,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/voice-vapi");
  revalidatePath("/assistant");
  redirectWithSectionMessage(
    "integrations",
    "engine_message",
    assignment.activationCharged
      ? `Phone and SMS enabled on ${assignment.number.phoneNumber}. A one-time US$6 setup charge was added to the usage ledger.`
      : `Phone and SMS enabled on ${assignment.number.phoneNumber}.`,
    { panel: "phone-sms" },
  );
}

export async function disconnectWorkspacePhoneSmsAction(formData: FormData) {
  const phoneNumberId = formString(formData, "phoneNumberId");

  if (!phoneNumberId) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      "Choose a phone number to disconnect.",
      { panel: "phone-sms" },
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const serviceSupabase = createServiceSupabaseClient();
  let release: Awaited<ReturnType<typeof releaseWorkspacePhoneNumberToPool>>;

  try {
    release = await releaseWorkspacePhoneNumberToPool({
      actorId: user.id,
      phoneNumberId,
      supabase: serviceSupabase,
      workspaceId: workspace.id,
    });
  } catch (error) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to disconnect that phone number.",
      { panel: "phone-sms" },
    );
  }

  let remainingNumbers: Awaited<
    ReturnType<typeof getWorkspaceAssignedPhoneNumbers>
  > = [];

  try {
    remainingNumbers = await getWorkspaceAssignedPhoneNumbers(
      serviceSupabase,
      workspace.id,
    );
  } catch (error) {
    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      error instanceof Error
        ? error.message
        : "Phone number disconnected, but Kyro could not refresh the remaining phone-number list.",
      { panel: "phone-sms" },
    );
  }

  const existingVoiceSettings = await getVoiceSettings(supabase, workspace.id);
  const replacementVapiPhoneNumberId =
    remainingNumbers.find((number) => number.vapiPhoneNumberId)
      ?.vapiPhoneNumberId ?? null;
  const disconnectedActiveVapiNumber =
    release.number.vapiPhoneNumberId &&
    existingVoiceSettings.vapiPhoneNumberId === release.number.vapiPhoneNumberId;
  const shouldUpdateVoiceSettings =
    remainingNumbers.length === 0 || disconnectedActiveVapiNumber;

  if (shouldUpdateVoiceSettings) {
    const { data: beforePolicy, error: beforeError } = await supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", VOICE_SETTINGS_POLICY_TYPE)
      .maybeSingle();

    if (beforeError) {
      redirectWithSectionMessage(
        "integrations",
        "engine_error",
        beforeError.message,
        { panel: "phone-sms" },
      );
    }

    const voiceSettings = normalizeVoiceSettings({
      ...existingVoiceSettings,
      phoneAgentEnabled:
        remainingNumbers.length > 0
          ? existingVoiceSettings.phoneAgentEnabled
          : false,
      phoneAgentInboundEnabled:
        remainingNumbers.length > 0
          ? existingVoiceSettings.phoneAgentInboundEnabled
          : false,
      phoneAgentOutboundEnabled:
        remainingNumbers.length > 0
          ? existingVoiceSettings.phoneAgentOutboundEnabled
          : false,
      phoneAgentVoicemailOverflowEnabled:
        remainingNumbers.length > 0
          ? existingVoiceSettings.phoneAgentVoicemailOverflowEnabled
          : false,
      vapiPhoneNumberId:
        replacementVapiPhoneNumberId ?? existingVoiceSettings.vapiPhoneNumberId,
    });

    if (replacementVapiPhoneNumberId) {
      voiceSettings.vapiPhoneNumberId = replacementVapiPhoneNumberId;
    }

    if (remainingNumbers.length === 0) {
      voiceSettings.vapiPhoneNumberId = null;
    }

    const { data: savedPolicy, error: saveError } = await supabase
      .from("workspace_policies")
      .upsert(
        {
          policy_type: VOICE_SETTINGS_POLICY_TYPE,
          settings: voiceSettings,
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
        "integrations",
        "engine_error",
        saveError?.message ?? "Unable to update phone voice settings.",
        { panel: "phone-sms" },
      );
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "assistant_voice_settings.phone_number_disconnected",
      actorId: user.id,
      actorType: "user",
      after: { settings: voiceSettings },
      before: beforePolicy ? { settings: beforePolicy.settings } : null,
      entityId: String(savedPolicy.id),
      entityType: "workspace_policy",
      metadata: {
        disconnectedPhoneNumberId: release.number.id,
        remainingPhoneNumberCount: remainingNumbers.length,
        replacementVapiPhoneNumberId,
      },
    });
  }

  revalidatePath("/settings");
  revalidatePath("/voice-vapi");
  revalidatePath("/assistant");
  redirectWithSectionMessage(
    "integrations",
    "engine_message",
    remainingNumbers.length > 0
      ? `${release.number.phoneNumber} disconnected and returned to the available number pool.`
      : `${release.number.phoneNumber} disconnected. Phone and SMS automation is disabled until another number is assigned.`,
    { panel: "phone-sms" },
  );
}

export async function connectStripePaymentsAction() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const serviceSupabase = createServiceSupabaseClient();
  let onboardingUrl = "";

  try {
    const generalSettings = await getWorkspaceGeneralSettings(
      supabase,
      workspace.id,
    );
    const businessName =
      generalSettings.businessProfile.businessName || workspace.name;
    const email = user.email ?? generalSettings.businessProfile.publicEmail;

    if (!email) {
      throw new Error("Add an account email before connecting Stripe payments.");
    }

    onboardingUrl = await createStripeConnectOnboardingLink({
      businessName,
      email,
      generalSettings,
      supabase: serviceSupabase,
      workspaceId: workspace.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const connectSignupNeeded =
      message.includes("signed up for Connect") ||
      message.includes("dashboard.stripe.com/connect");

    redirectWithSectionMessage(
      "integrations",
      "engine_error",
      connectSignupNeeded
        ? "Stripe Connect is not enabled on the Kyro platform account yet. Enable Connect in Stripe first, then workspace users can onboard through this Kyro link even if they have never used Stripe before."
        : error instanceof Error
          ? error.message
        : "Unable to start Stripe payments setup.",
    );
  }

  redirect(onboardingUrl);
}

export async function startKyroBillingSetupAction() {
  const { user, workspace } = await requireWorkspaceContext();
  const supabase = createServiceSupabaseClient();
  let setupUrl = "";

  try {
    setupUrl = await createKyroUserBillingSetupUrl({
      supabase,
      user,
      workspace,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start Kyro billing setup.";
    redirect(
      `/settings?section=usage&panel=payment-method&engine_error=${encodeURIComponent(
        message,
      )}`,
    );
  }

  redirect(setupUrl);
}

export async function openKyroBillingPortalAction() {
  const { workspace } = await requireWorkspaceContext();
  const supabase = createServiceSupabaseClient();
  let portalUrl = "";

  try {
    portalUrl = await createKyroUserBillingPortalUrl({
      supabase,
      workspaceId: workspace.id,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to open Kyro billing portal.";
    redirect(
      `/settings?section=usage&panel=payment-method&engine_error=${encodeURIComponent(
        message,
      )}`,
    );
  }

  redirect(portalUrl);
}

export async function createPronunciationEntryAction(formData: FormData) {
  const phrase = formString(formData, "phrase");
  const pronunciationHint =
    formString(formData, "pronunciationHint") ||
    defaultPronunciationHint(phrase) ||
    null;
  const category = pronunciationCategoryValue(formString(formData, "category"));
  const status = pronunciationStatusValue(formString(formData, "status"));
  const aliases = splitPronunciationAliases(formString(formData, "aliases"));

  if (!phrase) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Add a word or phrase first.",
    );
  }

  if (!PRONUNCIATION_CATEGORIES.includes(category)) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Pronunciation category is invalid.",
    );
  }

  if (!PRONUNCIATION_STATUSES.includes(status)) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Pronunciation status is invalid.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    const entry = await upsertPronunciationEntry({
      aliases,
      category,
      phrase,
      pronunciationHint,
      status,
      supabase,
      user,
      workspaceId: workspace.id,
    });

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "assistant_pronunciation.created",
      actorId: user.id,
      actorType: "user",
      after: { entry },
      entityId: entry.id,
      entityType: "assistant_pronunciation",
    });
  } catch (error) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to save pronunciation entry.",
    );
  }

  revalidatePath("/settings");
  revalidatePath("/voice");
  redirectWithSectionMessage(
    "voice",
    "engine_message",
    "Pronunciation entry saved.",
  );
}

export async function updatePronunciationEntryAction(formData: FormData) {
  const entry = await savePronunciationEntryUpdate(formData);

  if (!entry) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Pronunciation entry is incomplete.",
    );
  }

  revalidatePath("/settings");
  revalidatePath("/voice");
  redirectWithSectionMessage(
    "voice",
    "engine_message",
    "Pronunciation entry updated.",
  );
}

export async function autosavePronunciationEntryAction(formData: FormData) {
  const entry = await savePronunciationEntryUpdate(formData);

  if (!entry) {
    throw new Error("Pronunciation entry is incomplete.");
  }

  revalidatePath("/settings");
  revalidatePath("/voice");
}

async function savePronunciationEntryUpdate(formData: FormData) {
  const entryId = formString(formData, "entryId");
  const phrase = formString(formData, "phrase");
  const pronunciationHint =
    formString(formData, "pronunciationHint") ||
    defaultPronunciationHint(phrase) ||
    null;
  const category = pronunciationCategoryValue(formString(formData, "category"));
  const statusInput = formString(formData, "status");
  const status = statusInput
    ? pronunciationStatusValue(statusInput)
    : ("approved" satisfies PronunciationStatus);
  const aliases = splitPronunciationAliases(formString(formData, "aliases"));

  if (!entryId || !phrase) {
    return null;
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    const entry = await updatePronunciationEntry({
      aliases,
      category,
      entryId,
      phrase,
      pronunciationHint,
      status,
      supabase,
      user,
      workspaceId: workspace.id,
    });

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "assistant_pronunciation.updated",
      actorId: user.id,
      actorType: "user",
      after: { entry },
      entityId: entry.id,
      entityType: "assistant_pronunciation",
    });

    return entry;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Unable to update pronunciation entry.",
    );
  }
}

export async function ignorePronunciationEntryAction(formData: FormData) {
  formData.set("status", "ignored" satisfies PronunciationStatus);
  await updatePronunciationEntryAction(formData);
}

export async function updateDashboardTutorialTestModeAction(formData: FormData) {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const tutorialSupabase = supabase as unknown as TutorialSupabaseClient;
  const forceShow = formBoolean(formData, "dashboardTutorialForceShow");

  const { error } = await tutorialSupabase
    .from("workspace_tutorial_state")
    .upsert(
      {
        dashboard_tour_completed_at: forceShow
          ? null
          : new Date().toISOString(),
        dashboard_tour_completed_by: forceShow ? null : user.id,
        dashboard_tour_force_show: forceShow,
        dashboard_tour_version: 1,
        workspace_id: workspace.id,
      },
      { onConflict: "workspace_id" },
    );

  if (error) {
    redirectWithSectionMessage(
      "developer",
      "engine_error",
      `Unable to update dashboard tutorial test mode: ${error.message}`,
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  redirectWithSectionMessage(
    "developer",
    "engine_message",
    forceShow
      ? "Dashboard tutorial test mode is on. The tour will appear whenever the Dashboard loads until you turn this off."
      : "Dashboard tutorial test mode is off. The tour will only appear for first-time workspaces.",
  );
}
