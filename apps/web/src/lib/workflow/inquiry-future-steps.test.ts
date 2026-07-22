import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyFutureStepFallback,
  normalizeFutureStepDecision,
} from "./inquiry-future-steps";

describe("inquiry future-step decisions", () => {
  it("recognizes a direct customer confirmation", () => {
    assert.equal(
      classifyFutureStepFallback("Yes, Tuesday at 10 works for me.").outcome,
      "confirmed",
    );
  });

  it("recognizes a counter-offer before generic agreement language", () => {
    const decision = classifyFutureStepFallback(
      "Could you come Wednesday at 11am instead?",
    );

    assert.equal(decision.outcome, "countered");
    assert.equal(
      decision.requestedTime,
      "Could you come Wednesday at 11am instead?",
    );
  });

  it("does not advance the workflow for an unrelated reply", () => {
    assert.equal(
      classifyFutureStepFallback("Can you send me a copy of the quote?")
        .outcome,
      "unrelated",
    );
  });

  it("normalizes malformed model output conservatively", () => {
    assert.deepEqual(normalizeFutureStepDecision({ outcome: "maybe" }), {
      outcome: "unrelated",
      reason: null,
      requestedTime: null,
    });
  });
});
