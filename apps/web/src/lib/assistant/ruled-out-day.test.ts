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
