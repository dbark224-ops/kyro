import type { ModelRouteDecision, ModelRouteRequest } from "@kyro/contracts";

const DEFAULT_OPENAI_LOW_COST_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_BALANCED_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_STRONG_MODEL = "gpt-4.1";
const DEFAULT_OLLAMA_MODEL = "qwen3:8b";

function envValue(key: string) {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env?.[key];
}

function configuredProvider() {
  return envValue("AI_PROVIDER")?.trim().toLowerCase() ?? "stub";
}

function configuredOllamaModel() {
  return envValue("OLLAMA_MODEL")?.trim() || DEFAULT_OLLAMA_MODEL;
}

function configuredOpenAiModel(tier: "balanced" | "low-cost" | "strong") {
  const model = envValue("OPENAI_MODEL")?.trim();

  if (tier === "low-cost") {
    return envValue("OPENAI_LOW_COST_MODEL")?.trim() || model || DEFAULT_OPENAI_LOW_COST_MODEL;
  }

  if (tier === "strong") {
    return envValue("OPENAI_STRONG_MODEL")?.trim() || model || DEFAULT_OPENAI_STRONG_MODEL;
  }

  return (
    envValue("OPENAI_BALANCED_MODEL")?.trim() ||
    envValue("ASSISTANT_MODEL")?.trim() ||
    model ||
    DEFAULT_OPENAI_BALANCED_MODEL
  );
}

export function selectModelRoute(request: ModelRouteRequest): ModelRouteDecision {
  if (["local", "ollama"].includes(configuredProvider())) {
    return {
      provider: "ollama",
      model: configuredOllamaModel(),
      reason: "Local Ollama provider selected for development and testing."
    };
  }

  if (request.riskLevel === "high" || request.taskType === "action_planning") {
    return {
      provider: "openai",
      model: configuredOpenAiModel("strong"),
      reason: "High-risk or planning task requires stronger reasoning."
    };
  }

  if (request.taskType === "assistant_chat" || request.taskType === "reply_drafting") {
    return {
      provider: "openai",
      model: configuredOpenAiModel("balanced"),
      reason: "Assistant-facing work needs quality and latency balance."
    };
  }

  return {
    provider: "openai",
    model: configuredOpenAiModel("low-cost"),
    reason: "Routine processing task can use a lower-cost route."
  };
}
