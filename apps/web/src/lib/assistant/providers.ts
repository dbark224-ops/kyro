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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
  return JSON.stringify(
    {
      userPrompt: input.prompt,
      threadSummary: input.threadSummary ?? null,
      inputSource: input.inputSource ?? "typed",
      recentMessages: input.recentMessages ?? [],
      relevantMemories: input.memories ?? [],
      commandResult: input.command,
      rules: [
        "For CRM, quote, inquiry, contact, memory, and action requests, use commandResult.context and commandResult.links as the source of truth.",
        "For app_help, answer from commandResult.context.snippets. Prefer user-facing manual snippets, and translate architecture snippets into plain product guidance. For settings explanations, define exactly what the setting controls, say where it is changed, give the practical default recommendation, and mention the tradeoff. Be clear about what exists now versus what is planned.",
        "For settings_update and pronunciation_update, state the completed change plainly and do not imply that high-risk settings can be edited directly.",
        "For quote_send_prepare, make clear that Kyro prepared a reviewable email with the quote PDF attached, but did not send it until the user reviews/sends it.",
        "For quote_send_ready_list, explain which quotes are ready and which common blockers remain without pretending blocked quotes can be sent.",
        "For quote_history, answer from the document history events, quoteVersion, revisionNeeded, customer approval/change-request events, and content-hash freshness. Be explicit about whether the quote was sent, prepared only, generated only, approved, needs revision, or changed since the latest document event.",
        "For general_chat, you can answer normally and casually. Be warm, natural, and a little personable.",
        "Use threadSummary, recentMessages, and relevantMemories only when they help answer the current userPrompt.",
        "Do not invent CRM records, dates, prices, or real-world business actions.",
        "Keep CRM answers short and operational. Casual answers can sound like a normal chat.",
        "For non-general_chat intents, use commandResult.fallbackAnswer as the baseline answer; improve the wording only if it helps.",
        "Mention the most useful next click when links are available for CRM intents.",
        "For general_chat, do not mention command results, CRM cards, internal routing, or that you are constrained to CRM data.",
        "If web search is available, use it only for current or public internet information, not for Kyro CRM records or private workspace data.",
        "If you use web search, answer from the sources and keep the wording source-backed. The UI will show source cards, so do not dump raw URLs.",
        "Do not print raw URLs, UUIDs, hrefs, or markdown links; the UI renders commandResult.links as cards.",
        "For inquiry_lookup with an exact match, explain the reply/status in plain language and point to the card below.",
        "For inquiry_lookup with partial or multiple matches, ask the user to confirm which listed inquiry they mean.",
        "If inputSource is voice, treat names like Cara, Kara, Cairo, Kiro, or Kyra near the start of the prompt as likely speech-to-text variants of Kyro unless the user is clearly talking about a real person.",
        "Your name is Kyro. If the user appears to address you with a speech-to-text variant of Kyro, respond as Kyro rather than adopting that mistaken name.",
        "If a mutation was performed, state it plainly.",
        "Safe assistant-editable settings are limited to timezone, inbound email sync mode, poll frequency, quiet hours, missed-mail lookback, fetch cap, skipped-mail summaries, inbound email action rules, explicit sender relevance rules when the user provides an email address or domain, assistant voice, outbound pronunciation policy, and pronunciation vocabulary entries.",
      ],
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
    const webSearchEnabled = assistantWebSearchEnabled();
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You are Kyro, pronounced like Cairo, a friendly AI assistant inside a trades CRM. You can chat normally, answer casual questions, and have a light point of view. When the user asks about CRM data or business actions, use the provided command result as truth and stay clear about what the app has actually done. When the user asks how Kyro works, use the bundled help/manual snippets provided in the command result and explain them plainly. If a voice-transcribed message addresses you as Cara, Kara, Cairo, Kiro, or Kyra, treat it as Kyro unless the user is clearly referring to another person.",
        max_output_tokens: openAiMaxOutputTokens(),
        model: route.model,
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
    });
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
