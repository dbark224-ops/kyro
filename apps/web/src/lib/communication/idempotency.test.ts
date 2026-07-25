import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MANUAL_REPLY_DEDUPE_WINDOW_MS,
  manualReplyIdempotencyKey,
} from "./idempotency";

const base = {
  body: "On my way, should be there by 2pm.",
  channelType: "sms",
  conversationId: "conv-1",
  source: "assistant.manual_reply",
  subject: null,
};

describe("manualReplyIdempotencyKey", () => {
  it("reuses the submission key so a retry cannot double-send", () => {
    const first = manualReplyIdempotencyKey({
      ...base,
      submissionKey: "sub-1",
    });
    const retry = manualReplyIdempotencyKey({
      ...base,
      submissionKey: "sub-1",
    });

    assert.equal(first, retry);
    assert.equal(first, "assistant.manual_reply.conv-1.sub-1");
  });

  it("gives a genuinely new message a new key", () => {
    const first = manualReplyIdempotencyKey({
      ...base,
      submissionKey: "sub-1",
    });
    const second = manualReplyIdempotencyKey({
      ...base,
      submissionKey: "sub-2",
    });

    assert.notEqual(first, second);
  });

  it("keeps conversations separate under the same submission key", () => {
    const a = manualReplyIdempotencyKey({ ...base, submissionKey: "sub-1" });
    const b = manualReplyIdempotencyKey({
      ...base,
      conversationId: "conv-2",
      submissionKey: "sub-1",
    });

    assert.notEqual(a, b);
  });

  it("ignores a blank or whitespace-only submission key", () => {
    const now = new Date(1_700_000_000_000);
    const blank = manualReplyIdempotencyKey({
      ...base,
      now,
      submissionKey: "   ",
    });
    const missing = manualReplyIdempotencyKey({ ...base, now });

    assert.equal(blank, missing);
    assert.ok(!blank.includes("assistant.manual_reply.conv-1.".concat("   ")));
  });

  it("dedupes identical content inside the fallback window", () => {
    const now = new Date(1_700_000_000_000);
    const later = new Date(now.getTime() + 1_000);

    assert.equal(
      manualReplyIdempotencyKey({ ...base, now }),
      manualReplyIdempotencyKey({ ...base, now: later }),
    );
  });

  it("allows the same content again in a later fallback window", () => {
    const now = new Date(1_700_000_000_000);
    const later = new Date(now.getTime() + MANUAL_REPLY_DEDUPE_WINDOW_MS * 2);

    assert.notEqual(
      manualReplyIdempotencyKey({ ...base, now }),
      manualReplyIdempotencyKey({ ...base, now: later }),
    );
  });

  it("does not collapse different messages in the same fallback window", () => {
    const now = new Date(1_700_000_000_000);

    assert.notEqual(
      manualReplyIdempotencyKey({ ...base, now }),
      manualReplyIdempotencyKey({ ...base, body: "Running late, sorry.", now }),
    );
  });

  it("treats a differing subject as a different message", () => {
    const now = new Date(1_700_000_000_000);

    assert.notEqual(
      manualReplyIdempotencyKey({ ...base, now, subject: "Quote" }),
      manualReplyIdempotencyKey({ ...base, now, subject: "Invoice" }),
    );
  });

  it("separates channels so an email and an SMS of the same text both send", () => {
    const now = new Date(1_700_000_000_000);

    assert.notEqual(
      manualReplyIdempotencyKey({ ...base, channelType: "sms", now }),
      manualReplyIdempotencyKey({ ...base, channelType: "email", now }),
    );
  });

  it("separates sources so web, assistant and mobile never collide", () => {
    const now = new Date(1_700_000_000_000);

    assert.notEqual(
      manualReplyIdempotencyKey({
        ...base,
        now,
        source: "assistant.manual_reply",
      }),
      manualReplyIdempotencyKey({
        ...base,
        now,
        source: "mobile.inbox.manual_reply",
      }),
    );
  });
});
