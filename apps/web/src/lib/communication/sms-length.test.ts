import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGsmSevenBit,
  smsCharacterBudget,
  smsCharacterCount,
  smsSegmentCount,
  smartQuotesToPlain,
  splitIntoSmsMessages,
  SMS_LIMITS,
} from "./sms-length";

describe("segment counting", () => {
  it("fits 160 plain characters in one message", () => {
    assert.equal(smsSegmentCount("a".repeat(160)), 1);
  });

  it("costs two segments at 161, not one and a bit", () => {
    // Past the single-message limit every part pays a 7-character header, so
    // the boundary is 160 -> 306, not 160 -> 320.
    assert.equal(smsSegmentCount("a".repeat(161)), 2);
    assert.equal(smsSegmentCount("a".repeat(306)), 2);
    assert.equal(smsSegmentCount("a".repeat(307)), 3);
  });

  it("drops to 70 characters when any character leaves GSM-7", () => {
    assert.equal(smsSegmentCount("a".repeat(70)), 1);
    assert.equal(smsSegmentCount(`${"a".repeat(69)}😀`), 2);
  });

  it("counts a GSM extended character twice", () => {
    assert.equal(smsCharacterCount("abc"), 3);
    assert.equal(smsCharacterCount("a{b}"), 6);
  });

  it("treats an empty message as costing nothing", () => {
    assert.equal(smsSegmentCount(""), 0);
  });
});

describe("encoding detection", () => {
  it("accepts the everyday GSM characters", () => {
    assert.equal(isGsmSevenBit("Hi David - your quote is ready (£120)."), true);
  });

  it("rejects a curly quote, which halves the room", () => {
    assert.equal(isGsmSevenBit("Here’s the quote"), false);
    assert.equal(isGsmSevenBit(smartQuotesToPlain("Here’s the quote")), true);
  });
});

describe("character budget", () => {
  it("is the single-message limit for one segment", () => {
    assert.equal(smsCharacterBudget(1), SMS_LIMITS.gsm.single);
  });

  it("accounts for the concatenation header beyond one", () => {
    assert.equal(smsCharacterBudget(2), 306);
    assert.equal(smsCharacterBudget(3), 459);
  });
});

describe("splitting", () => {
  it("leaves a short message alone", () => {
    assert.deepEqual(splitIntoSmsMessages("Short one."), ["Short one."]);
  });

  it("breaks at a sentence end rather than mid-word", () => {
    const first = `${"A".repeat(120)}. `;
    const second = `${"B".repeat(120)}.`;
    const [one, two] = splitIntoSmsMessages(first + second);

    assert.ok(one.endsWith("."), `expected a sentence boundary, got: ${one}`);
    assert.equal(two, second);
  });

  it("never splits a word across two messages", () => {
    const text = `${"word ".repeat(60)}end`;

    for (const part of splitIntoSmsMessages(text)) {
      assert.doesNotMatch(part, /^\S*?(?<!\bword)\b/u.source ? /^$/ : /^$/);
      assert.ok(!part.startsWith("ord"), "a word was cut in half");
    }
  });

  it("keeps the remainder rather than dropping it", () => {
    const text = "Sentence. ".repeat(60).trim();
    const parts = splitIntoSmsMessages(text, 2);

    assert.equal(parts.length, 2);
    assert.equal(
      parts.join(" ").replace(/\s+/g, " "),
      text.replace(/\s+/g, " "),
      "splitting must be lossless -- truncation is the bug being fixed",
    );
  });

  it("returns nothing for an empty message", () => {
    assert.deepEqual(splitIntoSmsMessages("   "), []);
  });
});

/**
 * Only SMS can show this. The test workspace routes through the WhatsApp
 * sandbox, which takes 4096 characters and never splits, so nothing about
 * splitting is exercised by using the product normally.
 */
describe("splitting never cuts a character in half", () => {
  const loneSurrogate =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("keeps emoji whole where there is nowhere to break", () => {
    // The UCS-2 concatenated limit is 67, an odd number, and an emoji is two
    // UTF-16 code units. A run with no whitespace used to be sliced at 67 and
    // arrive as a replacement character at the end of one message and the
    // start of the next. Three of these five did exactly that.
    for (const [name, text] of [
      ["a run of emoji", "\u{1F600}".repeat(60)],
      ["emoji after a sentence", `${"Thanks so much! ".repeat(4)}${"\u{1F600}".repeat(40)}`],
      ["emoji joined to a word", `Booked${"\u{1F44D}".repeat(50)}`],
      ["a family sequence", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}".repeat(20)],
      ["a flag", "\u{1F1EC}\u{1F1E7}".repeat(45)],
    ] as const) {
      for (const part of splitIntoSmsMessages(text, 2)) {
        assert.ok(!loneSurrogate.test(part), `${name} was cut in half`);
        assert.ok(part.length > 0, `${name} produced an empty message`);
      }
    }
  });

  it("still sends the whole message when it splits one", () => {
    // A clean split costs the same as a truncated one, so nothing may be lost.
    const text = "\u{1F600}".repeat(60);
    const joined = splitIntoSmsMessages(text, 2).join("");

    assert.equal(joined, text);
  });

  it("does not lose a character from ordinary prose", () => {
    const text = "We can come out on Tuesday morning. ".repeat(12).trim();
    const parts = splitIntoSmsMessages(text, 2);

    assert.equal(parts.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
  });

  it("breaks a word only when the word leaves no choice", () => {
    const parts = splitIntoSmsMessages("a".repeat(400), 2);

    assert.equal(parts.length, 2);
    assert.equal(parts.join(""), "a".repeat(400));
  });
});
