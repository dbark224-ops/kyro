import type { SupabaseClient, User } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
} from "../billing/display-currency";
import {
  DEFAULT_INBOUND_EMAIL_SETTINGS,
  INBOUND_EMAIL_POLICY_TYPE,
  normalizeInboundEmailSettings,
  removeInboundEmailSenderRule,
  senderRuleTargetFromEmail,
  senderRuleTargetFromInput,
  upsertInboundEmailSenderRule,
  type InboundEmailSettings,
  type InboundEmailSenderRule,
} from "../integrations/inbound-email-settings";
import {
  DOCUMENT_ACCENT_THEMES,
  DOCUMENT_CURRENCIES,
  DOCUMENT_TEMPLATE_POLICY_TYPE,
  normalizeDocumentTemplateSettings,
  type DocumentTemplateSettings,
} from "../documents/settings";
import {
  OPENAI_VOICE_OPTIONS,
  OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
  VOICE_SETTINGS_POLICY_TYPE,
  normalizeVoiceSettings,
  type OpenAiVoice,
  type OutboundVoicePronunciationPolicy,
  type VoiceSettings,
} from "./voice-settings";
import {
  WORKSPACE_GENERAL_POLICY_TYPE,
  normalizeWorkspaceGeneralSettings,
  type WorkspaceGeneralSettings,
} from "../workspace/general-settings";
import type { AssistantCommandResult } from "./types";

type WorkspaceInput = {
  id: string;
  name: string;
};

type SettingsUpdateInput = {
  prompt: string;
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceInput;
};

type SettingsSection = "documents" | "general" | "integrations" | "voice";

export type ParsedSettingChange = {
  documentSettings: Partial<DocumentTemplateSettings>;
  generalSettings: Partial<WorkspaceGeneralSettings>;
  labels: string[];
  senderRule: InboundEmailSenderRule | null;
  senderRuleRemoval: Pick<InboundEmailSenderRule, "match" | "value"> | null;
  settings: Partial<InboundEmailSettings>;
  targetSections: SettingsSection[];
  voiceSettings: Partial<VoiceSettings>;
};

const POLL_INTERVALS = [5, 15, 30, 60];

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/:_\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberNear(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  const value = match ? Number(match[1]) : null;

  return Number.isFinite(value) ? value : null;
}

function uniqueSections(sections: SettingsSection[]) {
  return [...new Set(sections)];
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());

    return true;
  } catch {
    return false;
  }
}

function extractTimeZone(prompt: string) {
  const match = prompt.match(
    /\b(?:timezone|time zone)\b.*?\b(?:to|as|is)\s+([A-Za-z_]+\/[A-Za-z0-9_+\-]+|UTC)\b/i,
  );
  const candidate = match?.[1]?.trim();

  return candidate && validTimeZone(candidate) ? candidate : null;
}

function toTwentyFourHour(hour: number, minute: number, suffix: string | null) {
  let normalizedHour = hour;

  if (suffix === "pm" && normalizedHour < 12) {
    normalizedHour += 12;
  }

  if (suffix === "am" && normalizedHour === 12) {
    normalizedHour = 0;
  }

  if (normalizedHour < 0 || normalizedHour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractTimes(prompt: string) {
  return Array.from(
    prompt.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi),
  )
    .map((match) =>
      toTwentyFourHour(
        Number(match[1]),
        match[2] ? Number(match[2]) : 0,
        match[3]?.toLowerCase() ?? null,
      ),
    )
    .filter((value): value is string => Boolean(value));
}

function onOff(text: string) {
  if (/\b(turn|switch|set|make)\b.{0,48}\boff\b/.test(text) || /\bdisable\b/.test(text)) {
    return false;
  }

  if (/\b(turn|switch|set|make)\b.{0,48}\bon\b/.test(text) || /\benable\b/.test(text)) {
    return true;
  }

  return null;
}

function extractPollInterval(text: string) {
  if (!/\b(poll|polling|frequency|interval|sync)\b/.test(text)) {
    return null;
  }

  const minutes = numberNear(text, /\b(\d{1,2})\s*(?:min|mins|minute|minutes)\b/);

  return minutes && POLL_INTERVALS.includes(minutes) ? minutes : null;
}

function extractMode(text: string) {
  if (/\bmanual only\b/.test(text)) {
    return "manual_only" as const;
  }

  if (/\b(paused|pause|stop)\b/.test(text) && /\b(email|inbox|sync|polling)\b/.test(text) && !text.includes("quiet")) {
    return "paused" as const;
  }

  if (/\b(automatic|auto|resume|scheduled)\b/.test(text) && /\b(email|inbox|sync|polling)\b/.test(text)) {
    return "automatic" as const;
  }

  return null;
}

function extractOpenAiVoice(text: string): OpenAiVoice | null {
  if (!/\b(voice|speak|speaker|assistant voice)\b/.test(text)) {
    return null;
  }

  return (
    OPENAI_VOICE_OPTIONS.find((voice) => new RegExp(`\\b${voice}\\b`, "i").test(text)) ??
    null
  );
}

function extractPronunciationPolicy(text: string): OutboundVoicePronunciationPolicy | null {
  if (!/\b(pronunciation|pronounce|customer voice|outbound voice)\b/.test(text)) {
    return null;
  }

  if (/\b(off|disable|disabled|no pronunciation)\b/.test(text)) {
    return "off";
  }

  return (
    OUTBOUND_VOICE_PRONUNCIATION_POLICIES.find((policy) =>
      new RegExp(`\\b${policy}\\b`, "i").test(text),
    ) ?? null
  );
}

function extractInboundActionInstructions(prompt: string) {
  const match = prompt.match(
    /\b(?:set|change|update|use|make)\b\s+(?:the\s+)?(?:(?:inbound\s+)?email|inbox|crm promotion)\s+(?:action\s+)?rules?\s+(?:to|as)\s+([\s\S]+)$/i,
  );
  const value = match?.[1]?.trim().replace(/[.\s]+$/, "");

  return value && value.length >= 12 ? value : null;
}

function cleanInstruction(value: string | undefined) {
  const cleaned = value
    ?.trim()
    .replace(/\s+/g, " ")
    .split(
      /\.\s+(?=(?:set|change|update|turn|make|use|enable|disable|switch)\b)/i,
    )[0]
    ?.replace(/[.\s]+$/, "");

  return cleaned && cleaned.length >= 3 ? cleaned : null;
}

function extractDocumentTemplateDirection(prompt: string) {
  const match = prompt.match(
    /\b(?:set|change|update|use|make)\b\s+(?:the\s+)?(?:(?:quote|document)\s+)?template\s+(?:direction|style|design|look|feel)\s+(?:to|as)\s+([\s\S]+)$/i,
  );

  return cleanInstruction(match?.[1]);
}

function extractDocumentPaymentTerms(prompt: string) {
  const match = prompt.match(
    /\b(?:set|change|update|use|make)\b\s+(?:the\s+)?(?:quote|document)?\s*payment\s+terms?\s+(?:to|as)\s+([\s\S]+)$/i,
  );

  return cleanInstruction(match?.[1]);
}

function extractDocumentFooterText(prompt: string) {
  const match = prompt.match(
    /\b(?:set|change|update|use|make)\b\s+(?:the\s+)?(?:quote|document)?\s*footer(?:\s+text)?\s+(?:to|as)\s+([\s\S]+)$/i,
  );

  return cleanInstruction(match?.[1]);
}

function extractDocumentCurrency(text: string) {
  if (!/\b(quote|document|invoice|template)\b/.test(text)) {
    return null;
  }

  return (
    DOCUMENT_CURRENCIES.find((currency) =>
      new RegExp(`\\b${currency.toLowerCase()}\\b`).test(text),
    ) ?? null
  );
}

function extractWorkspaceDisplayCurrency(text: string): DisplayCurrency | null {
  if (
    !/\b(display currency|app currency|usage currency|billing currency|workspace currency|default currency|view(?:ing)? currency|currency view)\b/.test(
      text,
    )
  ) {
    return null;
  }

  return (
    DISPLAY_CURRENCIES.find((currency) =>
      new RegExp(`\\b${currency.toLowerCase()}\\b`).test(text),
    ) ?? null
  );
}

function extractDocumentAccentTheme(text: string) {
  if (!/\b(quote|document|template|accent|colour|color|theme)\b/.test(text)) {
    return null;
  }

  return (
    DOCUMENT_ACCENT_THEMES.find((theme) =>
      new RegExp(`\\b${theme}\\b`).test(text),
    ) ?? null
  );
}

function extractDocumentValidityDays(text: string) {
  if (!/\b(quote|document|template|valid|validity)\b/.test(text)) {
    return null;
  }

  const days = numberNear(
    text,
    /\b(?:valid|validity|valid for|valid days?)\b.{0,24}\b(\d{1,2})\s*(?:day|days)\b/,
  );

  return days && days >= 1 && days <= 90 ? days : null;
}

function extractSenderRule(
  prompt: string,
  text: string,
): InboundEmailSenderRule | null {
  if (!/\b(sender|email|emails|inbox|mail|domain)\b/.test(text)) {
    return null;
  }

  if (
    /\b(remove|delete|clear|unset)\b/.test(text) ||
    /\bstop\s+(?:treating|ignoring)\b/.test(text)
  ) {
    return null;
  }

  const email =
    prompt.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ??
    null;
  const emailValue = senderRuleTargetFromEmail(email, "email");
  const domain =
    prompt.match(/\b(?:domain|from|sender)\s+([A-Z0-9.-]+\.[A-Z]{2,})\b/i)?.[1] ??
    null;
  const domainValue = senderRuleTargetFromInput(domain, "domain");
  const ruleTarget = emailValue
    ? { match: "email" as const, value: emailValue }
    : domainValue
      ? { match: "domain" as const, value: domainValue }
      : null;

  if (!ruleTarget) {
    return null;
  }

  if (/\b(ignore|skip|noise|not relevant|not work|not business)\b/.test(text)) {
    return {
      action: "always_ignore",
      ...ruleTarget,
    };
  }

  if (/\b(relevant|business|work|promote|important)\b/.test(text)) {
    return {
      action: "always_promote",
      ...ruleTarget,
    };
  }

  return null;
}

function extractSenderRuleRemoval(
  prompt: string,
  text: string,
): Pick<InboundEmailSenderRule, "match" | "value"> | null {
  if (!/\b(sender|email|emails|inbox|mail|domain)\b/.test(text)) {
    return null;
  }

  if (
    !(
      /\b(remove|delete|clear|unset)\b/.test(text) ||
      /\bstop\s+(?:treating|ignoring)\b/.test(text)
    )
  ) {
    return null;
  }

  const email =
    prompt.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ??
    null;
  const emailValue = senderRuleTargetFromInput(email, "email");

  if (emailValue) {
    return {
      match: "email",
      value: emailValue,
    };
  }

  const domain =
    prompt.match(/\b(?:domain|from|sender)\s+([A-Z0-9.-]+\.[A-Z]{2,})\b/i)?.[1] ??
    null;
  const domainValue = senderRuleTargetFromInput(domain, "domain");

  return domainValue
    ? {
        match: "domain",
        value: domainValue,
      }
    : null;
}

export function parseAssistantEditableSettingChanges(
  prompt: string,
): ParsedSettingChange {
  const text = normalized(prompt);
  const labels: string[] = [];
  const documentSettings: Partial<DocumentTemplateSettings> = {};
  const generalSettings: Partial<WorkspaceGeneralSettings> = {};
  const settings: Partial<InboundEmailSettings> = {};
  const voiceSettings: Partial<VoiceSettings> = {};
  const targetSections: SettingsSection[] = [];
  const timeZone = extractTimeZone(prompt);
  const syncMode = extractMode(text);
  const pollInterval = extractPollInterval(text);
  const openAiVoice = extractOpenAiVoice(text);
  const pronunciationPolicy = extractPronunciationPolicy(text);
  const actionInstructions = extractInboundActionInstructions(prompt);
  const documentTemplateDirection = extractDocumentTemplateDirection(prompt);
  const documentPaymentTerms = extractDocumentPaymentTerms(prompt);
  const documentFooterText = extractDocumentFooterText(prompt);
  const documentCurrency = extractDocumentCurrency(text);
  const displayCurrency = extractWorkspaceDisplayCurrency(text);
  const documentAccentTheme = extractDocumentAccentTheme(text);
  const documentValidityDays = extractDocumentValidityDays(text);
  const senderRuleRemoval = extractSenderRuleRemoval(prompt, text);
  const senderRule = senderRuleRemoval ? null : extractSenderRule(prompt, text);

  if (timeZone) {
    generalSettings.timeZone = timeZone;
    settings.timeZone = timeZone;
    labels.push(`workspace timezone to ${timeZone}`);
    targetSections.push("general");
  }

  if (displayCurrency) {
    generalSettings.displayCurrency = displayCurrency;
    labels.push(`display currency to ${displayCurrency}`);
    targetSections.push("general");
  }

  if (syncMode) {
    settings.syncMode = syncMode;
    labels.push(
      syncMode === "automatic"
        ? "inbound email sync to automatic polling"
        : syncMode === "manual_only"
          ? "inbound email sync to manual only"
          : "inbound email sync to paused",
    );
    targetSections.push("integrations");
  }

  if (pollInterval) {
    settings.pollIntervalMinutes = pollInterval;
    labels.push(`daytime email polling to every ${pollInterval} minutes`);
    targetSections.push("integrations");
  }

  if (text.includes("quiet")) {
    const enabled = onOff(text);
    const times = extractTimes(prompt);

    if (enabled !== null) {
      settings.quietHoursEnabled = enabled;
      labels.push(`${enabled ? "enabled" : "disabled"} quiet hours`);
      targetSections.push("integrations");
    }

    if (text.includes("same as daytime") || text.includes("same interval") || text.includes("emergency")) {
      settings.quietHoursMode = "same_interval";
      labels.push("quiet-hours behaviour to same as daytime");
      targetSections.push("integrations");
    } else if (text.includes("pause") || text.includes("stop")) {
      settings.quietHoursMode = "paused";
      labels.push("quiet-hours behaviour to pause scheduled polling");
      targetSections.push("integrations");
    }

    if (times.length >= 2) {
      settings.quietHoursStart = times[0];
      settings.quietHoursEnd = times[1];
      labels.push(`quiet hours to ${times[0]}-${times[1]}`);
      targetSections.push("integrations");
    } else if (times.length === 1 && /\b(start|begin)\b/.test(text)) {
      settings.quietHoursStart = times[0];
      labels.push(`quiet-hours start to ${times[0]}`);
      targetSections.push("integrations");
    } else if (times.length === 1 && /\b(end|finish|until)\b/.test(text)) {
      settings.quietHoursEnd = times[0];
      labels.push(`quiet-hours end to ${times[0]}`);
      targetSections.push("integrations");
    }
  }

  if (text.includes("lookback") || text.includes("missed mail")) {
    const days = numberNear(text, /\b(\d{1,2})\s*(?:day|days|d)\b/);

    if (days) {
      settings.lookbackDays = days;
      labels.push(`missed-mail lookback to ${days} day${days === 1 ? "" : "s"}`);
      targetSections.push("integrations");
    }
  }

  if (text.includes("fetch cap") || text.includes("max messages") || text.includes("message cap")) {
    const maxMessages = numberNear(
      text,
      /\b(?:fetch cap|max messages|message cap)(?:\s+(?:to|of|at))?\s+(\d{1,2})\b/,
    );

    if (maxMessages) {
      settings.maxMessagesPerSync = maxMessages;
      labels.push(`fetch cap to ${maxMessages} messages per sync`);
      targetSections.push("integrations");
    }
  }

  if (text.includes("skipped") || text.includes("awareness") || text.includes("summary") || text.includes("summaries")) {
    const enabled = onOff(text);

    if (enabled !== null) {
      settings.includeAwarenessEvents = enabled;
      labels.push(`${enabled ? "enabled" : "disabled"} skipped-mail summaries`);
      targetSections.push("integrations");
    }
  }

  if (actionInstructions) {
    settings.actionInstructions = actionInstructions;
    labels.push("inbound email action rules");
    targetSections.push("integrations");
  }

  if (senderRule) {
    labels.push(
      senderRule.action === "always_promote"
        ? `future emails from ${senderRule.value} as relevant`
        : `future emails from ${senderRule.value} as ignored`,
    );
    targetSections.push("integrations");
  }

  if (senderRuleRemoval) {
    labels.push(`removed sender rule for ${senderRuleRemoval.value}`);
    targetSections.push("integrations");
  }

  if (openAiVoice) {
    voiceSettings.openAiVoice = openAiVoice;
    labels.push(`assistant voice to ${openAiVoice}`);
    targetSections.push("voice");
  }

  if (pronunciationPolicy) {
    voiceSettings.outboundVoicePronunciationPolicy = pronunciationPolicy;
    labels.push(`outbound pronunciation policy to ${pronunciationPolicy}`);
    targetSections.push("voice");
  }

  if (documentTemplateDirection) {
    documentSettings.quoteStyleDirection = documentTemplateDirection;
    labels.push("quote template direction");
    targetSections.push("documents");
  }

  if (documentPaymentTerms) {
    documentSettings.paymentTerms = documentPaymentTerms;
    labels.push("quote payment terms");
    targetSections.push("documents");
  }

  if (documentFooterText) {
    documentSettings.footerText = documentFooterText;
    labels.push("quote footer text");
    targetSections.push("documents");
  }

  if (documentCurrency) {
    documentSettings.currency = documentCurrency;
    labels.push(`quote currency to ${documentCurrency}`);
    targetSections.push("documents");
  }

  if (documentAccentTheme) {
    documentSettings.accentTheme = documentAccentTheme;
    labels.push(`quote accent to ${documentAccentTheme}`);
    targetSections.push("documents");
  }

  if (documentValidityDays) {
    documentSettings.validityDays = documentValidityDays;
    labels.push(`quote validity to ${documentValidityDays} days`);
    targetSections.push("documents");
  }

  if (text.includes("prepared by") && text.includes("footer")) {
    const enabled = onOff(text);

    if (enabled !== null) {
      documentSettings.showPreparedBy = enabled;
      labels.push(`${enabled ? "show" : "hide"} prepared-by footer`);
      targetSections.push("documents");
    }
  }

  return {
    documentSettings,
    generalSettings,
    labels,
    senderRule,
    senderRuleRemoval,
    settings,
    targetSections: uniqueSections(targetSections),
    voiceSettings,
  };
}

export function looksLikeSettingsUpdatePrompt(prompt: string) {
  const text = normalized(prompt);
  const hasMutationVerb =
    /\b(change|set|switch|turn|update|enable|disable|make|use|remove|delete|clear|unset|stop)\b/.test(
      text,
    );
  const hasSettingTarget =
    /\b(timezone|time zone|display currency|app currency|usage currency|billing currency|workspace currency|default currency|currency view|quiet|poll|polling|sync mode|manual only|lookback|fetch cap|max messages|skipped|awareness|summaries|voice|pronunciation|pronounce|email rules|inbox rules|action rules|crm promotion rules|sender|emails from|quote template|document template|quote payment|document payment|quote footer|document footer|quote currency|document currency|quote accent|document accent|quote validity|document validity|prepared by footer)\b/.test(text);

  return hasMutationVerb && hasSettingTarget;
}

function settingsLinks(sections: SettingsSection[]) {
  const links = {
    documents: {
      href: "/documents",
      label: "Documents",
      meta: "Quote template direction",
    },
    general: {
      href: "/settings?section=general",
      label: "General settings",
      meta: "Timezone and display currency",
    },
    integrations: {
      href: "/settings?section=integrations",
      label: "Connected accounts",
      meta: "Inbound email settings",
    },
    voice: {
      href: "/settings?section=voice",
      label: "Voice assistant",
      meta: "Voice and pronunciation settings",
    },
  } satisfies Record<SettingsSection, { href: string; label: string; meta: string }>;

  return sections.map((section) => links[section]);
}

export async function updateAssistantEditableSettings({
  prompt,
  supabase,
  user,
  workspace,
}: SettingsUpdateInput): Promise<AssistantCommandResult> {
  const parsed = parseAssistantEditableSettingChanges(prompt);

  if (parsed.labels.length === 0) {
    return {
      context: {
        editableSettings: [
          "workspace timezone",
          "display currency",
          "inbound email sync mode",
          "daytime poll frequency",
          "quiet hours",
          "missed-mail lookback",
          "fetch cap per sync",
          "skipped-mail summaries",
          "inbound email action rules",
          "sender relevance rules when an explicit email address or domain is provided",
          "assistant voice",
          "outbound pronunciation policy",
          "quote document template direction",
          "quote currency",
          "quote payment terms",
          "quote footer text",
        ],
        reason: "The prompt looked like a settings update, but no supported value could be parsed.",
      },
      fallbackAnswer:
        "I can edit safe settings like timezone, display currency, email polling, quiet hours, missed-mail lookback, fetch cap, skipped-mail summaries, inbound email action rules, explicit sender relevance rules, assistant voice, outbound pronunciation policy, and quote document template settings. I could not confidently read the new value from that request.",
      intent: "settings_update",
      links: settingsLinks(["general", "integrations", "voice", "documents"]),
      title: "Settings update",
    };
  }

  const changedPolicyIds: string[] = [];
  let documentSnapshot: DocumentTemplateSettings | null = null;
  let generalSnapshot: WorkspaceGeneralSettings | null = null;
  let inboundSnapshot: InboundEmailSettings | null = null;
  let voiceSnapshot: VoiceSettings | null = null;

  if (Object.keys(parsed.generalSettings).length > 0) {
    const [beforeGeneralResult, beforeInboundResult] = await Promise.all([
      supabase
        .from("workspace_policies")
        .select("id,settings")
        .eq("workspace_id", workspace.id)
        .eq("policy_type", WORKSPACE_GENERAL_POLICY_TYPE)
        .maybeSingle(),
      supabase
        .from("workspace_policies")
        .select("settings")
        .eq("workspace_id", workspace.id)
        .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
        .maybeSingle(),
    ]);

    if (beforeGeneralResult.error) {
      throw new Error(
        `Unable to load workspace defaults: ${beforeGeneralResult.error.message}`,
      );
    }

    if (beforeInboundResult.error) {
      throw new Error(
        `Unable to load workspace timezone fallback: ${beforeInboundResult.error.message}`,
      );
    }

    const inboundSettings = normalizeInboundEmailSettings(
      beforeInboundResult.data?.settings,
    );
    const beforeSettings = normalizeWorkspaceGeneralSettings(
      beforeGeneralResult.data?.settings,
      { timeZone: inboundSettings.timeZone },
    );
    const settings = normalizeWorkspaceGeneralSettings({
      ...beforeSettings,
      ...parsed.generalSettings,
    });
    const { data: savedPolicy, error: saveError } = await supabase
      .from("workspace_policies")
      .upsert(
        {
          policy_type: WORKSPACE_GENERAL_POLICY_TYPE,
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
      throw new Error(
        `Unable to update workspace defaults: ${saveError?.message ?? "unknown error"}`,
      );
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "assistant_general_settings.updated",
      actorId: user.id,
      actorType: "ai",
      after: { settings },
      before: beforeGeneralResult.data
        ? { settings: beforeGeneralResult.data.settings }
        : null,
      entityId: String(savedPolicy.id),
      entityType: "workspace_policy",
      metadata: {
        assistantPrompt: prompt,
        changed: parsed.labels,
        policyType: WORKSPACE_GENERAL_POLICY_TYPE,
        requestedByUserId: user.id,
      },
    });

    changedPolicyIds.push(String(savedPolicy.id));
    generalSnapshot = settings;
  }

  if (
    Object.keys(parsed.settings).length > 0 ||
    parsed.senderRule ||
    parsed.senderRuleRemoval
  ) {
    const { data: beforePolicy, error: beforeError } = await supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
      .maybeSingle();

    if (beforeError) {
      throw new Error(`Unable to load workspace settings: ${beforeError.message}`);
    }

    const beforeSettings = normalizeInboundEmailSettings(beforePolicy?.settings);
    const mergedSettings = normalizeInboundEmailSettings({
      ...beforeSettings,
      ...parsed.settings,
      autoPromoteActionable: true,
    });
    const settingsBeforeSenderUpsert = parsed.senderRuleRemoval
      ? removeInboundEmailSenderRule(mergedSettings, parsed.senderRuleRemoval)
      : mergedSettings;
    const settings = parsed.senderRule
      ? upsertInboundEmailSenderRule(settingsBeforeSenderUpsert, {
          ...parsed.senderRule,
          createdAt: new Date().toISOString(),
        })
      : settingsBeforeSenderUpsert;
    const { data: savedPolicy, error: saveError } = await supabase
      .from("workspace_policies")
      .upsert(
        {
          policy_type: INBOUND_EMAIL_POLICY_TYPE,
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
      throw new Error(
        `Unable to update workspace settings: ${saveError?.message ?? "unknown error"}`,
      );
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "assistant_settings.updated",
      actorId: user.id,
      actorType: "ai",
      after: { settings },
      before: beforePolicy ? { settings: beforePolicy.settings } : null,
      entityId: String(savedPolicy.id),
      entityType: "workspace_policy",
      metadata: {
        assistantPrompt: prompt,
        changed: parsed.labels,
        policyType: INBOUND_EMAIL_POLICY_TYPE,
        requestedByUserId: user.id,
      },
    });

    changedPolicyIds.push(String(savedPolicy.id));
    inboundSnapshot = settings;
  }

  if (Object.keys(parsed.voiceSettings).length > 0) {
    const { data: beforePolicy, error: beforeError } = await supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", VOICE_SETTINGS_POLICY_TYPE)
      .maybeSingle();

    if (beforeError) {
      throw new Error(`Unable to load voice settings: ${beforeError.message}`);
    }

    const beforeSettings = normalizeVoiceSettings(beforePolicy?.settings);
    const settings = normalizeVoiceSettings({
      ...beforeSettings,
      ...parsed.voiceSettings,
      provider: "openai",
    });
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
      throw new Error(
        `Unable to update voice settings: ${saveError?.message ?? "unknown error"}`,
      );
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "assistant_voice_settings.updated",
      actorId: user.id,
      actorType: "ai",
      after: { settings },
      before: beforePolicy ? { settings: beforePolicy.settings } : null,
      entityId: String(savedPolicy.id),
      entityType: "workspace_policy",
      metadata: {
        assistantPrompt: prompt,
        changed: parsed.labels,
        policyType: VOICE_SETTINGS_POLICY_TYPE,
        requestedByUserId: user.id,
      },
    });

    changedPolicyIds.push(String(savedPolicy.id));
    voiceSnapshot = settings;
  }

  if (Object.keys(parsed.documentSettings).length > 0) {
    const { data: beforePolicy, error: beforeError } = await supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
      .maybeSingle();

    if (beforeError) {
      throw new Error(
        `Unable to load document template settings: ${beforeError.message}`,
      );
    }

    const beforeSettings = normalizeDocumentTemplateSettings(
      beforePolicy?.settings,
    );
    const settings = normalizeDocumentTemplateSettings({
      ...beforeSettings,
      ...parsed.documentSettings,
    });
    const { data: savedPolicy, error: saveError } = await supabase
      .from("workspace_policies")
      .upsert(
        {
          policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
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
      throw new Error(
        `Unable to update document template settings: ${saveError?.message ?? "unknown error"}`,
      );
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "assistant_document_template_settings.updated",
      actorId: user.id,
      actorType: "ai",
      after: { settings },
      before: beforePolicy ? { settings: beforePolicy.settings } : null,
      entityId: String(savedPolicy.id),
      entityType: "workspace_policy",
      metadata: {
        assistantPrompt: prompt,
        changed: parsed.labels,
        policyType: DOCUMENT_TEMPLATE_POLICY_TYPE,
        requestedByUserId: user.id,
      },
    });

    changedPolicyIds.push(String(savedPolicy.id));
    documentSnapshot = settings;
  }

  return {
    context: {
      changed: parsed.labels,
      settingsSnapshot: {
        documents: documentSnapshot
          ? {
              accentTheme: documentSnapshot.accentTheme,
              currency: documentSnapshot.currency,
              paymentTerms: documentSnapshot.paymentTerms,
              quoteStyleDirection: documentSnapshot.quoteStyleDirection,
              showPreparedBy: documentSnapshot.showPreparedBy,
              validityDays: documentSnapshot.validityDays,
            }
          : null,
        general: generalSnapshot
          ? {
              displayCurrency: generalSnapshot.displayCurrency,
              exchangeRateProvider: generalSnapshot.exchangeRateProvider,
              timeZone: generalSnapshot.timeZone,
            }
          : null,
        inboundEmail: inboundSnapshot
          ? {
              actionInstructions: inboundSnapshot.actionInstructions,
              includeAwarenessEvents: inboundSnapshot.includeAwarenessEvents,
              lookbackDays: inboundSnapshot.lookbackDays,
              maxMessagesPerSync: inboundSnapshot.maxMessagesPerSync,
              pollIntervalMinutes: inboundSnapshot.pollIntervalMinutes,
              quietHoursEnabled: inboundSnapshot.quietHoursEnabled,
              quietHoursEnd: inboundSnapshot.quietHoursEnd,
              quietHoursMode: inboundSnapshot.quietHoursMode,
              quietHoursStart: inboundSnapshot.quietHoursStart,
              syncMode: inboundSnapshot.syncMode,
              timeZone: inboundSnapshot.timeZone,
            }
          : null,
        voice: voiceSnapshot
          ? {
              openAiVoice: voiceSnapshot.openAiVoice,
              outboundVoicePronunciationPolicy:
                voiceSnapshot.outboundVoicePronunciationPolicy,
            }
          : null,
      },
    },
    fallbackAnswer: `I updated ${parsed.labels.join(", ")}.`,
    intent: "settings_update",
    links: settingsLinks(parsed.targetSections.length ? parsed.targetSections : ["integrations"]),
    mutation: {
      entityId: changedPolicyIds.join(","),
      entityType: "workspace_policy",
      label: "Settings updated",
    },
    title: "Settings update",
  };
}

export function defaultEditableSettingsSummary() {
  return DEFAULT_INBOUND_EMAIL_SETTINGS;
}
