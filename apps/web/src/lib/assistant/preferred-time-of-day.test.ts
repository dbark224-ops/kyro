import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  preferredTimeOfDayWindow,
  slotMatchesTimeOfDay,
} from "./calendar-intent";

/**
 * Kyro honoured the day and threw away the hour.
 *
 * Found by a mock inquiry where the customer turned down a proposed time:
 * "I'm at work until four. And I can't do Thursday at all. Could we do Friday
 * afternoon instead, any time after two?"
 *
 * Thursday was correctly refused and "Friday any time after 2:00 PM" was
 * correctly stored -- and then the reply offered Friday 7:00 to 8:00 AM. The
 * date parser resolves every one of "Friday", "Friday afternoon", "after 2pm
 * Friday" and "Friday any time after 2:00 PM" to the identical
 * midnight-to-midnight window, and triage took the first free slot in it.
 *
 * Same family as being offered a day you ruled out, and it fires far more
 * often: any customer who says afternoons, evenings, or after some hour.
 */
const MINUTES = (h: number, m = 0) => h * 60 + m;

describe("the hour a customer asked for", () => {
  it("reads the request that started this", () => {
    assert.deepEqual(
      preferredTimeOfDayWindow(
        "Could we do Friday afternoon instead, any time after two?",
      ),
      { earliestMinutes: MINUTES(14), latestMinutes: null },
    );
  });

  it("reads the model's normalised version of it too", () => {
    assert.deepEqual(preferredTimeOfDayWindow("Friday any time after 2:00 PM"), {
      earliestMinutes: MINUTES(14),
      latestMinutes: null,
    });
  });

  it("prefers a named hour over a vague part of the day", () => {
    // "afternoon, after 2" is 14:00 and not 12:00 -- the specific bound is the
    // one the customer went to the trouble of writing.
    const window = preferredTimeOfDayWindow("afternoon, after 3pm please");

    assert.equal(window?.earliestMinutes, MINUTES(15));
  });

  it("assumes nobody wants a plumber at two in the morning", () => {
    assert.equal(
      preferredTimeOfDayWindow("after 2")?.earliestMinutes,
      MINUTES(14),
    );
    assert.equal(
      preferredTimeOfDayWindow("after 9")?.earliestMinutes,
      MINUTES(9),
    );
    assert.equal(
      preferredTimeOfDayWindow("after 9pm")?.earliestMinutes,
      MINUTES(21),
    );
  });

  it("reads a ceiling as well as a floor", () => {
    assert.equal(
      preferredTimeOfDayWindow("any time before 11am")?.latestMinutes,
      MINUTES(11),
    );
    assert.deepEqual(preferredTimeOfDayWindow("mornings only"), {
      earliestMinutes: null,
      latestMinutes: MINUTES(12),
    });
  });

  it("refuses to read an ambiguous bound in either direction", () => {
    // "I'm at work until four" is the sentence this customer actually wrote.
    // Reading "until" as a ceiling would have offered him only the hours he
    // is at work, which is the fault this whole function exists to prevent.
    // No bound is the honest answer; Kyro asks.
    assert.equal(preferredTimeOfDayWindow("I'm at work until four"), null);
    assert.equal(preferredTimeOfDayWindow("available up until 4pm"), null);
  });

  it("still reads the unambiguous ceilings", () => {
    assert.equal(
      preferredTimeOfDayWindow("no later than 3pm")?.latestMinutes,
      MINUTES(15),
    );
    assert.equal(
      preferredTimeOfDayWindow("not after 10am")?.latestMinutes,
      MINUTES(10),
    );
  });

  it("reads the vague parts of the day", () => {
    assert.equal(
      preferredTimeOfDayWindow("afternoons suit us")?.earliestMinutes,
      MINUTES(12),
    );
    assert.equal(
      preferredTimeOfDayWindow("evenings if possible")?.earliestMinutes,
      MINUTES(17),
    );
  });
});

describe("saying nothing about the hour", () => {
  it("is not a constraint", () => {
    // Most inquiries land here and must keep behaving exactly as before.
    for (const text of [
      "Friday please",
      "next week some time",
      "whenever suits you",
      "",
      null,
      undefined,
    ]) {
      assert.equal(preferredTimeOfDayWindow(text), null, String(text));
    }
  });

  it("lets any slot through", () => {
    assert.equal(
      slotMatchesTimeOfDay("2026-07-31T13:00:00.000Z", "America/Denver", null),
      true,
    );
  });
});

describe("matching a slot against the window", () => {
  // 2026-07-31T20:30Z is 14:30 in Denver; 13:00Z is 07:00.
  const AFTERNOON = "2026-07-31T20:30:00.000Z";
  const EARLY = "2026-07-31T13:00:00.000Z";
  const tz = "America/Denver";

  it("rejects the slot that was actually offered", () => {
    const window = preferredTimeOfDayWindow("Friday any time after 2:00 PM");

    assert.equal(slotMatchesTimeOfDay(EARLY, tz, window), false);
    assert.equal(slotMatchesTimeOfDay(AFTERNOON, tz, window), true);
  });

  it("respects a ceiling", () => {
    const window = preferredTimeOfDayWindow("mornings only");

    assert.equal(slotMatchesTimeOfDay(EARLY, tz, window), true);
    assert.equal(slotMatchesTimeOfDay(AFTERNOON, tz, window), false);
  });

  it("reads the clock in the workspace's timezone, not UTC", () => {
    // The same instant is 14:30 in Denver and 20:30 in London. Comparing UTC
    // hours would pass the London reading against a Denver customer's window.
    const window = preferredTimeOfDayWindow("after 6pm");

    assert.equal(slotMatchesTimeOfDay(AFTERNOON, tz, window), false);
    assert.equal(slotMatchesTimeOfDay(AFTERNOON, "Europe/London", window), true);
  });
});
