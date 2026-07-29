import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  smsSegmentCount,
  splitIntoSmsMessages,
} from "../communication/sms-length";
import { readRepoFile } from "../testing/repo-files";

/**
 * The escalation text went out as one message, however long it was.
 *
 * WhatsApp takes 4096 characters so it arrives whole there, which is how this
 * survived testing. Plain SMS does not: past 160 characters the message is
 * multi-segment, and a carrier that will not concatenate delivers the first
 * segment and drops the rest. On this path that means the owner reads
 * "URGENT -" and never learns what for -- on the one message in the system
 * that exists because something cannot wait.
 *
 * The inbound-inquiry alert was split for exactly this reason. This one was
 * missed, and it is the more consequential of the two.
 */
const source = readRepoFile("apps/web/src/lib/escalation/urgent-escalation.ts");
const step = source.slice(
  source.indexOf("async function sendSmsStep"),
  source.indexOf("async function escalationVapiPhoneNumberId"),
);

describe("the escalation text is split for plain SMS", () => {
  it("splits on the sms transport", () => {
    assert.match(step, /transport === "sms"/);
    assert.match(step, /splitIntoSmsMessages\(body, MAX_ESCALATION_SMS_PARTS\)/);
  });

  it("leaves WhatsApp whole, where 4096 characters fit", () => {
    assert.match(step, /\[body\.trim\(\)\]\.filter\(Boolean\)/);
  });

  it("no longer hands the whole body straight to Twilio", () => {
    assert.doesNotMatch(step, /body: escalationMessage\(incident\)/);
  });
});

describe("a part that fails does not re-text the urgent header", () => {
  it("throws only when the first part fails", () => {
    // Throwing reschedules the entire step with backoff and re-sends from the
    // top, so throwing on a later part means the owner gets "URGENT - ..."
    // twice. Only a failed first part means nothing arrived at all.
    assert.match(step, /if \(index === 0\) \{\s*throw sendError;/);
  });

  it("logs and stops on a later part rather than failing the step", () => {
    const catchBlock = step.slice(step.indexOf("} catch (sendError)"));

    assert.match(catchBlock, /console\.error\(/);
    assert.match(catchBlock, /break;/);
  });

  it("still fails loudly if nothing at all was sent", () => {
    assert.match(step, /if \(!first\) \{/);
  });
});

describe("each part is billed, because the carrier bills each part", () => {
  it("records usage inside the send loop", () => {
    const loopStart = step.indexOf("for (const [index, part] of parts.entries())");
    const usageAt = step.indexOf('.from("usage_events")');

    assert.ok(loopStart > 0 && usageAt > loopStart, "usage is written per part");
  });

  it("keeps each part's own provider message id", () => {
    assert.match(step, /provider_usage_id: result\.messageId/);
  });

  it("labels the part when there is more than one", () => {
    assert.match(step, /messagePart: index \+ 1, messageParts: parts\.length/);
  });

  it("resolves the markup rate once, not once per part", () => {
    const loopStart = step.indexOf("for (const [index, part] of parts.entries())");
    const markupAt = step.indexOf("const markupRate = await");

    assert.ok(markupAt > 0 && markupAt < loopStart);
  });
});

describe("the step keeps the first part's id", () => {
  it("returns the first message id, not the last", () => {
    assert.match(
      step,
      /return \{ messageId: first\.messageId, requestId: first\.providerRequestId \}/,
    );
  });
});

describe("the split itself holds for a realistic escalation body", () => {
  // Header, an alert body at the 300-character ceiling the prompt sets, the
  // acknowledge line, and the link.
  const body = [
    "URGENT - Burst pipe flooding kitchen",
    "Warrick Pashley in Bendigo says water is coming through the kitchen ceiling and he has turned the mains off. He wants someone out tonight if at all possible, and asked whether the previous waterproofing job is still under warranty since it is the same wall as before.",
    "Reply here and I'll stop escalating this.",
    "Or open it: https://www.kyroassistant.com/escalations/ack/11111111-2222-3333-4444-555555555555",
  ].join("\n");

  it("is more than one segment, which is the whole problem", () => {
    assert.ok(
      smsSegmentCount(body) > 1,
      "a realistic escalation does not fit one segment",
    );
  });

  it("splits into whole messages that each fit", () => {
    for (const part of splitIntoSmsMessages(body, 3)) {
      assert.ok(smsSegmentCount(part) <= 3, part);
      assert.ok(part.trim().length > 0);
    }
  });

  it("loses nothing -- every word survives the split", () => {
    const rejoined = splitIntoSmsMessages(body, 3).join(" ");

    for (const word of body.split(/\s+/).filter(Boolean)) {
      assert.ok(rejoined.includes(word), `"${word}" was dropped`);
    }
  });

  it("keeps the urgent header in the part that goes first", () => {
    assert.match(splitIntoSmsMessages(body, 3)[0] ?? "", /^URGENT - /);
  });
});
