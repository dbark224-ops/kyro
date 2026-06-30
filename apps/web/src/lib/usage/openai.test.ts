import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLlmUsageEvents,
  buildOpenAiImageGenerationUsageEvent,
  buildOpenAiWebSearchCallUsageEvent,
  buildRealtimeUsageEvents,
  openAiImageUsageFromResponse,
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
  "KYRO_USAGE_MARKUP_RATE",
  "USAGE_MARKUP_RATE",
  "OPENAI_WEB_SEARCH_COST_PER_1K_CALLS",
  "OPENAI_IMAGE_COST_PER_IMAGE",
  "OPENAI_IMAGE_TEXT_INPUT_COST_PER_1M",
  "OPENAI_IMAGE_CACHED_TEXT_INPUT_COST_PER_1M",
  "OPENAI_IMAGE_INPUT_COST_PER_1M",
  "OPENAI_IMAGE_CACHED_INPUT_COST_PER_1M",
  "OPENAI_IMAGE_OUTPUT_COST_PER_1M",
  "OPENAI_GPT_IMAGE_1_IMAGE_TEXT_INPUT_COST_PER_1M",
  "OPENAI_GPT_IMAGE_1_IMAGE_CACHED_TEXT_INPUT_COST_PER_1M",
  "OPENAI_GPT_IMAGE_1_IMAGE_INPUT_COST_PER_1M",
  "OPENAI_GPT_IMAGE_1_IMAGE_CACHED_INPUT_COST_PER_1M",
  "OPENAI_GPT_IMAGE_1_IMAGE_OUTPUT_COST_PER_1M",
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
      assert.equal(event.costSnapshot, 0.025);
    }));

  it("uses the global Kyro usage markup when no OpenAI-specific markup is set", () =>
    withoutPriceEnv(() => {
      process.env.OPENAI_WEB_SEARCH_COST_PER_1K_CALLS = "20";
      process.env.KYRO_USAGE_MARKUP_RATE = "0.4";

      const event = buildOpenAiWebSearchCallUsageEvent({
        context: {
          workspaceId: "22222222-2222-4222-8222-222222222222",
        },
        model: "gpt-4.1-mini",
      });

      assert.equal(event.costSnapshot, 0.02);
      assert.equal(event.customerChargeSnapshot, 0.028);
      assert.equal(event.markupSnapshot, 0.4);
    }));

  it("lets workspace usage markup override OpenAI env markup", () =>
    withoutPriceEnv(() => {
      process.env.OPENAI_WEB_SEARCH_COST_PER_1K_CALLS = "20";
      process.env.OPENAI_LLM_MARKUP_RATE = "0.75";

      const event = buildOpenAiWebSearchCallUsageEvent({
        context: {
          usageMarkupRate: 0.1,
          workspaceId: "22222222-2222-4222-8222-222222222222",
        },
        model: "gpt-4.1-mini",
      });

      assert.equal(event.costSnapshot, 0.02);
      assert.equal(event.customerChargeSnapshot, 0.022);
      assert.equal(event.markupSnapshot, 0.1);
    }));

  it("normalizes OpenAI image generation usage into text, image, and output token buckets", () => {
    const usage = openAiImageUsageFromResponse({
      usage: {
        input_tokens: 300,
        input_tokens_details: {
          image_tokens: 220,
          text_tokens: 80,
        },
        output_tokens: 1056,
        total_tokens: 1356,
      },
    });

    assert.ok(usage);
    assert.equal(usage.inputTokens, 300);
    assert.equal(usage.textInputTokens, 80);
    assert.equal(usage.imageInputTokens, 220);
    assert.equal(usage.outputImageTokens, 1056);
    assert.equal(usage.totalTokens, 1356);
    assert.equal(usage.tokenSplitEstimated, false);
  });

  it("prices OpenAI image generation from provider token usage when available", () =>
    withoutPriceEnv(() => {
      const providerUsage = openAiImageUsageFromResponse({
        usage: {
          input_tokens: 300,
          input_tokens_details: {
            image_tokens: 220,
            text_tokens: 80,
          },
          output_tokens: 1056,
          total_tokens: 1356,
        },
      });

      assert.ok(providerUsage);

      const event = buildOpenAiImageGenerationUsageEvent({
        context: {
          providerUsageId: "img_123",
          userId: "00000000-0000-4000-8000-000000000002",
          workspaceId: "00000000-0000-4000-8000-000000000003",
        },
        editMode: true,
        model: "gpt-image-1",
        providerUsage,
        quality: "medium",
        size: "1024x1024",
      });

      assert.equal(event.usageType, "image_generation");
      assert.equal(event.quantity, 1);
      assert.equal(event.unit, "image");
      assert.equal(event.costSnapshot, 0.04484);
      assert.equal(
        event.metadata?.usagePricingMethod,
        "provider_image_token_usage",
      );
      assert.equal(event.metadata?.priceEstimated, false);
      assert.deepEqual(event.metadata?.imageUsage, {
        cachedImageInputTokens: 0,
        cachedTextInputTokens: 0,
        imageInputTokens: 220,
        inputTokens: 300,
        outputImageTokens: 1056,
        outputTokens: 1056,
        textInputTokens: 80,
        tokenSplitEstimated: false,
        totalTokens: 1356,
      });
      assert.equal(toUsageEventRows([event])[0].provider_usage_id, "img_123");
    }));

  it("falls back to per-image image pricing when OpenAI does not return image usage", () =>
    withoutPriceEnv(() => {
      const event = buildOpenAiImageGenerationUsageEvent({
        context: {
          workspaceId: "00000000-0000-4000-8000-000000000003",
        },
        editMode: false,
        model: "gpt-image-1",
        quality: "medium",
        size: "1024x1024",
      });

      assert.equal(event.costSnapshot, 0.042);
      assert.equal(event.metadata?.usageEstimated, true);
      assert.equal(event.metadata?.usagePricingMethod, "per_image_snapshot");
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
      assert.equal(
        toUsageEventRows(events)[0].provider_usage_id,
        "resp_realtime_123",
      );
      assert.equal(usageEventTotals(events).costSnapshot, 0.04796);
    }));
});
