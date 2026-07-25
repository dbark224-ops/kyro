import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextOutboundAttemptAtIso,
  outboundRetryDecision,
  PermanentOutboundError,
} from "./outbound";

const FAILED_AT = "2026-07-25T10:00:00.000Z";

describe("outboundRetryDecision", () => {
  it("schedules a retry for an ordinary failure", () => {
    const { nextAttemptAt, status } = outboundRetryDecision({
      attemptCount: 1,
      error: new Error("Twilio timed out"),
      failedAt: FAILED_AT,
      maxAttempts: 5,
    });

    assert.equal(status, "retry_scheduled");
    assert.ok(nextAttemptAt);
    assert.ok(new Date(nextAttemptAt).getTime() > new Date(FAILED_AT).getTime());
  });

  it("sends a permanent failure straight to failed", () => {
    // The 2026-07-25 dead letter: an SMS to +1575855239 retried for two days
    // and got the same rejection every time, because the number cannot exist.
    const { nextAttemptAt, status } = outboundRetryDecision({
      attemptCount: 1,
      error: new PermanentOutboundError(
        "Kyro cannot send to +1575855239 because it is not a valid phone number.",
      ),
      failedAt: FAILED_AT,
      maxAttempts: 5,
    });

    assert.equal(status, "failed");
    assert.equal(nextAttemptAt, null);
  });

  it("does not retry a permanent failure even on the first attempt", () => {
    const { status } = outboundRetryDecision({
      attemptCount: 0,
      error: new PermanentOutboundError("This contact has no phone number."),
      failedAt: FAILED_AT,
      maxAttempts: 5,
    });

    assert.equal(status, "failed");
  });

  it("still fails out an ordinary error once attempts are exhausted", () => {
    const { nextAttemptAt, status } = outboundRetryDecision({
      attemptCount: 5,
      error: new Error("Twilio timed out"),
      failedAt: FAILED_AT,
      maxAttempts: 5,
    });

    assert.equal(status, "failed");
    assert.equal(nextAttemptAt, null);
  });

  it("treats a permanent error thrown as a plain Error as retryable", () => {
    // Guards the contract: only the dedicated class suppresses retries, so a
    // caller that forgets it gets the old, safe behaviour rather than silently
    // losing the message.
    const { status } = outboundRetryDecision({
      attemptCount: 1,
      error: new Error("not a valid phone number"),
      failedAt: FAILED_AT,
      maxAttempts: 5,
    });

    assert.equal(status, "retry_scheduled");
  });
});

describe("PermanentOutboundError", () => {
  it("is an Error with a distinguishable name", () => {
    const error = new PermanentOutboundError("bad number");

    assert.ok(error instanceof Error);
    assert.ok(error instanceof PermanentOutboundError);
    assert.equal(error.name, "PermanentOutboundError");
    assert.equal(error.message, "bad number");
  });
});

describe("nextOutboundAttemptAtIso", () => {
  it("backs off further on each successive attempt", () => {
    const first = nextOutboundAttemptAtIso(1, 5, new Date(FAILED_AT));
    const second = nextOutboundAttemptAtIso(2, 5, new Date(FAILED_AT));

    assert.ok(first);
    assert.ok(second);
    assert.ok(new Date(second).getTime() > new Date(first).getTime());
  });

  it("returns null once attempts are exhausted", () => {
    assert.equal(nextOutboundAttemptAtIso(5, 5, new Date(FAILED_AT)), null);
  });
});
