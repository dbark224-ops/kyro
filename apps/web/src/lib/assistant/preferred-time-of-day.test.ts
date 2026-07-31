import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAssistantCalendarTime,
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

  it("reads a time asked for outright", () => {
    // The commonest phrasing of all, and the one my first pass at this missed:
    // no after/before to anchor on, so it produced no window and the customer
    // was still offered the first slot of the day.
    assert.equal(
      preferredTimeOfDayWindow("Friday at 10am")?.earliestMinutes,
      MINUTES(10),
    );
    assert.equal(
      preferredTimeOfDayWindow("could you come Friday at 3pm")?.earliestMinutes,
      MINUTES(15),
    );
    assert.equal(
      preferredTimeOfDayWindow("2:30pm Tuesday suits")?.earliestMinutes,
      MINUTES(14, 30),
    );
    assert.equal(
      preferredTimeOfDayWindow("about 11 o'clock")?.earliestMinutes,
      MINUTES(11),
    );
  });

  it("does not mistake the other numbers in a message for a time", () => {
    // These messages are full of bare numbers. A meridiem or o'clock is
    // required precisely so none of these reads as a request for an hour.
    for (const text of [
      "615 Girard Blvd NE, Albuquerque, NM 87106",
      "my number is 505 555 0121",
      "250L electric, about 14 years old",
      "Friday at 10",
      "the 3 bedroom at 88 Silver Ave",
    ]) {
      assert.equal(preferredTimeOfDayWindow(text), null, text);
    }
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

/**
 * A regression in the first version of this, found by probing it rather than
 * by any test failing.
 *
 * One window cannot express two options. "Tuesday morning or Thursday
 * afternoon, either works" took a ceiling of noon from "morning" AND a floor
 * of noon from "afternoon", leaving something only a slot starting at exactly
 * 12:00 could satisfy. "mornings or after 4pm" was worse -- floor 16:00 with
 * ceiling 12:00, which nothing can ever match.
 *
 * Both fail safe, because no slot matches and Kyro offers no time and asks.
 * But that turns a customer who gave two perfectly good options into one it
 * cannot answer, which is its own kind of wrong.
 */
describe("a customer offering alternatives", () => {
  it("gets no window rather than an unsatisfiable one", () => {
    for (const text of [
      "Tuesday morning or Thursday afternoon, either works",
      "mornings or after 4pm",
      "any afternoon, or Saturday morning",
      "either Friday afternoon or Monday morning",
    ]) {
      assert.equal(preferredTimeOfDayWindow(text), null, text);
    }
  });

  it("never returns a window nothing can satisfy", () => {
    // Belt and braces: whatever the wording, a floor at or past the ceiling
    // describes no time at all and is not worth acting on.
    for (const text of [
      "mornings but not before 3pm",
      "after 5pm and before 9am",
    ]) {
      const window = preferredTimeOfDayWindow(text);

      if (window?.earliestMinutes != null && window.latestMinutes != null) {
        assert.ok(
          window.earliestMinutes < window.latestMinutes,
          `${text} produced an impossible window`,
        );
      }
    }
  });

  it("still reads a single constraint", () => {
    // The guard must not swallow the ordinary case it was built for.
    assert.equal(
      preferredTimeOfDayWindow("Friday afternoon")?.earliestMinutes,
      MINUTES(12),
    );
    assert.equal(
      preferredTimeOfDayWindow("after 2pm")?.earliestMinutes,
      MINUTES(14),
    );
    assert.equal(
      preferredTimeOfDayWindow("mornings only")?.latestMinutes,
      MINUTES(12),
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

/**
 * Re-measured on phrasings this file did not invent, the audit that found
 * roughly half missing in three other rules the same night. This one got six
 * of ten.
 *
 * "Any time after lunch" produced no window at all, which meant a customer who
 * said it could still be offered eight in the morning -- the exact fault this
 * file exists to prevent. Midday simply has names before it has numbers, and
 * "lunch" was not one of them, so both "before lunch" and "after lunch" reached
 * the bound reader and came back empty.
 */
describe("the times of day people name without naming a clock", () => {
  const window = (text: string) => preferredTimeOfDayWindow(text);

  it("reads midday when it is called lunch", () => {
    assert.deepEqual(window("before lunch if you can")?.latestMinutes, 12 * 60);
    assert.deepEqual(window("any time after lunch")?.earliestMinutes, 12 * 60);
    assert.deepEqual(window("after midday please")?.earliestMinutes, 12 * 60);
  });

  it("reads the morning when it is asked for by feel", () => {
    for (const text of [
      "mornings suit us best",
      "first thing would be ideal",
      "early as possible",
      "the earliest slot you have",
    ]) {
      assert.equal(window(text)?.latestMinutes, 12 * 60, text);
    }
  });

  it("keeps refusing what it cannot safely read", () => {
    // These were hard-won and must survive the widening. "At work until four"
    // is a floor wearing a ceiling's clothes, and two options cannot be one
    // window.
    for (const text of [
      "I'm at work until four",
      "up until 4pm",
      "mornings or after 4pm",
      "Tuesday morning or Thursday afternoon, either works",
    ]) {
      assert.equal(window(text), null, text);
    }
  });

  it("still lets an explicit time beat a vague one", () => {
    assert.equal(window("afternoon, after 2pm")?.earliestMinutes, 14 * 60);
  });
});

/**
 * "The first Monday of next month" fell through to the plain weekday reader,
 * which answers "the next Monday". Asked on 30 July that gave 3 August and
 * looked correct; asked on 5 August it gave 10 August when the answer was 7
 * September, and on 15 September it gave 21 September for 5 October. Right
 * once in three by coincidence, and confidently wrong twice -- a date the
 * customer never asked for, offered as though they had.
 *
 * Recurring maintenance rounds get described exactly this way, so it is read
 * properly rather than refused.
 */
describe("the first Monday of next month", () => {
  const TZ = "America/Denver";
  const on = (iso: string, prompt: string) =>
    parseAssistantCalendarTime(prompt, {
      now: new Date(iso),
      timeZone: TZ,
    } as never);

  it("answers the month asked about, not the next weekday", () => {
    assert.equal(
      on("2026-08-05T18:00:00Z", "book it for the first Monday of next month at 9am")
        ?.startsAt.slice(0, 10),
      "2026-09-07",
    );
    assert.equal(
      on("2026-09-15T18:00:00Z", "book it for the first Monday of next month at 9am")
        ?.startsAt.slice(0, 10),
      "2026-10-05",
    );
  });

  it("counts from the end for the last one", () => {
    assert.equal(
      on("2026-08-05T18:00:00Z", "book it for the last Friday of next month at 9am")
        ?.startsAt.slice(0, 10),
      "2026-09-25",
    );
  });

  it("gives up rather than answer a different question", () => {
    // A fifth Tuesday that does not exist, and a date already gone. Falling
    // through to the plain weekday reader would answer something else
    // entirely, and this is the only reader here that can land behind today.
    assert.equal(
      on("2026-09-25T18:00:00Z", "book it for the first Monday of this month at 9am"),
      null,
    );
  });
});

/**
 * "Late afternoon" was reading as "afternoon", so a customer who asked for
 * late afternoon could be offered half past twelve, and "early morning" read
 * as "morning" and could be offered half eleven.
 *
 * Both produced a window and both matched a slot, so nothing looked broken.
 * They were rule 2 of the conduct document all the same: proposing the one
 * thing the customer had not asked for, while appearing to honour them.
 *
 * Found by re-measuring a reader fixed earlier the same night instead of
 * trusting the earlier score.
 */
describe("a qualified part of the day means what it says", () => {
  const TZ = "America/Denver";
  const at = (hour: number, minute = 0) =>
    new Date(Date.UTC(2026, 7, 3, hour + 6, minute)).toISOString();

  it("keeps the qualifier rather than falling back to the half-day", () => {
    const cases: Array<[string, number, number, boolean]> = [
      // phrase, hour, minute, should this slot be offered
      ["late afternoon", 12, 30, false],
      ["late afternoon", 13, 0, false],
      ["late afternoon", 16, 0, true],
      // "Early morning" and "first thing" keep the plain morning ceiling on
      // purpose -- see the reader. An early preference is a preference, and
      // pinning it tight would match nothing at all on a fully booked morning,
      // which costs more than an earlier-than-ideal slot the customer can
      // still accept or decline.
      ["early morning", 8, 0, true],
      ["first thing", 8, 0, true],
      ["mid morning", 10, 0, true],
      ["mid morning", 8, 0, false],
      // Lunch is a window, not a boundary.
      ["over lunch", 12, 30, true],
      ["over lunch", 9, 0, false],
      ["over lunch", 16, 0, false],
      ["end of the day", 17, 0, true],
      ["end of the day", 10, 0, false],
      // Said constantly by customers with children, and a real constraint.
      ["after the school run", 15, 30, true],
      ["after the school run", 11, 0, false],
    ];

    for (const [phrase, hour, minute, want] of cases) {
      assert.equal(
        slotMatchesTimeOfDay(
          at(hour, minute),
          TZ,
          preferredTimeOfDayWindow(phrase),
        ),
        want,
        `${phrase} at ${hour}:${String(minute).padStart(2, "0")}`,
      );
    }
  });

  it("leaves the plain half-day readers alone", () => {
    // The counterweight: adding the qualified phrases must not narrow the
    // general ones, which were already right.
    for (const [phrase, hour, want] of [
      ["morning", 9, true],
      ["morning", 15, false],
      ["afternoon", 13, true],
      ["afternoon", 9, false],
      ["evening", 18, true],
      ["evening", 10, false],
    ] as Array<[string, number, boolean]>) {
      assert.equal(
        slotMatchesTimeOfDay(at(hour), TZ, preferredTimeOfDayWindow(phrase)),
        want,
        `${phrase} at ${hour}`,
      );
    }
  });
});
