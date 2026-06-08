import {
  OPENAI_VOICE_OPTIONS,
  OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
  VOICE_SETTINGS_POLICY_TYPE,
  getVoiceSettings,
  normalizeVoiceSettings,
} from "../../../../lib/assistant/voice-settings";
import {
  PRONUNCIATION_CATEGORIES,
  PRONUNCIATION_STATUSES,
  defaultPronunciationHint,
  getPronunciationEntries,
  pronunciationCategoryValue,
  pronunciationStatusValue,
  splitPronunciationAliases,
  updatePronunciationEntry,
  upsertPronunciationEntry,
} from "../../../../lib/assistant/pronunciation";
import {
  DISPLAY_CURRENCIES,
  displayCurrencySourceLabel,
  formatDisplayMoney,
  normalizeDisplayCurrency,
} from "../../../../lib/billing/display-currency";
import {
  COMMUNICATION_POLICY_TYPE,
  OUTBOUND_CHANNELS,
  getCommunicationSettings,
  isOutboundChannel,
  normalizeCommunicationSettings,
  normalizeEmailSignatureSettings,
} from "../../../../lib/communication/settings";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import {
  GOOGLE_GMAIL_READ_SCOPE,
  getGoogleIntegrationOverview,
} from "../../../../lib/integrations/google";
import {
  INBOUND_EMAIL_POLL_INTERVALS,
  INBOUND_EMAIL_POLICY_TYPE,
  INBOUND_EMAIL_SENDER_RULE_ACTIONS,
  INBOUND_EMAIL_SYNC_MODES,
  getInboundEmailOperationalSummary,
  getInboundEmailSettings,
  normalizeInboundEmailSettings,
  removeInboundEmailSenderRule,
  senderRuleTargetFromInput,
  upsertInboundEmailSenderRule,
  type InboundEmailSenderRule,
} from "../../../../lib/integrations/inbound-email-settings";
import {
  MICROSOFT_MAIL_READ_SCOPE,
  getMicrosoftIntegrationOverview,
} from "../../../../lib/integrations/microsoft";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";
import { getUsageReport, normalizeUsageWindow, usageWindows } from "../../../../lib/usage/queries";
import {
  WORKSPACE_GENERAL_POLICY_TYPE,
  getWorkspaceGeneralSettings,
  normalizeWorkspaceGeneralSettings,
} from "../../../../lib/workspace/general-settings";

export const dynamic = "force-dynamic";

type MobileContext = Awaited<ReturnType<typeof requireMobileWorkspaceContext>>;
type PolicyRow = {
  id?: string;
  settings?: unknown;
};
type MobileSettingsSection =
  | "communication"
  | "general"
  | "inboundEmail"
  | "pronunciation"
  | "voice";

const MAX_SIGNATURE_LOGO_BYTES = 512 * 1024;

export async function GET(request: Request) {
  try {
    const context = await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);

    return Response.json(
      await buildSettingsResponse(
        context,
        normalizeUsageWindow(url.searchParams.get("usageWindow")),
      ),
    );
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireMobileWorkspaceContext(request);
    const payload = objectRecord(await request.json().catch(() => null));
    const section = textValue(payload.section) as MobileSettingsSection | null;
    const operation = textValue(payload.operation);
    const settings = objectRecord(payload.settings);

    if (
      section !== "communication" &&
      section !== "general" &&
      section !== "inboundEmail" &&
      section !== "pronunciation" &&
      section !== "voice"
    ) {
      throw new Error("Choose a supported settings section to update.");
    }

    if (section === "general") {
      await updateGeneralSettings(context, settings);
    } else if (section === "communication") {
      await updateCommunicationSettings(context, settings);
    } else if (section === "inboundEmail") {
      if (operation === "upsert_sender_rule") {
        await upsertSenderRuleSettings(context, settings);
      } else if (operation === "remove_sender_rule") {
        await removeSenderRuleSettings(context, settings);
      } else {
        await updateInboundEmailSettings(context, settings);
      }
    } else if (section === "pronunciation") {
      await updatePronunciationSettings(context, operation, settings);
    } else {
      await updateVoiceSettings(context, settings);
    }

    return Response.json({
      ...(await buildSettingsResponse(context)),
      message: "Settings saved.",
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

async function buildSettingsResponse({
  supabase,
  user,
  workspace,
}: MobileContext, usageWindow = normalizeUsageWindow("30d")) {
  const [
    communication,
    general,
    google,
    inboundEmail,
    inboundSummary,
    microsoft,
    pronunciationEntries,
    usageReport,
    voice,
  ] = await Promise.all([
    getCommunicationSettings(supabase, workspace.id),
    getWorkspaceGeneralSettings(supabase, workspace.id),
    getGoogleIntegrationOverview(supabase, workspace.id),
    getInboundEmailSettings(supabase, workspace.id),
    getInboundEmailOperationalSummary(supabase, workspace.id),
    getMicrosoftIntegrationOverview(supabase, workspace.id),
    getPronunciationEntries(supabase, workspace.id),
    getUsageReport(supabase, workspace.id, usageWindow),
    getVoiceSettings(supabase, workspace.id),
  ]);
  const connections = [
    ...google.connections.map((connection) => ({
      ...connection,
      needsReconnect:
        connection.status === "connected" &&
        !connection.scopes.includes(GOOGLE_GMAIL_READ_SCOPE),
      provider: "google",
      providerLabel: "Google",
      readReady: connection.scopes.includes(GOOGLE_GMAIL_READ_SCOPE),
      requiredReadScope: GOOGLE_GMAIL_READ_SCOPE,
    })),
    ...microsoft.connections.map((connection) => ({
      ...connection,
      needsReconnect:
        connection.status === "connected" &&
        !connection.scopes.includes(MICROSOFT_MAIL_READ_SCOPE),
      provider: "microsoft",
      providerLabel: "Microsoft",
      readReady: connection.scopes.includes(MICROSOFT_MAIL_READ_SCOPE),
      requiredReadScope: MICROSOFT_MAIL_READ_SCOPE,
    })),
  ];
  const connectedCount = connections.filter(
    (connection) => connection.status === "connected",
  ).length;
  const latestSync = inboundSummary.syncRuns[0] ?? null;

  return {
    connections,
    integrations: {
      google: {
        configured: google.configured,
        encryptionReady: google.encryptionReady,
        error: google.error,
        migrationReady: google.migrationReady,
        redirectUri: google.redirectUri,
        status: integrationStatusLabel(google),
      },
      microsoft: {
        configured: microsoft.configured,
        encryptionReady: microsoft.encryptionReady,
        error: microsoft.error,
        migrationReady: microsoft.migrationReady,
        redirectUri: microsoft.redirectUri,
        status: integrationStatusLabel(microsoft),
      },
    },
    options: {
      displayCurrencies: [...DISPLAY_CURRENCIES],
      inboundPollIntervals: [...INBOUND_EMAIL_POLL_INTERVALS],
      inboundSenderRuleActions: [...INBOUND_EMAIL_SENDER_RULE_ACTIONS],
      inboundSyncModes: [...INBOUND_EMAIL_SYNC_MODES],
      outboundChannels: [...OUTBOUND_CHANNELS],
      outboundVoicePronunciationPolicies: [
        ...OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
      ],
      pronunciationCategories: [...PRONUNCIATION_CATEGORIES],
      pronunciationStatuses: [...PRONUNCIATION_STATUSES],
      voices: [...OPENAI_VOICE_OPTIONS],
    },
    pronunciationEntries: pronunciationEntries
      .filter((entry) => entry.status !== "ignored")
      .slice(0, 10)
      .map((entry) => ({
        aliases: entry.aliases,
        category: entry.category,
        id: entry.id,
        lastSeenAt: entry.lastSeenAt,
        phrase: entry.phrase,
        pronunciationHint: entry.pronunciationHint,
        source: entry.source,
        status: entry.status,
        usageCount: entry.usageCount,
      })),
    settings: {
      communication: {
        allowedChannels: communication.allowedChannels,
        approvalRequired: communication.approvalRequired,
        defaultTone: communication.defaultTone,
        dryRunOnly: communication.dryRunOnly,
        useSeparateAiSignature: communication.useSeparateAiSignature,
        aiGeneratedSignature: communication.aiGeneratedSignature,
        aiGeneratedSignatureText: communication.aiGeneratedSignature.text,
        manualSignature: communication.manualSignature,
        manualSignatureText: communication.manualSignature.text,
      },
      general: {
        ...general,
        displayCurrencySourceLabel: displayCurrencySourceLabel(general),
      },
      inboundEmail: {
        actionInstructions: inboundEmail.actionInstructions,
        includeAwarenessEvents: inboundEmail.includeAwarenessEvents,
        lookbackDays: inboundEmail.lookbackDays,
        maxMessagesPerSync: inboundEmail.maxMessagesPerSync,
        pollIntervalMinutes: inboundEmail.pollIntervalMinutes,
        quietHoursEnabled: inboundEmail.quietHoursEnabled,
        quietHoursEnd: inboundEmail.quietHoursEnd,
        quietHoursStart: inboundEmail.quietHoursStart,
        senderRules: inboundEmail.senderRules,
        senderRuleCount: inboundEmail.senderRules.length,
        syncMode: inboundEmail.syncMode,
        timeZone: inboundEmail.timeZone,
      },
      voice: {
        openAiVoice: voice.openAiVoice,
        outboundVoicePronunciationPolicy:
          voice.outboundVoicePronunciationPolicy,
        provider: voice.provider,
      },
    },
    status: {
      connectedAccountCount: connectedCount,
      inboundDecisionCount: inboundSummary.decisions.length,
      latestInboundDecision: inboundSummary.decisions[0] ?? null,
      latestSync,
      reconnectNeededCount: connections.filter(
        (connection) => connection.needsReconnect,
      ).length,
    },
    developer: {
      enabled: developerEnabled(user),
      source: "auth_app_metadata",
    },
    usage: {
      activeWindow: usageReport.activeWindow,
      generatedAt: usageReport.generatedAt,
      ledger: usageReport.ledger.slice(0, 60).map((row) => ({
        createdAt: row.createdAt,
        currency: row.currency,
        customerCharge: row.customerCharge,
        displayCustomerCharge: formatDisplayMoney(
          row.customerCharge,
          row.currency,
          general,
        ),
        id: row.id,
        model: row.model,
        provider: row.provider,
        quantity: row.quantity,
        service: row.service,
        sourceLabel: row.sourceLabel,
        sourceMeta: row.sourceMeta,
        taskLabel: row.taskLabel,
        unit: row.unit,
        userName: row.userName,
      })),
      providerBreakdown: usageReport.providerBreakdown.slice(0, 6).map((row) => ({
        customerCharge: row.customerCharge,
        displayCustomerCharge: formatDisplayMoney(
          row.customerCharge,
          row.currency,
          general,
        ),
        events: row.events,
        key: row.key,
        label: row.label,
        model: row.model,
        provider: row.provider,
        service: row.service,
      })),
      taskBreakdown: usageReport.taskBreakdown.slice(0, 6).map((row) => ({
        customerCharge: row.customerCharge,
        description: row.description,
        displayCustomerCharge: formatDisplayMoney(
          row.customerCharge,
          row.currency,
          general,
        ),
        events: row.events,
        key: row.key,
        label: row.label,
      })),
      totals: {
        customerCharge: usageReport.totals.customerCharge,
        displayCustomerCharge: formatDisplayMoney(
          usageReport.totals.customerCharge,
          usageReport.totals.currency,
          general,
        ),
        events: usageReport.totals.events,
        providerCost: usageReport.totals.providerCost,
        currency: usageReport.totals.currency,
      },
      windows: usageWindows.map((window) => window.value),
    },
    user: {
      email: user.email ?? null,
      id: user.id,
    },
    workspace,
  };
}

async function updateGeneralSettings(
  context: MobileContext,
  updates: Record<string, unknown>,
) {
  const { supabase, workspace } = context;
  const [beforeGeneral, beforeInbound] = await Promise.all([
    loadPolicy(context, WORKSPACE_GENERAL_POLICY_TYPE),
    loadPolicy(context, INBOUND_EMAIL_POLICY_TYPE),
  ]);
  const beforeInboundSettings = normalizeInboundEmailSettings(
    beforeInbound?.settings,
  );
  const beforeGeneralSettings = normalizeWorkspaceGeneralSettings(
    beforeGeneral?.settings,
    { timeZone: beforeInboundSettings.timeZone },
  );
  const timeZone = textValue(updates.timeZone) ?? beforeGeneralSettings.timeZone;

  assertValidTimeZone(timeZone);

  const settings = normalizeWorkspaceGeneralSettings({
    ...beforeGeneralSettings,
    displayCurrency: normalizeDisplayCurrency(
      updates.displayCurrency,
      beforeGeneralSettings.displayCurrency,
    ),
    timeZone,
  });
  const inboundSettings = normalizeInboundEmailSettings({
    ...beforeInboundSettings,
    timeZone: settings.timeZone,
  });

  await savePolicy(context, {
    action: "workspace_general_settings.updated",
    beforePolicy: beforeGeneral,
    policyType: WORKSPACE_GENERAL_POLICY_TYPE,
    settings,
  });

  const { error } = await supabase.from("workspace_policies").upsert(
    {
      policy_type: INBOUND_EMAIL_POLICY_TYPE,
      settings: inboundSettings,
      workspace_id: workspace.id,
    },
    { onConflict: "workspace_id,policy_type" },
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function updateCommunicationSettings(
  context: MobileContext,
  updates: Record<string, unknown>,
) {
  const beforePolicy = await loadPolicy(context, COMMUNICATION_POLICY_TYPE);
  const beforeSettings = normalizeCommunicationSettings(beforePolicy?.settings);
  const allowedChannels = Array.isArray(updates.allowedChannels)
    ? updates.allowedChannels.filter(
        (channel): channel is (typeof OUTBOUND_CHANNELS)[number] =>
          typeof channel === "string" && isOutboundChannel(channel),
      )
    : beforeSettings.allowedChannels;

  if (allowedChannels.length === 0) {
    throw new Error("Select at least one outbound channel.");
  }

  const manualSignature = normalizeEmailSignatureSettings({
    ...beforeSettings.manualSignature,
    ...signaturePayload(updates.manualSignature),
    logoUrl:
      textValue(updates.manualSignatureLogoUrl) ??
      beforeSettings.manualSignature.logoUrl,
    logoWidthPx:
      numberValue(updates.manualSignatureLogoWidthPx) ??
      beforeSettings.manualSignature.logoWidthPx,
    text:
      textValue(updates.manualSignatureText) ??
      beforeSettings.manualSignature.text,
  });
  const aiGeneratedSignature = normalizeEmailSignatureSettings({
    ...beforeSettings.aiGeneratedSignature,
    ...signaturePayload(updates.aiGeneratedSignature),
    logoUrl:
      textValue(updates.aiGeneratedSignatureLogoUrl) ??
      beforeSettings.aiGeneratedSignature.logoUrl,
    logoWidthPx:
      numberValue(updates.aiGeneratedSignatureLogoWidthPx) ??
      beforeSettings.aiGeneratedSignature.logoWidthPx,
    text:
      textValue(updates.aiGeneratedSignatureText) ??
      beforeSettings.aiGeneratedSignature.text,
  });
  const settings = normalizeCommunicationSettings({
    ...beforeSettings,
    allowedChannels: [...new Set(allowedChannels)],
    approvalRequired:
      typeof updates.approvalRequired === "boolean"
        ? updates.approvalRequired
        : beforeSettings.approvalRequired,
    aiGeneratedSignature,
    businessSignature: manualSignature.text,
    manualSignature,
    useSeparateAiSignature:
      typeof updates.useSeparateAiSignature === "boolean"
        ? updates.useSeparateAiSignature
        : beforeSettings.useSeparateAiSignature,
  });

  await savePolicy(context, {
    action: "communication_settings.updated",
    beforePolicy,
    policyType: COMMUNICATION_POLICY_TYPE,
    settings,
  });
}

function signaturePayload(value: unknown) {
  const signature = objectRecord(value);
  const logoContentBase64 = textValue(signature.logoContentBase64);
  const logoSizeBytes = numberValue(signature.logoSizeBytes) ?? 0;

  if (logoContentBase64 && logoSizeBytes > MAX_SIGNATURE_LOGO_BYTES) {
    throw new Error("Signature logos are limited to 512 KB.");
  }

  return {
    logoContentBase64,
    logoContentType: textValue(signature.logoContentType),
    logoFilename: textValue(signature.logoFilename),
    logoSizeBytes,
    logoUrl: textValue(signature.logoUrl),
    logoWidthPx: numberValue(signature.logoWidthPx),
    text: textValue(signature.text),
  };
}

async function updateInboundEmailSettings(
  context: MobileContext,
  updates: Record<string, unknown>,
) {
  const beforePolicy = await loadPolicy(context, INBOUND_EMAIL_POLICY_TYPE);
  const beforeSettings = normalizeInboundEmailSettings(beforePolicy?.settings);
  const settings = normalizeInboundEmailSettings({
    ...beforeSettings,
    actionInstructions:
      textValue(updates.actionInstructions) ?? beforeSettings.actionInstructions,
    includeAwarenessEvents:
      typeof updates.includeAwarenessEvents === "boolean"
        ? updates.includeAwarenessEvents
        : beforeSettings.includeAwarenessEvents,
    lookbackDays: numberValue(updates.lookbackDays) ?? beforeSettings.lookbackDays,
    maxMessagesPerSync:
      numberValue(updates.maxMessagesPerSync) ??
      beforeSettings.maxMessagesPerSync,
    pollIntervalMinutes:
      numberValue(updates.pollIntervalMinutes) ??
      beforeSettings.pollIntervalMinutes,
    quietHoursEnabled:
      typeof updates.quietHoursEnabled === "boolean"
        ? updates.quietHoursEnabled
        : beforeSettings.quietHoursEnabled,
    quietHoursEnd:
      textValue(updates.quietHoursEnd) ?? beforeSettings.quietHoursEnd,
    quietHoursStart:
      textValue(updates.quietHoursStart) ?? beforeSettings.quietHoursStart,
    syncMode:
      typeof updates.syncMode === "string" &&
      INBOUND_EMAIL_SYNC_MODES.includes(
        updates.syncMode as (typeof INBOUND_EMAIL_SYNC_MODES)[number],
      )
        ? updates.syncMode
        : beforeSettings.syncMode,
  });

  await savePolicy(context, {
    action: "inbound_email_settings.updated",
    beforePolicy,
    policyType: INBOUND_EMAIL_POLICY_TYPE,
    settings,
  });
}

function senderRuleMatchValue(value: unknown): InboundEmailSenderRule["match"] | null {
  return value === "email" || value === "domain" ? value : null;
}

function senderRuleActionValue(value: unknown) {
  return INBOUND_EMAIL_SENDER_RULE_ACTIONS.includes(
    value as (typeof INBOUND_EMAIL_SENDER_RULE_ACTIONS)[number],
  )
    ? (value as (typeof INBOUND_EMAIL_SENDER_RULE_ACTIONS)[number])
    : null;
}

async function upsertSenderRuleSettings(
  context: MobileContext,
  updates: Record<string, unknown>,
) {
  const beforePolicy = await loadPolicy(context, INBOUND_EMAIL_POLICY_TYPE);
  const beforeSettings = normalizeInboundEmailSettings(beforePolicy?.settings);
  const match = senderRuleMatchValue(updates.match);
  const action = senderRuleActionValue(updates.action);
  const value = match
    ? senderRuleTargetFromInput(textValue(updates.value), match)
    : null;

  if (!match || !action || !value) {
    throw new Error("Add a valid sender email or domain and action.");
  }

  const existingRule = beforeSettings.senderRules.find(
    (rule) => rule.match === match && rule.value === value,
  );
  const settings = upsertInboundEmailSenderRule(beforeSettings, {
    action,
    createdAt: existingRule?.createdAt ?? new Date().toISOString(),
    createdFromEventId: existingRule?.createdFromEventId ?? null,
    match,
    value,
  });

  await savePolicy(context, {
    action: existingRule
      ? "inbound_email.sender_rule_updated"
      : "inbound_email.sender_rule_created",
    beforePolicy,
    policyType: INBOUND_EMAIL_POLICY_TYPE,
    settings,
  });
}

async function removeSenderRuleSettings(
  context: MobileContext,
  updates: Record<string, unknown>,
) {
  const beforePolicy = await loadPolicy(context, INBOUND_EMAIL_POLICY_TYPE);
  const beforeSettings = normalizeInboundEmailSettings(beforePolicy?.settings);
  const match = senderRuleMatchValue(updates.match);
  const value = match
    ? senderRuleTargetFromInput(textValue(updates.value), match)
    : null;

  if (!match || !value) {
    throw new Error("Choose a valid sender rule to remove.");
  }

  const settings = removeInboundEmailSenderRule(beforeSettings, { match, value });

  await savePolicy(context, {
    action: "inbound_email.sender_rule_removed",
    beforePolicy,
    policyType: INBOUND_EMAIL_POLICY_TYPE,
    settings,
  });
}

async function updateVoiceSettings(
  context: MobileContext,
  updates: Record<string, unknown>,
) {
  const beforePolicy = await loadPolicy(context, VOICE_SETTINGS_POLICY_TYPE);
  const beforeSettings = normalizeVoiceSettings(beforePolicy?.settings);
  const openAiVoice =
    typeof updates.openAiVoice === "string" &&
    OPENAI_VOICE_OPTIONS.includes(
      updates.openAiVoice as (typeof OPENAI_VOICE_OPTIONS)[number],
    )
      ? updates.openAiVoice
      : beforeSettings.openAiVoice;
  const outboundVoicePronunciationPolicy =
    typeof updates.outboundVoicePronunciationPolicy === "string" &&
    OUTBOUND_VOICE_PRONUNCIATION_POLICIES.includes(
      updates.outboundVoicePronunciationPolicy as (typeof OUTBOUND_VOICE_PRONUNCIATION_POLICIES)[number],
    )
      ? updates.outboundVoicePronunciationPolicy
      : beforeSettings.outboundVoicePronunciationPolicy;
  const settings = normalizeVoiceSettings({
    ...beforeSettings,
    openAiVoice,
    outboundVoicePronunciationPolicy,
    provider: "openai",
  });

  await savePolicy(context, {
    action: "assistant_voice_settings.updated",
    beforePolicy,
    policyType: VOICE_SETTINGS_POLICY_TYPE,
    settings,
  });
}

async function updatePronunciationSettings(
  context: MobileContext,
  operation: string | null,
  updates: Record<string, unknown>,
) {
  const { supabase, user, workspace } = context;
  const phrase = textValue(updates.phrase) ?? "";
  const pronunciationHint =
    textValue(updates.pronunciationHint) ??
    defaultPronunciationHint(phrase) ??
    null;
  const aliases = Array.isArray(updates.aliases)
    ? updates.aliases
        .map((alias) => (typeof alias === "string" ? alias.trim() : ""))
        .filter(Boolean)
        .slice(0, 12)
    : splitPronunciationAliases(textValue(updates.aliasesText) ?? "");
  const category = pronunciationCategoryValue(updates.category);
  const status = pronunciationStatusValue(updates.status ?? "approved");

  if (operation === "remove") {
    const entryId = textValue(updates.entryId);

    if (!entryId || !phrase) {
      throw new Error("Choose a pronunciation entry to remove.");
    }

    const entry = await updatePronunciationEntry({
      aliases,
      category,
      entryId,
      phrase,
      pronunciationHint,
      status: "ignored",
      supabase,
      user,
      workspaceId: workspace.id,
    });

    await insertAuditLog(supabase, {
      action: "assistant_pronunciation.ignored",
      actorId: user.id,
      actorType: "user",
      after: { entry },
      entityId: entry.id,
      entityType: "assistant_pronunciation",
      workspaceId: workspace.id,
    });
    return;
  }

  if (!phrase) {
    throw new Error("Add a pronunciation phrase first.");
  }

  const entryId = textValue(updates.entryId);
  const entry = entryId
    ? await updatePronunciationEntry({
        aliases,
        category,
        entryId,
        phrase,
        pronunciationHint,
        status,
        supabase,
        user,
        workspaceId: workspace.id,
      })
    : await upsertPronunciationEntry({
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
    action: entryId
      ? "assistant_pronunciation.updated"
      : "assistant_pronunciation.created",
    actorId: user.id,
    actorType: "user",
    after: { entry },
    entityId: entry.id,
    entityType: "assistant_pronunciation",
    workspaceId: workspace.id,
  });
}

async function loadPolicy({ supabase, workspace }: MobileContext, policyType: string) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", policyType)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as PolicyRow | null;
}

async function savePolicy(
  { supabase, user, workspace }: MobileContext,
  {
    action,
    beforePolicy,
    policyType,
    settings,
  }: {
    action: string;
    beforePolicy: PolicyRow | null;
    policyType: string;
    settings: unknown;
  },
) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: policyType,
        settings,
        workspace_id: workspace.id,
      },
      { onConflict: "workspace_id,policy_type" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to save settings.");
  }

  await insertAuditLog(supabase, {
    action,
    actorId: user.id,
    actorType: "user",
    after: { settings },
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    entityId: String(data.id),
    entityType: "workspace_policy",
    workspaceId: workspace.id,
  });
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

function assertValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
  } catch {
    throw new Error(
      "Enter a valid IANA timezone such as Australia/Brisbane, America/Denver, or UTC.",
    );
  }
}

function integrationStatusLabel(overview: {
  configured: boolean;
  connections: Array<{ status: string }>;
  encryptionReady: boolean;
  error: string | null;
  migrationReady: boolean;
}) {
  if (overview.error) {
    return "Needs attention";
  }

  if (!overview.migrationReady) {
    return "Needs migration";
  }

  if (!overview.configured || !overview.encryptionReady) {
    return "Setup needed";
  }

  if (overview.connections.some((connection) => connection.status === "connected")) {
    return "Connected";
  }

  return overview.connections.length ? "Disconnected" : "Ready to connect";
}

function developerEnabled(user: MobileContext["user"]) {
  const metadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? (user.app_metadata as Record<string, unknown>)
      : {};
  const value = metadata.developer ?? metadata.mobileDeveloper;

  return value === true || value === "true" || value === "yes" || value === 1;
}
