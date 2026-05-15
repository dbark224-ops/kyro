import type {
  AssistantModelInput,
  AssistantModelOutput,
  AssistantModelRoute,
} from "./types";

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
  const parsed = Number(envValue("ASSISTANT_OLLAMA_TIMEOUT_MS") || envValue("OLLAMA_TIMEOUT_MS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function ollamaNumPredict() {
  const parsed = Number(envValue("ASSISTANT_OLLAMA_NUM_PREDICT") || envValue("OLLAMA_NUM_PREDICT"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180;
}

function ollamaThinkEnabled() {
  const value = (envValue("ASSISTANT_OLLAMA_THINK") || envValue("OLLAMA_THINK")).toLowerCase();

  return ["1", "true", "yes", "on"].includes(value);
}

function describeOllamaError(error: unknown, timeoutMs: number) {
  if (error instanceof Error && error.name === "AbortError") {
    return `Local Ollama assistant timed out after ${timeoutMs}ms.`;
  }

  return error instanceof Error ? error.message : "Local assistant model failed.";
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildAssistantPrompt(input: AssistantModelInput) {
  return JSON.stringify(
    {
      userPrompt: input.prompt,
      threadSummary: input.threadSummary ?? null,
      recentMessages: input.recentMessages ?? [],
      relevantMemories: input.memories ?? [],
      commandResult: input.command,
      rules: [
        "For CRM, quote, inquiry, contact, memory, and action requests, use commandResult.context and commandResult.links as the source of truth.",
        "For general_chat, you can answer normally and casually. Be warm, natural, and a little personable.",
        "Use threadSummary, recentMessages, and relevantMemories only when they help answer the current userPrompt.",
        "Do not invent CRM records, dates, prices, or real-world business actions.",
        "Keep CRM answers short and operational. Casual answers can sound like a normal chat.",
        "For non-general_chat intents, use commandResult.fallbackAnswer as the baseline answer; improve the wording only if it helps.",
        "Mention the most useful next click when links are available for CRM intents.",
        "For general_chat, do not mention command results, CRM cards, internal routing, or that you are constrained to CRM data.",
        "Do not print raw URLs, UUIDs, hrefs, or markdown links; the UI renders commandResult.links as cards.",
        "For inquiry_lookup with an exact match, explain the reply/status in plain language and point to the card below.",
        "For inquiry_lookup with partial or multiple matches, ask the user to confirm which listed inquiry they mean.",
        "If a mutation was performed, state it plainly.",
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

  return {
    fallbackReason: `${route.provider} assistant provider is not implemented yet.`,
    inputTokens: estimateTokens(input.prompt),
    outputTokens: estimateTokens(input.command.fallbackAnswer),
    text: input.command.fallbackAnswer,
  };
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
              "You are Kyro, a friendly AI assistant inside a trades CRM. You can chat normally, answer casual questions, and have a light point of view. When the user asks about CRM data or business actions, use the provided command result as truth and stay clear about what the app has actually done.",
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
