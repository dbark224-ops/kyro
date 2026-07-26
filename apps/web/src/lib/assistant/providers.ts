import { fetchAiProvider } from "../http/fetch-with-timeout";
import type {
  AssistantModelInput,
  AssistantModelOutput,
  AssistantModelRoute,
} from "./types";
import {
  assistantWebSearchEnabled,
  extractWebSearchSources,
  hasWebSearchCall,
  openAiWebSearchTool,
} from "./web-search";
import {
  estimateTokens,
  openAiProviderUsageId,
  openAiUsageFromResponse,
} from "../usage/openai";
import { openAiReasoningRequest } from "../ai/openai-models";
import { assistantResponseSurface } from "./response-surface";
import { smsCharacterBudget } from "../communication/sms-length";

/**
 * Two SMS segments of room for a texted answer, with a third available before
 * the split gives up. Stated to the model rather than enforced by truncation:
 * cutting a reply off costs the same to send and loses the end of it.
 */
const TEXT_ONLY_REPLY_BUDGET = smsCharacterBudget(2);
import { objectRecord, textValue } from "@kyro/core";

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function ollamaBaseUrl() {
  return (envValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
}

function ollamaTimeoutMs() {
  const parsed = Number(
    envValue("ASSISTANT_OLLAMA_TIMEOUT_MS") || envValue("OLLAMA_TIMEOUT_MS"),
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function ollamaNumPredict() {
  const parsed = Number(
    envValue("ASSISTANT_OLLAMA_NUM_PREDICT") || envValue("OLLAMA_NUM_PREDICT"),
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180;
}

function ollamaThinkEnabled() {
  const value = (
    envValue("ASSISTANT_OLLAMA_THINK") || envValue("OLLAMA_THINK")
  ).toLowerCase();

  return ["1", "true", "yes", "on"].includes(value);
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function openAiMaxOutputTokens() {
  const parsed = Number(envValue("OPENAI_ASSISTANT_MAX_OUTPUT_TOKENS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 360;
}

function describeOllamaError(error: unknown, timeoutMs: number) {
  if (error instanceof Error && error.name === "AbortError") {
    return `Local Ollama assistant timed out after ${timeoutMs}ms.`;
  }

  return error instanceof Error
    ? error.message
    : "Local assistant model failed.";
}

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);
  const message = textValue(error.message);

  return message ?? "OpenAI assistant request failed.";
}

function responseOutputText(payload: unknown) {
  const root = objectRecord(payload);
  const direct = textValue(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];

  for (const item of output) {
    const content = objectRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const record = objectRecord(part);
      const text = textValue(record.text);

      if (text) {
        return text;
      }
    }
  }

  return null;
}

function responseUsage(payload: unknown, prompt: string, text: string) {
  const usage = openAiUsageFromResponse(payload, { prompt, text });

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    providerUsageId: openAiProviderUsageId(payload) ?? undefined,
    tokenUsage: usage,
  };
}

function buildAssistantPrompt(input: AssistantModelInput) {
  const responseSurface = assistantResponseSurface(input.inputSource);
  const rules = [
    "currentTime is the authoritative workspace-local clock for this turn. Use currentTime.currentDateKey for today, currentTime.tomorrowDateKey for tomorrow, and currentTime.currentTimezone for all relative-date, weekday, and past/future reasoning. Never substitute the UTC calendar date.",
    "For CRM, quote, inquiry, contact, memory, and action requests, use commandResult.context and commandResult.links as the source of truth.",
    "For app_help, answer from commandResult.context.snippets. Prefer user-facing manual snippets, and translate architecture snippets into plain product guidance. For settings explanations, define exactly what the setting controls, say where it is changed, give the practical default recommendation, and mention the tradeoff. Be clear about what exists now versus what is planned.",
    "For settings_update and pronunciation_update, state the completed change plainly and do not imply that high-risk settings can be edited directly.",
    "For action_execution, if commandResult.context.executed is non-empty, state that the approved action was completed. Do not ask the user to review the same generated replies again. If failures are present, say what completed and what still needs review.",
    "For quote_send_prepare, make clear that Kyro prepared a reviewable email with the quote PDF attached, but did not send it until the user reviews/sends it.",
    "For quote_send_ready_list, explain which quotes are ready and which common blockers remain without pretending blocked quotes can be sent.",
    "For quote_history, answer from the document history events, quoteVersion, revisionNeeded, customer approval/change-request events, and content-hash freshness. Be explicit about whether the quote was sent, prepared only, generated only, approved, needs revision, or changed since the latest document event.",
    "For calendar_event, if commandResult.context.status is suggested, call it a draft calendar event, not a saved event. If commandResult.mutation exists for a non-draft calendar event, state the calendar event was created, updated, saved, or deleted. Do not ask the user to open Calendar to repeat a completed change.",
    "For calendar_event creation, event purpose plus date and time is sufficient. Duration and location are optional. Never ask for either after commandResult confirms creation; if the default duration was used, briefly mention it and offer to add optional details later without turning that offer into another approval step.",
    "For calendar_event, describe event times from commandResult.fallbackAnswer, commandResult.context.scheduledAtLocal, commandResult.context.scheduledEndsAtLocal, link meta, or other explicitly local display fields. Raw ISO/UTC fields such as startsAt, endsAt, or scheduled.startsAt are storage/debug values; do not treat them as the user's local appointment time.",
    "For calendar_event reads about a day or date range, commandResult.fallbackAnswer, context.events, context.range, context.rangeFrom, context.rangeTo, context.totalEventCount, and context.workspaceTimeZone are authoritative. Preserve requests such as rest of this week, this week, next week, this month, next month, or the next N days/weeks as ranges. Do not collapse a range to today, recalculate weekdays, substitute a different date, or claim a period is empty when events were returned.",
    "For calendar_event, never imply an event was linked to a CRM contact unless commandResult.context.contactId is present. If commandResult.context.skippedLinkReason is stale_context and suggestedContactName is present, ask briefly whether the event should be linked to that contact.",
    "For internal_self_call, the authenticated user's request to call or ring them is already complete. State that the call is starting. Never ask what the call should cover, request a script, or add another confirmation step.",
    "Treat clear, low-risk user instructions as complete when Kyro already has the required identity and destination. Do not ask for optional details before acting; use sensible defaults and let the user refine the result afterward.",
    "For general_chat, you can answer normally and casually. Be warm, natural, and a little personable.",
    "For web_search, answer from commandResult.fallbackAnswer and commandResult.context.sources. Do not run a second web search.",
    "Use threadSummary, recentMessages, longTermContextSnapshots, and relevantMemories only when they help answer the current userPrompt.",
    "Treat recentMessages as live follow-up context only when they are clearly fresh, roughly within the last 30 minutes. Older messages are background continuity only; do not use them to infer current CRM/contact/calendar associations unless the user explicitly asks about older context.",
    "When actor.kind is trusted_internal_messaging_sender, actor is the authenticated sender of this SMS or WhatsApp thread. First-person references such as me, my number, or ring me refer to that actor. Never replace that identity with a similarly named CRM contact.",
    "longTermContextSnapshots are compacted older assistant context. Prefer them for continuity over pretending the current prompt is isolated. If they are insufficient and the user asks about older discussion, say you can search assistant history.",
    "Do not invent CRM records, dates, prices, or real-world business actions.",
    "Keep CRM answers short and operational. Casual answers can sound like a normal chat.",
    "For non-general_chat intents, use commandResult.fallbackAnswer as the baseline answer; improve the wording only if it helps.",
    responseSurface === "interactive"
      ? "Mention the most useful next click when links are available for CRM intents."
      : "For CRM intents, put the useful result and next step directly in the message text.",
    "For general_chat, do not mention command results, CRM cards, internal routing, or that you are constrained to CRM data.",
    "If web search is available, use it only for current or public internet information, not for Kyro CRM records or private workspace data.",
    "If you use web search, answer from the sources and cite them so url citation annotations are available for UI source cards. Do not dump raw URLs.",
    responseSurface === "interactive"
      ? "Do not print raw URLs, UUIDs, hrefs, or markdown links; the UI renders commandResult.links as cards."
      : "Do not print raw internal URLs, UUIDs, or hrefs in a text message.",
    responseSurface === "interactive"
      ? "For inquiry_lookup with an exact match, explain the reply/status in plain language and point to the card below."
      : "For inquiry_lookup with an exact match, explain the reply/status and useful next step entirely in plain text.",
    "For inquiry_lookup with an exact match, inquiryMessage is the original inbound inquiry and latestMessage is the most recent message. When the user asks what the inquiry or message says, lead with that actual content rather than conversation metadata. Reproduce a short inquiry faithfully; summarize a longer inquiry concisely without losing the customer's request. Then mention status or next action only if useful. Never say the message text is unavailable when either field contains it.",
    "For inquiry_lookup with partial or multiple matches, ask the user to confirm which listed inquiry they mean.",
    "If inputSource is voice, treat names like Cara, Kara, Cairo, Kiro, or Kyra near the start of the prompt as likely speech-to-text variants of Kyro unless the user is clearly talking about a real person.",
    "Your name is Kyro. If the user appears to address you with a speech-to-text variant of Kyro, respond as Kyro rather than adopting that mistaken name.",
    "If a mutation was performed, state it plainly.",
    "Safe assistant-editable settings are limited to timezone, inbound email sync mode, poll frequency, quiet hours, missed-mail lookback, fetch cap, skipped-mail summaries, inbound email action rules, explicit sender relevance rules when the user provides an email address or domain, assistant voice, outbound pronunciation policy, and pronunciation vocabulary entries.",
    ...(responseSurface === "text_only"
      ? [
          "This reply is being delivered as a plain SMS or WhatsApp message. The recipient cannot see Kyro UI cards, dynamic boxes, panels, previews, buttons, or content positioned below the message.",
          "Never refer to a card, box, panel, preview, dynamic event, link below, item shown below, or anything being displayed on screen.",
          "State completed actions, calendar details, lookup results, blockers, and the useful next step directly in the message text.",
          "Only tell the user to open Kyro when an interface-only review or approval is genuinely required. Do not claim that you have displayed anything for them.",
          // A text message is not a page. Long answers used to go out as one
          // oversized body and arrive cut off, so the budget is stated rather
          // than enforced afterwards by slicing the string.
          `Aim to fit within about ${TEXT_ONLY_REPLY_BUDGET} characters. Longer answers are delivered as two or three separate texts, so if the answer genuinely needs the room, write it in complete sentences and let it run rather than trailing off.`,
          "When quoting a drafted reply back to the user, give it in full if it fits and summarise it faithfully if it does not. Never stop mid-sentence.",
        ]
      : []),
  ];

  return JSON.stringify(
    {
      actor: input.actor ?? null,
      currentTime: input.currentTime,
      userPrompt: input.prompt,
      threadSummary: input.threadSummary ?? null,
      inputSource: input.inputSource ?? "typed",
      responseSurface: {
        kind: responseSurface,
        supportsLinks: responseSurface === "interactive",
        supportsUiBlocks: responseSurface === "interactive",
      },
      longTermContextSnapshots: input.contextSnapshots ?? [],
      recentMessages: input.recentMessages ?? [],
      relevantMemories: input.memories ?? [],
      commandResult: input.command,
      rules,
    },
    null,
    2,
  );
}

export async function runAssistantModel(
  route: AssistantModelRoute,
  input: AssistantModelInput,
): Promise<AssistantModelOutput> {
  if (["ollama", "local"].includes(route.provider)) {
    return runOllamaAssistant(route, input);
  }

  if (route.provider === "openai") {
    return runOpenAiAssistant(route, input);
  }

  return {
    fallbackReason: `${route.provider} assistant provider is not implemented yet.`,
    inputTokens: estimateTokens(input.prompt),
    outputTokens: estimateTokens(input.command.fallbackAnswer),
    text: input.command.fallbackAnswer,
  };
}

async function runOpenAiAssistant(
  route: AssistantModelRoute,
  input: AssistantModelInput,
): Promise<AssistantModelOutput> {
  const apiKey = openAiApiKey();
  const prompt = buildAssistantPrompt(input);

  if (!apiKey) {
    return {
      fallbackReason: "OPENAI_API_KEY is not configured for assistant chat.",
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(input.command.fallbackAnswer),
      text: input.command.fallbackAnswer,
    };
  }

  try {
    const webSearchEnabled =
      assistantWebSearchEnabled() && input.command.intent !== "web_search";
    const response = await fetchAiProvider(
      "https://api.openai.com/v1/responses",
      {
        body: JSON.stringify({
          input: prompt,
          instructions:
            "You are Kyro, pronounced like Cairo, a friendly AI assistant inside a trades CRM. You can chat normally, answer casual questions, and have a light point of view. When the user asks about CRM data or business actions, use the provided command result as truth and stay clear about what the app has actually done. When the user asks how Kyro works, use the bundled help/manual snippets provided in the command result and explain them plainly. If a voice-transcribed message addresses you as Cara, Kara, Cairo, Kiro, or Kyra, treat it as Kyro unless the user is clearly referring to another person.",
          max_output_tokens: openAiMaxOutputTokens(),
          model: route.model,
          ...openAiReasoningRequest(
            route.model,
            "OPENAI_ASSISTANT_REASONING_EFFORT",
            "low",
          ),
          ...(webSearchEnabled
            ? {
                tools: [openAiWebSearchTool()],
              }
            : {}),
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(providerErrorMessage(payload));
    }

    const text = responseOutputText(payload);

    if (!text) {
      throw new Error("OpenAI returned an empty assistant response.");
    }

    return {
      ...responseUsage(payload, prompt, text),
      text,
      webSearchUsed: hasWebSearchCall(payload),
      webSources: extractWebSearchSources(payload),
    };
  } catch (error) {
    return {
      fallbackReason:
        error instanceof Error
          ? error.message
          : "OpenAI assistant request failed.",
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(input.command.fallbackAnswer),
      text: input.command.fallbackAnswer,
    };
  }
}

async function runOllamaAssistant(
  route: AssistantModelRoute,
  input: AssistantModelInput,
): Promise<AssistantModelOutput> {
  const prompt = buildAssistantPrompt(input);
  const controller = new AbortController();
  const timeoutMs = ollamaTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      body: JSON.stringify({
        messages: [
          {
            content:
              "You are Kyro, pronounced like Cairo, a friendly AI assistant inside a trades CRM. You can chat normally, answer casual questions, and have a light point of view. When the user asks about CRM data or business actions, use the provided command result as truth and stay clear about what the app has actually done. When the user asks how Kyro works, use the bundled help/manual snippets provided in the command result and explain them plainly. If a voice-transcribed message addresses you as Cara, Kara, Cairo, Kiro, or Kyra, treat it as Kyro unless the user is clearly referring to another person.",
            role: "system",
          },
          {
            content: prompt,
            role: "user",
          },
        ],
        model: route.model,
        options: {
          num_predict: ollamaNumPredict(),
          temperature: 0.2,
        },
        stream: false,
        think: ollamaThinkEnabled(),
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const message =
      payload.message && typeof payload.message === "object"
        ? (payload.message as Record<string, unknown>)
        : {};
    const text = textValue(message.content);

    if (!text) {
      throw new Error("Ollama returned an empty assistant response.");
    }

    return {
      inputTokens:
        typeof payload.prompt_eval_count === "number"
          ? payload.prompt_eval_count
          : estimateTokens(prompt),
      outputTokens:
        typeof payload.eval_count === "number"
          ? payload.eval_count
          : estimateTokens(text),
      text,
    };
  } catch (error) {
    return {
      fallbackReason: describeOllamaError(error, timeoutMs),
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(input.command.fallbackAnswer),
      text: input.command.fallbackAnswer,
    };
  } finally {
    clearTimeout(timeout);
  }
}
