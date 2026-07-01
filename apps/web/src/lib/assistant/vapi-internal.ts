import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AssistantThreadState } from "./types";
import {
  elevenLabsVapiVoiceOverride,
  elevenLabsVoicePresetById,
  getVoiceSettings,
} from "./voice-settings";
import {
  getActivePronunciationEntries,
  pronunciationGuideText,
  type AssistantPronunciationEntry,
} from "./pronunciation";
import {
  VAPI_TOOL_PATH,
  VAPI_WEBHOOK_PATH,
  vapiEndpointUrl,
  vapiWebhookCredentialId,
} from "../integrations/vapi";
import { vapiAssistantGuidance } from "../voice/calls";
import {
  DEFAULT_WORKSPACE_GENERAL_SETTINGS,
  getWorkspaceGeneralSettings,
} from "../workspace/general-settings";
import type { WorkspaceSummary } from "../workspace/bootstrap";
import { buildVapiCurrentTimeContext } from "./vapi-time";
import {
  vapiUserContextLine,
  vapiUserIdentityFromUser,
  vapiUserVariableValues,
} from "./vapi-user-context";

export type VapiInternalVoiceSession = {
  assistantId: string | null;
  assistantOverrides: Record<string, unknown>;
  configured: boolean;
  contextMessage: string;
  missing: string[];
  publicKey: string | null;
  threadId: string | null;
  toolUrl: string | null;
  webhookUrl: string | null;
  voiceLabel: string;
  voiceOverrideEnabled: boolean;
  workspaceId: string;
  workspaceName: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanEnvValue(key: string, fallback: boolean) {
  const raw = (process.env[key] ?? "").trim().toLowerCase();

  if (!raw) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  return fallback;
}

function remotelyReachableUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".local")
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function clipped(value: string, maxLength = 900) {
  const clean = value.replace(/\s+/g, " ").trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function uniqueCompactStrings(values: Array<string | null | undefined>, limit = 60) {
  const seen = new Set<string>();
  const compact: string[] = [];

  for (const value of values) {
    const clean = value?.trim().replace(/\s+/g, " ");

    if (!clean || clean.length > 50) {
      continue;
    }

    const key = clean.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    compact.push(clean);

    if (compact.length >= limit) {
      break;
    }
  }

  return compact;
}

function singleWordBoosts(values: string[], limit = 60) {
  const seen = new Set<string>();
  const boosts: string[] = [];

  for (const value of values) {
    const words = value.match(/[A-Za-z0-9]+/g) ?? [];

    for (const word of words) {
      if (word.length < 2 || word.length > 48) {
        continue;
      }

      const key = word.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      boosts.push(`${word}:1`);

      if (boosts.length >= limit) {
        return boosts;
      }
    }
  }

  return boosts;
}

function transcriptionKeyterms(
  workspaceName: string,
  pronunciationEntries: AssistantPronunciationEntry[],
) {
  return singleWordBoosts(
    uniqueCompactStrings([
      "Kyro",
      "Cairo",
      "Kairo",
      "Kiro",
      "Kyra",
      "Cara",
      "Kara",
      "Clare",
      "Claire",
      workspaceName,
      ...pronunciationEntries.map((entry) => entry.phrase),
    ]),
  );
}

function transcriptionVocabulary(
  workspaceName: string,
  pronunciationEntries: AssistantPronunciationEntry[],
) {
  return uniqueCompactStrings([
    "Kyro",
    "Kyro Assistant",
    workspaceName,
    ...pronunciationEntries.map((entry) => entry.phrase),
  ]);
}

function transcriptionHint(
  workspaceName: string,
  pronunciationEntries: AssistantPronunciationEntry[],
) {
  const guide = pronunciationGuideText(pronunciationEntries);

  return clipped(
    [
      "Kyro is the assistant name. Spell it Kyro, even when it sounds like Cairo.",
      `Workspace: ${workspaceName}.`,
      guide ? `Workspace pronunciation vocabulary: ${guide}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    600,
  );
}

function internalVoiceTranscriberOverride(
  workspaceName: string,
  pronunciationEntries: AssistantPronunciationEntry[],
) {
  const provider = (
    textValue(process.env.VAPI_INTERNAL_TRANSCRIBER_PROVIDER) ?? "deepgram"
  ).toLowerCase();
  const model =
    textValue(process.env.VAPI_INTERNAL_TRANSCRIBER_MODEL) ??
    "flux-general-en";
  const language = textValue(process.env.VAPI_INTERNAL_TRANSCRIBER_LANGUAGE) ?? "en";
  const keywordBoosts = transcriptionKeyterms(workspaceName, pronunciationEntries);
  const vocabulary = transcriptionVocabulary(workspaceName, pronunciationEntries);
  const deepgramFallback = {
    language,
    model: "nova-3",
    provider: "deepgram",
    smartFormat: true,
  };

  if (provider === "openai") {
    return {
      fallbackPlan: {
        transcribers: [deepgramFallback],
      },
      model:
        model === "gpt-4o-mini-transcribe"
          ? "gpt-4o-mini-transcribe"
          : "gpt-4o-transcribe",
      provider: "openai",
      language,
    };
  }

  if (provider === "11labs" || provider === "elevenlabs") {
    return {
      fallbackPlan: {
        transcribers: [deepgramFallback],
      },
      language,
      model: "scribe_v1",
      provider: "11labs",
    };
  }

  if (provider === "gladia") {
    return {
      audioEnhancer: true,
      fallbackPlan: {
        transcribers: [deepgramFallback],
      },
      language,
      languageBehaviour: "manual",
      model: ["fast", "accurate", "solaria-1"].includes(model)
        ? model
        : "solaria-1",
      provider: "gladia",
      receivePartialTranscripts: true,
      transcriptionHint: transcriptionHint(workspaceName, pronunciationEntries),
      customVocabularyEnabled: vocabulary.length > 0,
      customVocabularyConfig:
        vocabulary.length > 0
          ? {
              defaultIntensity: 0.7,
              vocabulary: vocabulary.slice(0, 30),
            }
          : undefined,
    };
  }

  return {
    fallbackPlan: {
      transcribers: [deepgramFallback],
    },
    keywords: keywordBoosts,
    language,
    model,
    provider: "deepgram",
    smartFormat: true,
    endpointing: 300,
    ...(model.startsWith("flux")
      ? {
          eotThreshold: 0.72,
          eotTimeoutMs: 1400,
        }
      : {}),
  };
}

function recentThreadContext(threadState: AssistantThreadState) {
  const messages = threadState.messages.slice(-6);

  if (messages.length === 0) {
    return "No prior handled Assistant thread excerpts are available.";
  }

  return messages
    .map((message) => {
      const label =
        message.role === "user"
          ? "Past user request already handled"
          : "Past assistant reply already delivered";

      return `- ${label}: ${clipped(message.content, 240)}`;
    })
    .join("\n");
}

function memoryContext(threadState: AssistantThreadState) {
  const memories = threadState.memories?.slice(0, 8) ?? [];

  if (memories.length === 0) {
    return "No approved long-term memories are available yet.";
  }

  return memories
    .map((memory) => `- ${clipped(memory.content, 300)}`)
    .join("\n");
}

function contextSnapshotSummary(threadState: AssistantThreadState) {
  if (!threadState.summary) {
    return "No compact thread summary has been saved yet.";
  }

  return clipped(threadState.summary, 1_200);
}

export async function getVapiInternalVoiceSession({
  supabase,
  threadState,
  user,
  workspace,
}: {
  supabase: SupabaseClient;
  threadState: AssistantThreadState;
  user: User;
  workspace: WorkspaceSummary;
}): Promise<VapiInternalVoiceSession> {
  const [voiceSettings, pronunciationEntries, generalSettings] =
    await Promise.all([
      getVoiceSettings(supabase, workspace.id),
      getActivePronunciationEntries(supabase, workspace.id).catch(() => []),
      getWorkspaceGeneralSettings(supabase, workspace.id).catch(
        () => DEFAULT_WORKSPACE_GENERAL_SETTINGS,
      ),
    ]);
  const guidance = vapiAssistantGuidance(voiceSettings);
  const currentTime = buildVapiCurrentTimeContext(generalSettings.timeZone);
  const userIdentity = vapiUserIdentityFromUser(user);
  const selectedVoice = elevenLabsVoicePresetById(
    voiceSettings.elevenLabsVoicePresetId,
  );
  const pronunciationGuide = pronunciationGuideText(pronunciationEntries);
  const voiceOverrideEnabled = booleanEnvValue(
    "VAPI_ENABLE_ELEVENLABS_VOICE_OVERRIDE",
    true,
  );
  const transcriberOverrideEnabled = booleanEnvValue(
    "VAPI_ENABLE_TRANSCRIBER_OVERRIDE",
    false,
  );
  const publicKey = textValue(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY);
  const assistantId = voiceSettings.vapiInternalAssistantId;
  const threadId = threadState.threadId ?? null;
  const configuredToolUrl = vapiEndpointUrl(VAPI_TOOL_PATH);
  const configuredWebhookUrl = vapiEndpointUrl(VAPI_WEBHOOK_PATH);
  const remoteToolUrl = remotelyReachableUrl(configuredToolUrl);
  const remoteWebhookUrl = remotelyReachableUrl(configuredWebhookUrl);
  const webhookCredentialId = vapiWebhookCredentialId();
  const businessName =
    textValue(generalSettings.businessProfile.businessName) ?? workspace.name;
  const missing = [
    publicKey ? null : "NEXT_PUBLIC_VAPI_PUBLIC_KEY",
    assistantId ? null : "VAPI_INTERNAL_ASSISTANT_ID",
  ].filter((entry): entry is string => Boolean(entry));
  const contextMessage = [
    "You are Kyro, pronounced like Cairo, a live voice assistant inside a trades CRM.",
    `You are the internal voice assistant for ${workspace.name}.`,
    "This is the logged-in user speaking directly to their business assistant. Be conversational, concise, and useful.",
    "Only respond to the user's newest live utterance. Any thread summary, memory, or previous-message excerpt below is background only and has already been handled.",
    currentTime.promptLine,
    vapiUserContextLine(userIdentity, "Logged-in Kyro user"),
    "Do not answer, repeat, continue, or summarize old user requests from the background context unless the user explicitly asks about prior conversation history.",
    "Use Kyro tools when you need live CRM, file, email, web-search, or workspace context. Do not pretend an action has been completed unless a tool result confirms it.",
    "Voice response style: keep operational answers to one or two short sentences unless the user asks for detail. Say the useful business fact first, then the next action.",
    "For leads and inquiries, do not explain what statuses mean by default. Tell the user what is missing, what is waiting, or what can be done next.",
    "When the user says show, open, pull up, card, details, or the one about a lead/contact you just mentioned, treat it as a follow-up to the previous tool result. Call kyro_context_lookup or kyro_lookup_contact so the Kyro UI can display the card.",
    "For follow-up requests about a just-mentioned lead/contact, do not repeat the same summary you gave in the previous answer. Add the next useful detail: latest message, missing fields, draft reply state, recommended action, or ask which action to take.",
    "If the user asks to show a card or full details, say briefly that you are putting it on screen, then summarize the next action. The Kyro web UI can render cards from tool results, so do not say voice is not good for displaying cards.",
    "Do not read phone numbers, email addresses, street addresses, database ids, links, or long contact details aloud unless the user explicitly asks for those exact details.",
    "If the user asks for full details, summarize the job, status, missing information, and recommended action. Keep contact fields quiet unless requested.",
    remoteToolUrl
      ? "Kyro tool calls are available through the configured remote tool endpoint."
      : "This local test session does not expose Kyro tools to Vapi because the app URL is not a public HTTPS URL. Answer conversationally and tell the user if a live Kyro tool would normally be needed.",
    "If the user asks you to create, send, update, search, look up, summarize, or inspect business data, call the relevant Kyro tool instead of guessing.",
    "For contact profile changes, call kyro_update_contact. It can update contact name, email, phone, address, company, contact type, and append or replace notes. If the contact is unclear, call kyro_lookup_contact first and ask the user to pick.",
    "For address changes, include the suburb/city, state, and country if the user gives them. If they only give a bare street address, ask for the suburb or city before calling kyro_update_contact. When the tool returns a verified formatted address, read that address back including postcode.",
    "After a contact update succeeds, confirm only the changed field or fields. Do not read the full contact profile aloud.",
    "If the user asks whether there are leads, inquiries, inbox items, messages, or jobs needing a response, reply, follow-up, attention, or approval, call kyro_context_lookup with the user's exact request.",
    "If speech recognition hears Cara, Kara, Clare, Claire, Cairo, Kairo, Kiro, or Kyra near the start of the request, treat and spell it as Kyro unless clearly referring to a real person/place.",
    "For user-facing voice, use best-effort pronunciation when a term is not confirmed. Follow workspace pronunciation vocabulary when it is available.",
    `Workspace ID: ${workspace.id}`,
    `User ID: ${user.id}`,
    `Assistant thread ID: ${threadId ?? "not yet available"}`,
    `Voice style: ${guidance.persona}; verbosity: ${guidance.verbosity}; humour: ${guidance.humourLevel}; escalation: ${guidance.escalationMode}.`,
    pronunciationGuide
      ? `Workspace pronunciation vocabulary:\n${pronunciationGuide}`
      : null,
    "",
    "Background compact thread summary, already handled:",
    contextSnapshotSummary(threadState),
    "",
    "Approved long-term memories, background only:",
    memoryContext(threadState),
    "",
    "Recent handled Assistant thread excerpts, background only:",
    recentThreadContext(threadState),
  ].join("\n");

  return {
    assistantId,
    assistantOverrides: {
      clientMessages: [
        "assistant.started",
        "conversation-update",
        "function-call",
        "function-call-result",
        "model-output",
        "speech-update",
        "status-update",
        "tool-calls",
        "tool-calls-result",
        "transcript",
        "user-interrupted",
        "voice-input",
      ],
      maxDurationSeconds: 1800,
      metadata: {
        purpose: "inbound_user",
        source: "kyro.vapi_internal_voice",
        threadId,
        userEmail: userIdentity.email,
        userId: user.id,
        userName: userIdentity.name,
        userPhone: userIdentity.phone,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
      modelOutputInMessagesEnabled: true,
      ...(transcriberOverrideEnabled
        ? {
            transcriber: internalVoiceTranscriberOverride(
              workspace.name,
              pronunciationEntries,
            ),
          }
        : {}),
      ...(voiceOverrideEnabled
        ? { voice: elevenLabsVapiVoiceOverride(voiceSettings) }
        : {}),
      server: remoteWebhookUrl
        ? {
            ...(webhookCredentialId
              ? { credentialId: webhookCredentialId }
              : {}),
            timeoutSeconds: 45,
            url: remoteWebhookUrl,
          }
        : undefined,
      serverMessages: [
        "assistant.started",
        "conversation-update",
        "end-of-call-report",
        "function-call",
        "speech-update",
        "status-update",
        "tool-calls",
        "transcript",
        'transcript[transcriptType="final"]',
        "user-interrupted",
      ],
      variableValues: {
        ...currentTime.variableValues,
        business_name: businessName,
        kyro_context: contextMessage,
        kyro_tool_url: remoteToolUrl ?? "",
        thread_id: threadId ?? "",
        ...vapiUserVariableValues(userIdentity),
        user_id: user.id,
        voice_id: selectedVoice.voiceId,
        voice_label: selectedVoice.label,
        voice_demeanor: guidance.persona,
        voice_escalation_mode: guidance.escalationMode,
        voice_humour_level: guidance.humourLevel,
        voice_verbosity: guidance.verbosity,
        workspace_id: workspace.id,
        workspace_name: workspace.name,
      },
    },
    configured: missing.length === 0,
    contextMessage,
    missing,
    publicKey,
    threadId,
    toolUrl: remoteToolUrl,
    webhookUrl: remoteWebhookUrl,
    voiceLabel: selectedVoice.label,
    voiceOverrideEnabled,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
  };
}
