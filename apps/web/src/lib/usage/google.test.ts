import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGoogleApiUsageEvent } from "./google";
import { toUsageEventRows } from "./openai";

const priceEnvKeys = [
  "GOOGLE_ADDRESS_VALIDATION_COST_PER_1K_CALLS",
  "GOOGLE_API_COST_PER_1K_CALLS",
  "GOOGLE_API_MARKUP_RATE",
  "GOOGLE_PLACES_AUTOCOMPLETE_COST_PER_1K_CALLS",
  "GOOGLE_PLACES_DETAILS_COST_PER_1K_CALLS",
  "USAGE_MARKUP_RATE",
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

describe("Google usage metering", () => {
  it("meters Places autocomplete as provider API calls", () => {
    withoutPriceEnv(() => {
      const event = buildGoogleApiUsageEvent({
        kind: "places_autocomplete",
        userId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
      });
      const [row] = toUsageEventRows([event]);

      assert.equal(event.provider, "google");
      assert.equal(event.service, "google_maps");
      assert.equal(event.usageType, "provider_api_calls");
      assert.equal(event.model, "places-autocomplete");
      assert.equal(event.unit, "call");
      assert.equal(event.quantity, 1);
      assert.equal(event.costSnapshot, 0.00283);
      assert.equal(event.customerChargeSnapshot, 0.0035375);
      assert.equal(row.usage_type, "provider_api_calls");
      assert.equal(row.provider, "google");
    });
  });

  it("uses specific env pricing before generic pricing", () => {
    withoutPriceEnv(() => {
      process.env.GOOGLE_API_COST_PER_1K_CALLS = "9";
      process.env.GOOGLE_PLACES_DETAILS_COST_PER_1K_CALLS = "20";
      process.env.GOOGLE_API_MARKUP_RATE = "0.5";

      const event = buildGoogleApiUsageEvent({
        kind: "places_details",
        workspaceId: "22222222-2222-4222-8222-222222222222",
      });

      assert.equal(event.costSnapshot, 0.02);
      assert.equal(event.customerChargeSnapshot, 0.03);
      assert.equal(
        event.metadata?.priceSource,
        "env:GOOGLE_PLACES_DETAILS_COST_PER_1K_CALLS",
      );
    });
  });
});
