import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGsmSevenBit,
  smartQuotesToPlain,
  smsSegmentCount,
  splitIntoSmsMessages,
} from "./sms-length";
import { readRepoFile } from "../testing/repo-files";

/**
 * One curly apostrophe doubled the cost of every alert.
 *
 * Found by running a real inquiry through the real pipeline and reading what
 * came out. The alert was 365 characters and went as six segments in three
 * messages, the parts arriving at 64 and 65 characters and breaking
 * mid-sentence. Three segments would have carried the same text.
 *
 * GSM-7 packs 153 characters into a concatenated segment. A single character
 * outside that alphabet -- the apostrophe in "we'll" -- drops the entire
 * message to UCS-2 and 67. smartQuotesToPlain was written for exactly this,
 * documented for exactly this, and was never called from anywhere.
 *
 * It matters more now than when it was written: the operator alerts are
 * LLM-written, and models produce typographic punctuation by default.
 */
const LIVE_ALERT =
  "Email from Marisol Okafor: burst garage water heater is flooding near the " +
  "electrical panel. Needs urgent same-day help and answers on March warranty, " +
  "liability, and insurance. Treating as urgent; we’ll keep chasing until " +
  "someone responds. Reply here to stop.\nOpen in Kyro: " +
  "https://www.kyroassistant.com/open/inbox?conversationId=87c180d6-37a1-4327-8ea3-48b9ecee1f31";

describe("the alert that actually went out", () => {
  it("was not GSM-7, because of one apostrophe", () => {
    assert.equal(isGsmSevenBit(LIVE_ALERT), false);
    assert.equal(isGsmSevenBit(smartQuotesToPlain(LIVE_ALERT)), true);
  });

  it("cost twice what it needed to", () => {
    const before = smsSegmentCount(LIVE_ALERT);
    const after = smsSegmentCount(smartQuotesToPlain(LIVE_ALERT));

    assert.equal(before, 6);
    assert.equal(after, 3);
    assert.ok(after < before, "de-curling must reduce the segment count");
  });

  it("loses nothing but the typography", () => {
    const clean = smartQuotesToPlain(LIVE_ALERT);

    assert.equal(clean.length, LIVE_ALERT.length);
    assert.ok(clean.includes("we'll keep chasing"));
  });

  it("breaks in fewer places once de-curled", () => {
    // The 64-character parts were the visible symptom: at 67 per segment there
    // is almost no room, so the splitter had to cut mid-sentence.
    const before = splitIntoSmsMessages(LIVE_ALERT, 3);
    const after = splitIntoSmsMessages(smartQuotesToPlain(LIVE_ALERT), 3);

    assert.ok(
      (after[0]?.length ?? 0) > (before[0]?.length ?? 0),
      "each part should carry more text once the message is GSM-7",
    );
  });
});

describe("both operator alert paths de-curl before splitting", () => {
  // Before, not after: the splitter measures the text it is handed, so
  // normalising afterwards leaves the segment count wrong regardless.
  for (const [label, path] of [
    ["inquiry alert", "apps/web/src/lib/voice/inbound-inquiry-notifications.ts"],
    ["urgent escalation", "apps/web/src/lib/escalation/urgent-escalation.ts"],
  ] as const) {
    it(`${label} passes the body through smartQuotesToPlain`, () => {
      const source = readRepoFile(path);

      assert.match(
        source,
        /splitIntoSmsMessages\(\s*smartQuotesToPlain\(/,
        `${label} should de-curl inside the split call`,
      );
    });

    it(`${label} leaves WhatsApp typography alone`, () => {
      // 4096 characters in one message, so the encoding buys nothing there.
      const source = readRepoFile(path);
      const branch = source.slice(
        source.indexOf("transport === \"sms\""),
      );

      assert.match(branch.slice(0, 400), /\.trim\(\)\]\.filter\(Boolean\)/);
    });
  }

  it("no longer leaves the helper unused", () => {
    // It sat in sms-length.ts documenting this exact failure, called by nothing.
    const callers = [
      "apps/web/src/lib/voice/inbound-inquiry-notifications.ts",
      "apps/web/src/lib/escalation/urgent-escalation.ts",
    ].filter((path) => readRepoFile(path).includes("smartQuotesToPlain"));

    assert.equal(callers.length, 2);
  });
});
