import type { ModelRouteDecision, ModelRouteRequest } from "@kyro/contracts";

const LOW_COST_MODEL = "fast-classifier";
const BALANCED_MODEL = "balanced-assistant";
const STRONG_MODEL = "strong-reasoner";
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
      model: STRONG_MODEL,
      reason: "High-risk or planning task requires stronger reasoning."
    };
  }

  if (request.taskType === "assistant_chat" || request.taskType === "reply_drafting") {
    return {
      provider: "openai",
      model: BALANCED_MODEL,
      reason: "Assistant-facing work needs quality and latency balance."
    };
  }

  return {
    provider: "openai",
    model: LOW_COST_MODEL,
    reason: "Routine processing task can use a lower-cost route."
  };
}
