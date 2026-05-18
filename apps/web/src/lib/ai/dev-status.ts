export type LlmDevStatus = {
  label: string;
  tone: "connected" | "offline" | "stub";
  detail: string;
};

let cachedStatus:
  | {
      expiresAt: number;
      value: LlmDevStatus | null;
    }
  | null = null;
let pendingStatus: Promise<LlmDevStatus | null> | null = null;

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function ollamaBaseUrl() {
  return (envValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").replace(/\/$/, "");
}

function ollamaModel() {
  return envValue("ASSISTANT_MODEL") || envValue("OLLAMA_MODEL") || "qwen3:8b";
}

function openAiModel() {
  return envValue("ASSISTANT_MODEL") || envValue("OPENAI_MODEL") || "gpt-4.1-mini";
}

function aiProvider() {
  return (
    envValue("ASSISTANT_PROVIDER") ||
    envValue("AI_PROVIDER") ||
    "stub"
  ).toLowerCase();
}

export async function getLlmDevStatus(): Promise<LlmDevStatus | null> {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const now = Date.now();

  if (cachedStatus && cachedStatus.expiresAt > now) {
    return cachedStatus.value;
  }

  if (pendingStatus) {
    return pendingStatus;
  }

  const provider = aiProvider();

  if (provider === "openai") {
    return {
      detail: envValue("OPENAI_API_KEY")
        ? "OpenAI API key is configured for assistant calls."
        : "OPENAI_API_KEY is missing.",
      label: envValue("OPENAI_API_KEY")
        ? `LLM: ${openAiModel()} via OpenAI`
        : "LLM: OpenAI key missing",
      tone: envValue("OPENAI_API_KEY") ? "connected" : "offline"
    };
  }

  if (!["ollama", "local"].includes(provider)) {
    return {
      detail: "Deterministic fallback is active.",
      label: "LLM: stub mode",
      tone: "stub"
    };
  }

  const model = ollamaModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 650);

  pendingStatus = (async () => {
    try {
      const response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        models?: Array<{
          name?: string;
          model?: string;
        }>;
      };
      const modelAvailable = (payload.models ?? []).some(
        (item) => item.name === model || item.model === model
      );
      const value: LlmDevStatus = {
        detail: modelAvailable
          ? "Local Ollama endpoint is reachable."
          : "Ollama is reachable, but this model was not listed.",
        label: modelAvailable ? `LLM: ${model} connected` : `LLM: ${model} missing`,
        tone: modelAvailable ? "connected" : "offline"
      };

      cachedStatus = {
        expiresAt: Date.now() + 15_000,
        value
      };

      return value;
    } catch (error) {
      const value: LlmDevStatus = {
        detail: error instanceof Error ? error.message : "Local Ollama health check failed.",
        label: "LLM: local offline",
        tone: "offline"
      };

      cachedStatus = {
        expiresAt: Date.now() + 5_000,
        value
      };

      return value;
    } finally {
      clearTimeout(timeout);
      pendingStatus = null;
    }
  })();

  return pendingStatus;
}
