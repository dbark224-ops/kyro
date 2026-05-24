import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLlmUsageEvents,
  buildOpenAiWebSearchCallUsageEvent,
  buildRealtimeUsageEvents,
  openAiRealtimeUsageFromResponse,
  openAiUsageFromResponse,
  toUsageEventRows,
  usageEventTotals,
} from "./openai";

const priceEnvKeys = [
  "OPENAI_GPT_4_1_MINI_INPUT_COST_PER_1M",
  "OPENAI_GPT_4_1_MINI_CACHED_INPUT_COST_PER_1M",
  "OPENAI_GPT_4_1_MINI_OUTPUT_COST_PER_1M",
  "OPENAI_LLM_INPUT_COST_PER_1M",
  "OPENAI_LLM_CACHED_INPUT_COST_PER_1M",
  "OPENAI_LLM_OUTPUT_COST_PER_1M",
  "OPENAI_LLM_MARKUP_RATE",
  "USAGE_MARKUP_RATE",
  "OPENAI_WEB_SEARCH_COST_PER_1K_CALLS",
  "OPENAI_REALTIME_AUDIO_INPUT_COST_PER_1M",
  "OPENAI_REALTIME_AUDIO_OUTPUT_COST_PER_1M",
  "OPENAI_REALTIME_CACHED_INPUT_COST_PER_1M",
  "OPENAI_REALTIME_TEXT_INPUT_COST_PER_1M",
  "OPENAI_REALTIME_TEXT_OUTPUT_COST_PER_1M",
];

function withoutPriceEnv<T>(callback: () => T) {
  const previous = new Map(priceEnvKeys.map((key) => [key, process.env[key]]));

  for (const key of priceEnvKeys) {
    delete process.env[key];
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("OpenAI usage metering", () => {
  it("normalizes Responses usage into billable input, cached input, output, and reasoning buckets", () => {
    const usage = openAiUsageFromResponse(
      {
        id: "resp_123",
        usage: {
          input_tokens: 120,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 5 },
          total_tokens: 150,
        },
      },
      { prompt: "fallback prompt", text: "fallback text" },
    );

    assert.equal(usage.inputTokens, 120);
    assert.equal(usage.billableInputTokens, 100);
    assert.equal(usage.cachedInputTokens, 20);
    assert.equal(usage.outputTokens, 30);
    assert.equal(usage.visibleOutputTokens, 25);
    assert.equal(usage.reasoningTokens, 5);
    assert.equal(usage.estimated, false);
  });

  it("creates priced ledger rows for each OpenAI token bucket", () =>
    withoutPriceEnv(() => {
      const usage = openAiUsageFromResponse({
        usage: {
          input_tokens: 120,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 5 },
        },
      });
      const events = buildLlmUsageEvents({
        context: {
          aiRunId: "00000000-0000-4000-8000-000000000001",
          providerUsageId: "resp_123",
          sourceId: "00000000-0000-4000-8000-000000000001",
          sourceType: "ai_run",
          userId: "00000000-0000-4000-8000-000000000002",
          workspaceId: "00000000-0000-4000-8000-000000000003",
        },
        model: "gpt-4.1-mini",
        provider: "openai",
        usage,
      });

      assert.deepEqual(
        events.map((event) => [event.usageType, event.quantity]),
        [
          ["llm_input_tokens", 100],
          ["llm_cached_input_tokens", 20],
          ["llm_output_tokens", 25],
          ["llm_reasoning_tokens", 5],
        ],
      );
      assert.equal(usageEventTotals(events).costSnapshot, 0.00009);

      const rows = toUsageEventRows(events);
      assert.equal(rows[0].provider_usage_id, "resp_123");
      assert.equal(rows[1].metadata.billingCategory, "cached_input");
    }));

  it("supports legacy Chat Completions usage fields", () => {
    const usage = openAiUsageFromResponse({
      usage: {
        completion_tokens: 16,
        prompt_tokens: 64,
        prompt_tokens_details: { cached_tokens: 8 },
      },
    });

    assert.equal(usage.inputTokens, 64);
    assert.equal(usage.billableInputTokens, 56);
    assert.equal(usage.cachedInputTokens, 8);
    assert.equal(usage.outputTokens, 16);
  });

  it("records OpenAI web search tool calls separately from tokens", () =>
    withoutPriceEnv(() => {
      const event = buildOpenAiWebSearchCallUsageEvent({
        context: {
          userId: "00000000-0000-4000-8000-000000000002",
          workspaceId: "00000000-0000-4000-8000-000000000003",
        },
        model: "gpt-4.1-mini",
      });

      assert.equal(event.usageType, "web_search_calls");
      assert.equal(event.quantity, 1);
      assert.equal(event.costSnapshot, 0.01);
    }));

  it("normalizes realtime usage into text, audio, cached, and reasoning rows", () =>
    withoutPriceEnv(() => {
      const usage = openAiRealtimeUsageFromResponse({
        usage: {
          input_token_details: {
            audio_tokens: 700,
            cached_tokens: 100,
            cached_tokens_details: {
              audio_tokens: 60,
              text_tokens: 40,
            },
            text_tokens: 300,
          },
          input_tokens: 1000,
          output_token_details: {
            audio_tokens: 360,
            reasoning_tokens: 20,
            text_tokens: 120,
          },
          output_tokens: 500,
          total_tokens: 1500,
        },
      });

      assert.ok(usage);
      assert.equal(usage.textInputTokens, 260);
      assert.equal(usage.audioInputTokens, 640);
      assert.equal(usage.cachedInputTokens, 100);
      assert.equal(usage.textOutputTokens, 120);
      assert.equal(usage.audioOutputTokens, 360);
      assert.equal(usage.reasoningTokens, 20);

      const events = buildRealtimeUsageEvents({
        context: {
          providerUsageId: "resp_realtime_123",
          userId: "00000000-0000-4000-8000-000000000002",
          workspaceId: "00000000-0000-4000-8000-000000000003",
        },
        model: "gpt-realtime-2",
        usage,
      });

      assert.deepEqual(
        events.map((event) => [event.usageType, event.quantity]),
        [
          ["realtime_text_input_tokens", 260],
          ["realtime_audio_input_tokens", 640],
          ["realtime_cached_input_tokens", 100],
          ["realtime_text_output_tokens", 120],
          ["realtime_audio_output_tokens", 360],
          ["realtime_reasoning_tokens", 20],
        ],
      );
      assert.equal(toUsageEventRows(events)[0].provider_usage_id, "resp_realtime_123");
      assert.equal(usageEventTotals(events).costSnapshot, 0.04796);
    }));
});
