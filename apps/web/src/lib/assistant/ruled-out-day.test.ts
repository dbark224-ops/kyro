import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { namesRuledOutDay } from "./calendar-intent";

/**
 * The extractor kept recording the day a customer ruled out.
 *
 * "I'm away Thursday and Friday this week so don't come then" came back as
 * preferredTime "Thursday", and went on doing so after the schema was told in
 * as many words never to record an unavailability as a preferred time. The
 * same run also listed "Preferred time" as missing, so the model asserted both
 * at once. A prompt rule is a request, not a guarantee.
 *
 * It had been patched downstream, where the calendar window refuses a summary
 * naming only excluded days. That stopped Kyro offering Thursday but left the
 * stored fact wrong -- shown to the owner as "Preferred", and handed to the
 * quote writer as "Preferred time: Thursday".
 *
 * This decides one specific day rather than a whole message, so it also covers
 * the mixed case the downstream check cannot see.
 */
const AWAY = "I'm away Thursday and Friday this week so don't come then.";

describe("a day the customer ruled out", () => {
  it("catches the extraction that started this", () => {
    assert.equal(namesRuledOutDay(AWAY, "Thursday"), true);
  });

  it("catches the second excluded day in the same clause", () => {
    assert.equal(namesRuledOutDay(AWAY, "Friday"), true);
  });

  it("catches a mixed message, where every-day-excluded cannot", () => {
    // One day offered and another refused. The broader check says nothing here
    // because not every named day is excluded.
    const text = "I'm free Monday but away Thursday.";

    assert.equal(namesRuledOutDay(text, "Thursday"), true);
    assert.equal(namesRuledOutDay(text, "Monday"), false);
  });

  it("matches the day, not the spelling", () => {
    // The customer and the model are different authors.
    assert.equal(namesRuledOutDay("Can't do Thurs.", "Thursday"), true);
    assert.equal(namesRuledOutDay(AWAY, "thursday morning"), true);
  });
});

describe("what must survive", () => {
  it("keeps a day the customer actually offered", () => {
    assert.equal(
      namesRuledOutDay("Thursday morning suits me best.", "Thursday"),
      false,
    );
  });

  it("keeps a day the customer never mentioned", () => {
    // Nothing to contradict, so nothing to drop. Silence is not exclusion.
    assert.equal(namesRuledOutDay(AWAY, "Monday"), false);
  });

  it("keeps a time of day carrying no weekday", () => {
    assert.equal(namesRuledOutDay(AWAY, "Mornings"), false);
    assert.equal(namesRuledOutDay(AWAY, "Weekday mornings"), false);
    assert.equal(namesRuledOutDay(AWAY, "After 5pm"), false);
  });

  it("keeps a day excluded only once out of two mentions", () => {
    // "not this Thursday, but Thursday week is fine" has offered Thursday.
    assert.equal(
      namesRuledOutDay(
        "Not this Thursday, but Thursday the week after is fine.",
        "Thursday",
      ),
      false,
    );
  });

  it("says nothing about an empty or dateless candidate", () => {
    assert.equal(namesRuledOutDay(AWAY, ""), false);
    assert.equal(namesRuledOutDay("", "Thursday"), false);
  });
});

/**
 * Measured on twelve fresh ways of saying "not that day" and five were heard.
 *
 * The reader only ever looked BACKWARDS from the day, and English puts the
 * refusal after the noun at least as often: "Wednesday doesn't work", "Friday
 * is out", "Tuesday's no good for me". Nothing sits in front of the day in any
 * of those.
 *
 * Two more were their own shape. "Anything but Friday" was actively broken by
 * a guard rather than merely missed -- " but " is treated as the start of a
 * fresh clause, which is right for "can't do Wednesday but Thursday is fine"
 * and exactly wrong here, where "but" IS the refusal. And "we're on holiday
 * Friday" used words no exclusion list had: holiday, at work, out of town.
 *
 * Same class as the other readers swept tonight, on the rule whose failure is
 * the most visible to a customer -- being offered the one day they told you
 * they could not do.
 */
describe("a day ruled out after it is named, not just before", () => {
  it("hears the refusal wherever it sits in the sentence", () => {
    for (const [text, day] of [
      ["Tuesday's no good for me", "tuesday"],
      ["Wednesday doesn't work", "wednesday"],
      ["Friday is out", "friday"],
      ["Thursday is no use to me", "thursday"],
      ["Monday I'm out of town", "monday"],
      ["I'm working Wednesday so not then", "wednesday"],
      ["we're on holiday Friday", "friday"],
      ["I'm at work Tuesday", "tuesday"],
      ["anything but Friday", "friday"],
      ["any day but Monday", "monday"],
    ] as Array<[string, string]>) {
      assert.equal(namesRuledOutDay(text, day), true, text);
    }
  });

  it("never takes away a day the customer offered", () => {
    // The counterweight, and the more important half: reading an available day
    // as ruled out removes the appointment the customer was asking for.
    //
    // "can't do Wednesday but Thursday is fine" is the case the clause split
    // exists for, and it must survive the "any day but X" exception above.
    for (const [text, day] of [
      ["can't do Wednesday but Thursday is fine", "thursday"],
      ["Thursday would be great", "thursday"],
      ["Monday or Tuesday both work", "monday"],
      ["Tuesday works well", "tuesday"],
      ["Friday is fine", "friday"],
      ["I can do Monday", "monday"],
      ["Thursday is good for us", "thursday"],
      ["how about Tuesday", "tuesday"],
      ["Friday morning if that works", "friday"],
    ] as Array<[string, string]>) {
      assert.equal(namesRuledOutDay(text, day), false, text);
    }
  });
});
