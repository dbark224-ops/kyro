import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openAiTtsCost } from "./speech";

function withTtsCostEnv<T>(value: string | undefined, callback: () => T) {
  const previous = process.env.OPENAI_TTS_UNIT_COST_PER_SECOND_USD;

  if (value === undefined) {
    delete process.env.OPENAI_TTS_UNIT_COST_PER_SECOND_USD;
  } else {
    process.env.OPENAI_TTS_UNIT_COST_PER_SECOND_USD = value;
  }

  try {
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_TTS_UNIT_COST_PER_SECOND_USD;
    } else {
      process.env.OPENAI_TTS_UNIT_COST_PER_SECOND_USD = previous;
    }
  }
}

describe("OpenAI speech usage pricing", () => {
  it("uses the default gpt-4o-mini-tts rate card when no per-second override is configured", () =>
    withTtsCostEnv(undefined, () => {
      const pricing = openAiTtsCost({
        estimatedSeconds: 10,
        model: "gpt-4o-mini-tts",
        text: "hello world",
      });

      assert.equal(pricing.cost, 0.0024018);
      assert.equal(pricing.priceEstimated, true);
      assert.match(pricing.priceSource, /gpt-4o-mini-tts/);
      assert.equal(pricing.unitCost, 0.00024018);
    }));

  it("does not treat a blank env override as zero-cost usage", () =>
    withTtsCostEnv("", () => {
      const pricing = openAiTtsCost({
        estimatedSeconds: 1,
        model: "gpt-4o-mini-tts",
        text: "blank env",
      });

      assert.ok(pricing.cost > 0);
      assert.equal(pricing.priceEstimated, true);
    }));

  it("uses an explicit per-second override when configured", () =>
    withTtsCostEnv("0.001", () => {
      const pricing = openAiTtsCost({
        estimatedSeconds: 10,
        model: "gpt-4o-mini-tts",
        text: "override",
      });

      assert.equal(pricing.cost, 0.01);
      assert.equal(pricing.priceEstimated, false);
      assert.equal(pricing.priceSource, "env:OPENAI_TTS_UNIT_COST_PER_SECOND_USD");
      assert.equal(pricing.unitCost, 0.001);
    }));
});
