import type { SupabaseClient, User } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  DEFAULT_INBOUND_EMAIL_SETTINGS,
  INBOUND_EMAIL_POLICY_TYPE,
  normalizeInboundEmailSettings,
  type InboundEmailSettings,
} from "../integrations/inbound-email-settings";
import {
  OPENAI_VOICE_OPTIONS,
  OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
  VOICE_SETTINGS_POLICY_TYPE,
  normalizeVoiceSettings,
  type OpenAiVoice,
  type OutboundVoicePronunciationPolicy,
  type VoiceSettings,
} from "./voice-settings";
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

type SettingsSection = "general" | "integrations" | "voice";

export type ParsedSettingChange = {
  labels: string[];
  settings: Partial<InboundEmailSettings>;
  targetSections: SettingsSection[];
  voiceSettings: Partial<VoiceSettings>;
};

const POLL_INTERVALS = [5, 15, 30, 60];

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9/:_\s-]/g, " ").replace(/\s+/g, " ").trim();
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

export function parseAssistantEditableSettingChanges(
  prompt: string,
): ParsedSettingChange {
  const text = normalized(prompt);
  const labels: string[] = [];
  const settings: Partial<InboundEmailSettings> = {};
  const voiceSettings: Partial<VoiceSettings> = {};
  const targetSections: SettingsSection[] = [];
  const timeZone = extractTimeZone(prompt);
  const syncMode = extractMode(text);
  const pollInterval = extractPollInterval(text);
  const openAiVoice = extractOpenAiVoice(text);
  const pronunciationPolicy = extractPronunciationPolicy(text);
  const actionInstructions = extractInboundActionInstructions(prompt);

  if (timeZone) {
    settings.timeZone = timeZone;
    labels.push(`workspace timezone to ${timeZone}`);
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

  return {
    labels,
    settings,
    targetSections: uniqueSections(targetSections),
    voiceSettings,
  };
}

export function looksLikeSettingsUpdatePrompt(prompt: string) {
  const text = normalized(prompt);
  const hasMutationVerb = /\b(change|set|switch|turn|update|enable|disable|make|use)\b/.test(text);
  const hasSettingTarget =
    /\b(timezone|time zone|quiet|poll|polling|sync mode|manual only|lookback|fetch cap|max messages|skipped|awareness|summaries|voice|pronunciation|pronounce|email rules|inbox rules|action rules|crm promotion rules)\b/.test(text);

  return hasMutationVerb && hasSettingTarget;
}

function settingsLinks(sections: SettingsSection[]) {
  const links = {
    general: {
      href: "/settings?section=general",
      label: "General settings",
      meta: "Timezone",
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
          "inbound email sync mode",
          "daytime poll frequency",
          "quiet hours",
          "missed-mail lookback",
          "fetch cap per sync",
          "skipped-mail summaries",
          "inbound email action rules",
          "assistant voice",
          "outbound pronunciation policy",
        ],
        reason: "The prompt looked like a settings update, but no supported value could be parsed.",
      },
      fallbackAnswer:
        "I can edit safe settings like timezone, email polling, quiet hours, missed-mail lookback, fetch cap, skipped-mail summaries, inbound email action rules, assistant voice, and outbound pronunciation policy. I could not confidently read the new value from that request.",
      intent: "settings_update",
      links: settingsLinks(["general", "integrations", "voice"]),
      title: "Settings update",
    };
  }

  const changedPolicyIds: string[] = [];
  let inboundSnapshot: InboundEmailSettings | null = null;
  let voiceSnapshot: VoiceSettings | null = null;

  if (Object.keys(parsed.settings).length > 0) {
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
    const settings = normalizeInboundEmailSettings({
      ...beforeSettings,
      ...parsed.settings,
      autoPromoteActionable: true,
    });
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

  return {
    context: {
      changed: parsed.labels,
      settingsSnapshot: {
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
