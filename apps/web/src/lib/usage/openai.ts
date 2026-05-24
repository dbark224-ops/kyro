import { createUsageEvent } from "@kyro/api";
import type { UsageEventCreate, UsageType } from "@kyro/contracts";

const DEFAULT_MARKUP_RATE = 0.25;
const PRICE_SOURCE = "openai_api_pricing_2026_05_24";
const WEB_SEARCH_NON_REASONING_COST_PER_1K_CALLS = 25;
const WEB_SEARCH_REASONING_COST_PER_1K_CALLS = 10;

type JsonObject = Record<string, unknown>;

type ModelPrice = {
  cachedInputPer1M: number | null;
  inputPer1M: number;
  outputPer1M: number;
};

export type OpenAiTokenUsage = {
  billableInputTokens: number;
  cachedInputTokens: number;
  estimated: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  visibleOutputTokens: number;
};

export type OpenAiRealtimeTokenUsage = {
  audioInputTokens: number;
  audioOutputTokens: number;
  cachedInputTokens: number;
  estimated: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  textInputTokens: number;
  textOutputTokens: number;
  totalTokens: number;
};

export type UsageEventDraft = UsageEventCreate & {
  metadata?: JsonObject;
  providerUsageId?: string;
};

export type UsageEventDatabaseRow = {
  action_id: string | null;
  ai_run_id: string | null;
  cost_snapshot: string;
  currency: string;
  customer_charge_snapshot: string;
  markup_snapshot: string;
  metadata: JsonObject;
  model: string | null;
  provider: string;
  provider_usage_id: string | null;
  quantity: string;
  service: string;
  source_id: string | null;
  source_type: string | null;
  unit: string;
  unit_cost_snapshot: string;
  unit_price_snapshot: string | null;
  usage_type: UsageType;
  user_id: string | null;
  workflow_run_id: string | null;
  workspace_id: string;
};

const OPENAI_TEXT_MODEL_PRICES: Array<{
  match: string;
  price: ModelPrice;
}> = [
  { match: "gpt-5.5-pro", price: { inputPer1M: 30, cachedInputPer1M: null, outputPer1M: 180 } },
  { match: "gpt-5.5", price: { inputPer1M: 5, cachedInputPer1M: 0.5, outputPer1M: 30 } },
  { match: "gpt-5.4-pro", price: { inputPer1M: 30, cachedInputPer1M: null, outputPer1M: 180 } },
  { match: "gpt-5.4-mini", price: { inputPer1M: 0.75, cachedInputPer1M: 0.075, outputPer1M: 4.5 } },
  { match: "gpt-5.4-nano", price: { inputPer1M: 0.2, cachedInputPer1M: 0.02, outputPer1M: 1.25 } },
  { match: "gpt-5.4", price: { inputPer1M: 2.5, cachedInputPer1M: 0.25, outputPer1M: 15 } },
  { match: "gpt-4.1-mini", price: { inputPer1M: 0.4, cachedInputPer1M: 0.1, outputPer1M: 1.6 } },
  { match: "gpt-4.1-nano", price: { inputPer1M: 0.1, cachedInputPer1M: 0.025, outputPer1M: 0.4 } },
  { match: "gpt-4.1", price: { inputPer1M: 2, cachedInputPer1M: 0.5, outputPer1M: 8 } },
  { match: "o4-mini", price: { inputPer1M: 1.1, cachedInputPer1M: 0.275, outputPer1M: 4.4 } },
  { match: "o3-mini", price: { inputPer1M: 1.1, cachedInputPer1M: 0.55, outputPer1M: 4.4 } },
  { match: "o3", price: { inputPer1M: 2, cachedInputPer1M: 0.5, outputPer1M: 8 } },
];

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function numberEnv(key: string) {
  const raw = envValue(key);

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function modelEnvPrefix(model: string) {
  return model
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function objectRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampTokenCount(value: number, max: number) {
  return Math.min(Math.max(0, Math.trunc(value)), Math.max(0, Math.trunc(max)));
}

function roundMoney(value: number) {
  return Number(value.toFixed(8));
}

function markupRate() {
  const parsed = numberEnv("OPENAI_LLM_MARKUP_RATE") ?? numberEnv("USAGE_MARKUP_RATE");

  return parsed ?? DEFAULT_MARKUP_RATE;
}

function modelPrice(model: string) {
  const prefix = modelEnvPrefix(model);
  const envPrice: ModelPrice | null = (() => {
    const input = numberEnv(`OPENAI_${prefix}_INPUT_COST_PER_1M`);
    const cached = numberEnv(`OPENAI_${prefix}_CACHED_INPUT_COST_PER_1M`);
    const output = numberEnv(`OPENAI_${prefix}_OUTPUT_COST_PER_1M`);

    if (input !== null && output !== null) {
      return {
        cachedInputPer1M: cached,
        inputPer1M: input,
        outputPer1M: output,
      };
    }

    return null;
  })();

  if (envPrice) {
    return {
      estimated: false,
      price: envPrice,
      source: `env:${prefix}`,
    };
  }

  const defaultInput = numberEnv("OPENAI_LLM_INPUT_COST_PER_1M");
  const defaultCached = numberEnv("OPENAI_LLM_CACHED_INPUT_COST_PER_1M");
  const defaultOutput = numberEnv("OPENAI_LLM_OUTPUT_COST_PER_1M");

  if (defaultInput !== null && defaultOutput !== null) {
    return {
      estimated: false,
      price: {
        cachedInputPer1M: defaultCached,
        inputPer1M: defaultInput,
        outputPer1M: defaultOutput,
      },
      source: "env:OPENAI_LLM_DEFAULT",
    };
  }

  const normalized = model.trim().toLowerCase();
  const catalog = OPENAI_TEXT_MODEL_PRICES.find(({ match }) =>
    normalized === match || normalized.startsWith(`${match}-`),
  );

  if (catalog) {
    return {
      estimated: false,
      price: catalog.price,
      source: `${PRICE_SOURCE}:${catalog.match}`,
    };
  }

  return {
    estimated: true,
    price: { inputPer1M: 0.4, cachedInputPer1M: 0.1, outputPer1M: 1.6 },
    source: `${PRICE_SOURCE}:fallback:gpt-4.1-mini`,
  };
}

function unitCostFor(input: {
  model: string;
  provider: string;
  usageType: UsageType;
}) {
  if (input.provider !== "openai") {
    return {
      priceEstimated: false,
      priceSource: "local_provider_zero_cost",
      unitCost: 0,
    };
  }

  const pricing = modelPrice(input.model);
  const per1M = (() => {
    if (input.usageType === "llm_cached_input_tokens") {
      return pricing.price.cachedInputPer1M ?? pricing.price.inputPer1M;
    }

    if (input.usageType === "llm_output_tokens" || input.usageType === "llm_reasoning_tokens") {
      return pricing.price.outputPer1M;
    }

    return pricing.price.inputPer1M;
  })();

  return {
    priceEstimated: pricing.estimated,
    priceSource: pricing.source,
    unitCost: per1M / 1_000_000,
  };
}

function realtimeUnitCostFor(input: {
  model: string;
  usageType: UsageType;
}) {
  const prefix = modelEnvPrefix(input.model);
  const key = (() => {
    if (input.usageType === "realtime_audio_input_tokens") {
      return "AUDIO_INPUT";
    }

    if (input.usageType === "realtime_audio_output_tokens") {
      return "AUDIO_OUTPUT";
    }

    if (input.usageType === "realtime_text_output_tokens") {
      return "TEXT_OUTPUT";
    }

    if (input.usageType === "realtime_cached_input_tokens") {
      return "CACHED_INPUT";
    }

    if (input.usageType === "realtime_reasoning_tokens") {
      return "TEXT_OUTPUT";
    }

    return "TEXT_INPUT";
  })();
  const defaults: Record<string, number> = {
    AUDIO_INPUT: 32,
    AUDIO_OUTPUT: 64,
    CACHED_INPUT: 0.4,
    TEXT_INPUT: 4,
    TEXT_OUTPUT: 24,
  };
  const modelSpecific = numberEnv(`OPENAI_${prefix}_${key}_COST_PER_1M`);
  const generic = numberEnv(`OPENAI_REALTIME_${key}_COST_PER_1M`);
  const per1M = modelSpecific ?? generic ?? defaults[key] ?? defaults.TEXT_INPUT;
  const normalizedModel = input.model.trim().toLowerCase();
  const source =
    modelSpecific !== null
      ? `env:${prefix}_${key}`
      : generic !== null
        ? `env:OPENAI_REALTIME_${key}`
        : normalizedModel === "gpt-realtime-2" ||
            normalizedModel.startsWith("gpt-realtime-2-")
          ? `${PRICE_SOURCE}:gpt-realtime-2`
          : `${PRICE_SOURCE}:fallback:gpt-realtime-2`;

  return {
    priceEstimated: source.includes(":fallback:"),
    priceSource: source,
    unitCost: per1M / 1_000_000,
  };
}

function priceQuantity(quantity: number, unitCost: number) {
  const cost = quantity * unitCost;
  const markup = markupRate();

  return {
    costSnapshot: roundMoney(cost),
    customerChargeSnapshot: roundMoney(cost * (1 + markup)),
    markupSnapshot: markup,
    unitCostSnapshot: unitCost,
  };
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function openAiProviderUsageId(payload: unknown) {
  return textValue(objectRecord(payload).id);
}

export function openAiUsageFromResponse(
  payload: unknown,
  fallback: {
    inputTokens?: number;
    outputTokens?: number;
    prompt?: string;
    text?: string;
  } = {},
): OpenAiTokenUsage {
  const usage = objectRecord(objectRecord(payload).usage);
  const rawInputTokens = numberValue(usage.input_tokens) ?? numberValue(usage.prompt_tokens);
  const rawOutputTokens = numberValue(usage.output_tokens) ?? numberValue(usage.completion_tokens);
  const inputTokens = Math.trunc(
    rawInputTokens ?? fallback.inputTokens ?? estimateTokens(fallback.prompt ?? ""),
  );
  const outputTokens = Math.trunc(
    rawOutputTokens ?? fallback.outputTokens ?? estimateTokens(fallback.text ?? ""),
  );
  const totalTokens = Math.trunc(
    numberValue(usage.total_tokens) ?? inputTokens + outputTokens,
  );
  const inputDetails = {
    ...objectRecord(usage.prompt_tokens_details),
    ...objectRecord(usage.input_tokens_details),
  };
  const outputDetails = {
    ...objectRecord(usage.completion_tokens_details),
    ...objectRecord(usage.output_tokens_details),
  };
  const cachedInputTokens = clampTokenCount(
    numberValue(inputDetails.cached_tokens) ?? 0,
    inputTokens,
  );
  const reasoningTokens = clampTokenCount(
    numberValue(outputDetails.reasoning_tokens) ?? 0,
    outputTokens,
  );

  return {
    billableInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    cachedInputTokens,
    estimated: rawInputTokens === null || rawOutputTokens === null,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    visibleOutputTokens: Math.max(0, outputTokens - reasoningTokens),
  };
}

export function openAiUsageFromTokenCounts(input: {
  estimated?: boolean;
  inputTokens: number;
  outputTokens: number;
}): OpenAiTokenUsage {
  const inputTokens = Math.max(0, Math.trunc(input.inputTokens));
  const outputTokens = Math.max(0, Math.trunc(input.outputTokens));

  return {
    billableInputTokens: inputTokens,
    cachedInputTokens: 0,
    estimated: Boolean(input.estimated),
    inputTokens,
    outputTokens,
    reasoningTokens: 0,
    totalTokens: inputTokens + outputTokens,
    visibleOutputTokens: outputTokens,
  };
}

export function openAiRealtimeUsageFromResponse(
  payload: unknown,
): OpenAiRealtimeTokenUsage | null {
  const usage = objectRecord(objectRecord(payload).usage);
  const rawInputTokens = numberValue(usage.input_tokens);
  const rawOutputTokens = numberValue(usage.output_tokens);

  if (rawInputTokens === null && rawOutputTokens === null) {
    return null;
  }

  const inputTokens = Math.trunc(rawInputTokens ?? 0);
  const outputTokens = Math.trunc(rawOutputTokens ?? 0);
  const inputDetails = {
    ...objectRecord(usage.input_token_details),
    ...objectRecord(usage.input_tokens_details),
  };
  const outputDetails = {
    ...objectRecord(usage.output_token_details),
    ...objectRecord(usage.output_tokens_details),
  };
  const cachedDetails = {
    ...objectRecord(inputDetails.cached_tokens_details),
    ...objectRecord(inputDetails.cached_token_details),
  };
  const cachedInputTokens = clampTokenCount(
    numberValue(inputDetails.cached_tokens) ??
      (numberValue(cachedDetails.text_tokens) ?? 0) +
        (numberValue(cachedDetails.audio_tokens) ?? 0),
    inputTokens,
  );
  const inputAudioTokens = clampTokenCount(
    numberValue(inputDetails.audio_tokens) ?? 0,
    inputTokens,
  );
  const inputTextTokens = clampTokenCount(
    numberValue(inputDetails.text_tokens) ?? Math.max(0, inputTokens - inputAudioTokens),
    inputTokens,
  );
  const cachedAudioTokens = clampTokenCount(
    numberValue(cachedDetails.audio_tokens) ?? 0,
    inputAudioTokens,
  );
  const cachedTextTokens = clampTokenCount(
    numberValue(cachedDetails.text_tokens) ?? Math.max(0, cachedInputTokens - cachedAudioTokens),
    inputTextTokens,
  );
  const outputAudioTokens = clampTokenCount(
    numberValue(outputDetails.audio_tokens) ?? 0,
    outputTokens,
  );
  const reasoningTokens = clampTokenCount(
    numberValue(outputDetails.reasoning_tokens) ?? 0,
    outputTokens,
  );
  const textOutputTokens = clampTokenCount(
    numberValue(outputDetails.text_tokens) ??
      Math.max(0, outputTokens - outputAudioTokens - reasoningTokens),
    outputTokens,
  );

  return {
    audioInputTokens: Math.max(0, inputAudioTokens - cachedAudioTokens),
    audioOutputTokens: Math.max(0, outputAudioTokens),
    cachedInputTokens,
    estimated: false,
    inputTokens,
    outputTokens,
    reasoningTokens,
    textInputTokens: Math.max(0, inputTextTokens - cachedTextTokens),
    textOutputTokens,
    totalTokens: Math.trunc(numberValue(usage.total_tokens) ?? inputTokens + outputTokens),
  };
}

export function buildRealtimeUsageEvents(input: {
  context: {
    aiRunId?: string | null;
    metadata?: JsonObject;
    providerUsageId?: string | null;
    sourceId?: string | null;
    sourceType?: string | null;
    userId?: string | null;
    workspaceId: string;
  };
  model: string;
  usage: OpenAiRealtimeTokenUsage;
}): UsageEventDraft[] {
  const rows: UsageEventDraft[] = [];
  const add = (usageType: UsageType, quantity: number, metadata: JsonObject) => {
    if (quantity <= 0) {
      return;
    }

    const unit = realtimeUnitCostFor({ model: input.model, usageType });
    const price = priceQuantity(quantity, unit.unitCost);

    rows.push({
      aiRunId: input.context.aiRunId ?? undefined,
      costSnapshot: price.costSnapshot,
      currency: "USD",
      customerChargeSnapshot: price.customerChargeSnapshot,
      markupSnapshot: price.markupSnapshot,
      metadata: {
        ...input.context.metadata,
        ...metadata,
        priceEstimated: unit.priceEstimated,
        priceSource: unit.priceSource,
        usageEstimated: input.usage.estimated,
      },
      model: input.model,
      provider: "openai",
      providerUsageId: input.context.providerUsageId ?? undefined,
      quantity,
      service: "realtime",
      sourceId: input.context.sourceId ?? undefined,
      sourceType: input.context.sourceType ?? undefined,
      unit: "token",
      unitCostSnapshot: price.unitCostSnapshot,
      usageType,
      userId: input.context.userId ?? undefined,
      workspaceId: input.context.workspaceId,
    });
  };

  add("realtime_text_input_tokens", input.usage.textInputTokens, {
    billingCategory: "realtime_text_input",
  });
  add("realtime_audio_input_tokens", input.usage.audioInputTokens, {
    billingCategory: "realtime_audio_input",
  });
  add("realtime_cached_input_tokens", input.usage.cachedInputTokens, {
    billingCategory: "realtime_cached_input",
  });
  add("realtime_text_output_tokens", input.usage.textOutputTokens, {
    billingCategory: "realtime_text_output",
  });
  add("realtime_audio_output_tokens", input.usage.audioOutputTokens, {
    billingCategory: "realtime_audio_output",
  });
  add("realtime_reasoning_tokens", input.usage.reasoningTokens, {
    billingCategory: "realtime_reasoning_output",
  });

  return rows;
}

export function buildLlmUsageEvents(input: {
  context: {
    actionId?: string | null;
    aiRunId?: string | null;
    metadata?: JsonObject;
    providerUsageId?: string | null;
    sourceId?: string | null;
    sourceType?: string | null;
    userId?: string | null;
    workflowRunId?: string | null;
    workspaceId: string;
  };
  model: string;
  provider?: string;
  service?: string;
  usage: OpenAiTokenUsage;
}): UsageEventDraft[] {
  const provider = input.provider ?? "openai";
  const service = input.service ?? "llm";
  const common = input.context;
  const rows: UsageEventDraft[] = [];
  const add = (usageType: UsageType, quantity: number, metadata: JsonObject) => {
    if (quantity <= 0) {
      return;
    }

    const unit = unitCostFor({ model: input.model, provider, usageType });
    const price = priceQuantity(quantity, unit.unitCost);

    rows.push({
      actionId: common.actionId ?? undefined,
      aiRunId: common.aiRunId ?? undefined,
      costSnapshot: price.costSnapshot,
      currency: "USD",
      customerChargeSnapshot: price.customerChargeSnapshot,
      markupSnapshot: price.markupSnapshot,
      metadata: {
        ...common.metadata,
        ...metadata,
        priceEstimated: unit.priceEstimated,
        priceSource: unit.priceSource,
        usageEstimated: input.usage.estimated,
      },
      model: input.model,
      provider,
      providerUsageId: common.providerUsageId ?? undefined,
      quantity,
      service,
      sourceId: common.sourceId ?? undefined,
      sourceType: common.sourceType ?? undefined,
      unit: "token",
      unitCostSnapshot: price.unitCostSnapshot,
      usageType,
      userId: common.userId ?? undefined,
      workflowRunId: common.workflowRunId ?? undefined,
      workspaceId: common.workspaceId,
    });
  };

  add("llm_input_tokens", input.usage.billableInputTokens, {
    billingCategory: "input",
    totalInputTokens: input.usage.inputTokens,
  });
  add("llm_cached_input_tokens", input.usage.cachedInputTokens, {
    billingCategory: "cached_input",
    totalInputTokens: input.usage.inputTokens,
  });
  add("llm_output_tokens", input.usage.visibleOutputTokens, {
    billingCategory: "output",
    totalOutputTokens: input.usage.outputTokens,
  });
  add("llm_reasoning_tokens", input.usage.reasoningTokens, {
    billingCategory: "reasoning_output",
    totalOutputTokens: input.usage.outputTokens,
  });

  return rows;
}

export function buildOpenAiWebSearchCallUsageEvent(input: {
  context: {
    aiRunId?: string | null;
    metadata?: JsonObject;
    providerUsageId?: string | null;
    sourceId?: string | null;
    sourceType?: string | null;
    userId?: string | null;
    workspaceId: string;
  };
  model: string;
}): UsageEventDraft {
  const normalizedModel = input.model.trim().toLowerCase();
  const isReasoningSearchModel =
    normalizedModel.startsWith("o") || normalizedModel.startsWith("gpt-5");
  const defaultPer1K = isReasoningSearchModel
    ? WEB_SEARCH_REASONING_COST_PER_1K_CALLS
    : WEB_SEARCH_NON_REASONING_COST_PER_1K_CALLS;
  const unitCost =
    (numberEnv("OPENAI_WEB_SEARCH_COST_PER_1K_CALLS") ?? defaultPer1K) / 1000;
  const price = priceQuantity(1, unitCost);

  return {
    aiRunId: input.context.aiRunId ?? undefined,
    costSnapshot: price.costSnapshot,
    currency: "USD",
    customerChargeSnapshot: price.customerChargeSnapshot,
    markupSnapshot: price.markupSnapshot,
    metadata: {
      ...input.context.metadata,
      priceSource: `${PRICE_SOURCE}:web_search_${isReasoningSearchModel ? "reasoning" : "non_reasoning"}_calls`,
    },
    model: input.model,
    provider: "openai",
    providerUsageId: input.context.providerUsageId ?? undefined,
    quantity: 1,
    service: "web_search",
    sourceId: input.context.sourceId ?? undefined,
    sourceType: input.context.sourceType ?? undefined,
    unit: "call",
    unitCostSnapshot: price.unitCostSnapshot,
    usageType: "web_search_calls",
    userId: input.context.userId ?? undefined,
    workspaceId: input.context.workspaceId,
  };
}

export function usageEventTotals(events: UsageEventDraft[]) {
  return events.reduce(
    (totals, event) => ({
      costSnapshot: roundMoney(totals.costSnapshot + event.costSnapshot),
      customerChargeSnapshot: roundMoney(
        totals.customerChargeSnapshot + event.customerChargeSnapshot,
      ),
    }),
    { costSnapshot: 0, customerChargeSnapshot: 0 },
  );
}

export function toUsageEventRow(input: UsageEventDraft): UsageEventDatabaseRow {
  const event = createUsageEvent(input);

  return {
    action_id: event.actionId ?? null,
    ai_run_id: event.aiRunId ?? null,
    cost_snapshot: String(event.costSnapshot),
    currency: event.currency,
    customer_charge_snapshot: String(event.customerChargeSnapshot),
    markup_snapshot: String(event.markupSnapshot),
    metadata: input.metadata ?? {},
    model: event.model ?? null,
    provider: event.provider,
    provider_usage_id: input.providerUsageId ?? null,
    quantity: String(event.quantity),
    service: event.service,
    source_id: event.sourceId ?? null,
    source_type: event.sourceType ?? null,
    unit: event.unit,
    unit_cost_snapshot: String(event.unitCostSnapshot),
    unit_price_snapshot: event.unitPriceSnapshot
      ? String(event.unitPriceSnapshot)
      : null,
    usage_type: event.usageType,
    user_id: event.userId ?? null,
    workflow_run_id: event.workflowRunId ?? null,
    workspace_id: event.workspaceId,
  };
}

export function toUsageEventRows(events: UsageEventDraft[]) {
  return events.map((event) => toUsageEventRow(event));
}
