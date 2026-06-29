import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyUsageMarkup, usageMarkupRate } from "./pricing";

const envKeys = [
  "KYRO_USAGE_MARKUP_RATE",
  "OPENAI_LLM_MARKUP_RATE",
  "USAGE_MARKUP_RATE",
];

function withoutMarkupEnv<T>(callback: () => T) {
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));

  for (const key of envKeys) {
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

describe("usage pricing", () => {
  it("uses Kyro's global usage markup by default", () => {
    withoutMarkupEnv(() => {
      process.env.KYRO_USAGE_MARKUP_RATE = "0.35";

      assert.equal(usageMarkupRate(), 0.35);
      assert.equal(applyUsageMarkup(10, usageMarkupRate()), 13.5);
    });
  });

  it("lets provider-specific markup intentionally override the global markup", () => {
    withoutMarkupEnv(() => {
      process.env.KYRO_USAGE_MARKUP_RATE = "0.35";
      process.env.OPENAI_LLM_MARKUP_RATE = "0.2";

      assert.equal(usageMarkupRate("OPENAI_LLM_MARKUP_RATE"), 0.2);
    });
  });
});
