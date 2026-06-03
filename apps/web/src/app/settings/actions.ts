"use server";

import {
  COMMUNICATION_POLICY_TYPE,
  DEFAULT_COMMUNICATION_SETTINGS,
  OUTBOUND_CHANNELS,
  isOutboundChannel,
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
  normalizeWorkspaceGeneralSettings,
} from "../../lib/workspace/general-settings";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { createServiceSupabaseClient } from "../../lib/supabase/service";
import { ensureWorkspacePhoneNumberFromPool } from "../../lib/voice/phone-number-pool";
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

async function signatureLogoPayload(
  formData: FormData,
  prefix: "manualSignature" | "aiGeneratedSignature",
) {
  const upload = formData.get(`${prefix}LogoFile`);

  if (upload && isUploadFile(upload) && upload.name.trim() && upload.size > 0) {
    if (!upload.type.startsWith("image/")) {
      redirectWithSettingsMessage(
        "engine_error",
        "Signature logos must be image files.",
      );
    }

    if (upload.size > MAX_SIGNATURE_LOGO_BYTES) {
      redirectWithSettingsMessage(
        "engine_error",
        "Signature logos are limited to 512 KB for now.",
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

function redirectWithSectionMessage(
  section: "general" | "integrations" | "voice",
  key: "engine_error" | "engine_message",
  message: string,
  options: { senderRules?: boolean } = {},
): never {
  const params = new URLSearchParams({ section, [key]: message });

  if (options.senderRules) {
    params.set("senderRules", "1");
  }

  redirect(`/settings?${params.toString()}`);
}

function redirectWithSettingsMessage(
  key: "engine_error" | "engine_message",
  message: string,
): never {
  redirectWithSectionMessage("integrations", key, message);
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
    );
  }

  if (allowedChannels.length === 0) {
    redirectWithSettingsMessage(
      "engine_error",
      "Select at least one outbound channel.",
    );
  }

  const unsupportedChannel = allowedChannels.find(
    (channel) => !OUTBOUND_CHANNELS.includes(channel),
  );

  if (unsupportedChannel) {
    redirectWithSettingsMessage(
      "engine_error",
      `${unsupportedChannel} is not a supported channel.`,
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
    redirectWithSettingsMessage("engine_error", beforeError.message);
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

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const [beforeGeneralResult, beforeInboundResult] = await Promise.all([
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

  const beforeInboundSettings = normalizeInboundEmailSettings(
    beforeInboundResult.data?.settings,
  );
  const beforeGeneralSettings = normalizeWorkspaceGeneralSettings(
    beforeGeneralResult.data?.settings,
    { timeZone: beforeInboundSettings.timeZone },
  );
  const generalSettings = normalizeWorkspaceGeneralSettings({
    ...beforeGeneralSettings,
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

  revalidatePath("/settings");
  redirectWithSectionMessage(
    "general",
    "engine_message",
    "Workspace defaults saved.",
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

  if (!OPENAI_VOICE_OPTIONS.includes(openAiVoice)) {
    redirectWithSectionMessage(
      "voice",
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
      "voice",
      "engine_error",
      "Outbound pronunciation policy is invalid.",
    );
  }

  if (!PHONE_AGENT_DEMEANORS.includes(phoneAgentDemeanor as never)) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Phone assistant style is invalid.",
    );
  }

  if (!PHONE_AGENT_VERBOSITIES.includes(phoneAgentVerbosity as never)) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Phone assistant detail level is invalid.",
    );
  }

  if (!PHONE_AGENT_HUMOUR_LEVELS.includes(phoneAgentHumourLevel as never)) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Phone assistant warmth setting is invalid.",
    );
  }

  if (!PHONE_AGENT_ESCALATION_MODES.includes(phoneAgentEscalationMode as never)) {
    redirectWithSectionMessage(
      "voice",
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
      "voice",
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
    phoneAgentUserNumbers: formString(formData, "phoneAgentUserNumbers"),
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
        "voice",
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
    "voice",
    "engine_message",
    "Voice assistant settings saved.",
  );
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
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      "Pronunciation entry is incomplete.",
    );
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
  } catch (error) {
    redirectWithSectionMessage(
      "voice",
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to update pronunciation entry.",
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

export async function ignorePronunciationEntryAction(formData: FormData) {
  formData.set("status", "ignored" satisfies PronunciationStatus);
  await updatePronunciationEntryAction(formData);
}
