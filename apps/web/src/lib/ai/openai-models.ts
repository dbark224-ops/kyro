import {
  DEFAULT_OPENAI_BALANCED_MODEL,
  DEFAULT_OPENAI_LOW_COST_MODEL,
  DEFAULT_OPENAI_STRONG_MODEL,
} from "@kyro/ai";

export type OpenAiReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const REASONING_EFFORTS = new Set<OpenAiReasoningEffort>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function normalizedModel(model: string) {
  return model.trim().toLowerCase();
}

export function openAiLowCostModel() {
  return (
    envValue("OPENAI_LOW_COST_MODEL") ||
    envValue("OPENAI_MODEL") ||
    DEFAULT_OPENAI_LOW_COST_MODEL
  );
}

export function openAiBalancedModel() {
  return (
    envValue("OPENAI_BALANCED_MODEL") ||
    envValue("ASSISTANT_MODEL") ||
    envValue("OPENAI_MODEL") ||
    DEFAULT_OPENAI_BALANCED_MODEL
  );
}

export function openAiStrongModel() {
  return (
    envValue("OPENAI_STRONG_MODEL") ||
    envValue("OPENAI_MODEL") ||
    DEFAULT_OPENAI_STRONG_MODEL
  );
}

export function openAiModelSupportsReasoning(model: string) {
  const value = normalizedModel(model);

  return value.startsWith("gpt-5") || value.startsWith("o");
}

export function openAiReasoningEffort(
  envKeys: string | string[],
  fallback: OpenAiReasoningEffort,
) {
  const keys = Array.isArray(envKeys) ? envKeys : [envKeys];

  for (const key of [...keys, "OPENAI_REASONING_EFFORT"]) {
    const candidate = envValue(key).toLowerCase() as OpenAiReasoningEffort;

    if (REASONING_EFFORTS.has(candidate)) {
      return candidate;
    }
  }

  return fallback;
}

export function openAiReasoningRequest(
  model: string,
  envKeys: string | string[],
  fallback: OpenAiReasoningEffort,
) {
  if (!openAiModelSupportsReasoning(model)) {
    return {};
  }

  return {
    reasoning: {
      effort: openAiReasoningEffort(envKeys, fallback),
    },
  };
}
