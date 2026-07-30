import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarDateRangeFromPrompt } from "./calendar-intent";
import { readRepoFile } from "../testing/repo-files";

/**
 * Naming a day is not asking for it.
 *
 * A customer replying to her own thread wrote "I'm away Thursday and Friday
 * this week so don't come then". Triage recorded that as her preferred time,
 * this parser matched the first weekday in the string, and the drafted reply
 * offered Thursday 7am. The alert reported the contradiction without resolving
 * it: "She's unavailable Thu/Fri, but the draft offers Thu 7am."
 *
 * Same shape as "not urgent" reading as urgent, and worse in consequence: this
 * one puts an appointment in front of a customer on a day they ruled out.
 *
 * The guard is conservative on purpose. Failing to resolve a day means Kyro
 * asks what suits; resolving the wrong one means a van turning up to an empty
 * house.
 */
// A Wednesday, so "Thursday" and "Friday" are both later this same week.
const NOW = new Date("2026-07-29T20:00:00.000Z");
const TZ = "America/Denver";

function resolves(prompt: string) {
  return calendarDateRangeFromPrompt(prompt, { now: NOW, timeZone: TZ });
}

describe("a day the customer ruled out is not a day they asked for", () => {
  it("does not resolve the phrase that caused this", () => {
    assert.equal(resolves("Unavailable Thursday and Friday this week"), null);
  });

  it("handles the ways people say it", () => {
    for (const phrase of [
      "I'm away Thursday",
      "not Thursday please",
      "any day except Thursday",
      "avoid Thursday if you can",
      "I can't do Thursday",
      "cannot make Thursday",
      "don't come Thursday",
      "do not come Thursday",
      "no Thursdays",
      "busy Thursday",
      "excluding Thursday",
    ]) {
      assert.equal(resolves(phrase), null, phrase);
    }
  });
});

describe("everything that is still a genuine request", () => {
  it("resolves a plain day", () => {
    for (const phrase of ["Thursday", "this Thursday", "next Thursday"]) {
      assert.ok(resolves(phrase), phrase);
    }
  });

  it("resolves the day after a contrast", () => {
    // The dangerous false negative: the exclusion belongs to the earlier day.
    assert.ok(resolves("I can't do Wednesday but Thursday is fine"));
    assert.ok(resolves("not Wednesday. Thursday works"));
  });

  it("does not let an exclusion reach across punctuation", () => {
    assert.ok(resolves("Wednesday is no good, Thursday suits me"));
  });

  it("still resolves an owner instruction naming a day", () => {
    // The same parser serves "book them in Thursday" from the owner.
    assert.ok(resolves("book them in Thursday morning"));
    assert.ok(resolves("offer them Thursday at 2pm"));
  });
});

describe("triage is told not to file it as a preference", () => {
  it("says an unavailability is not a preferred time", () => {
    const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");

    assert.match(triage, /preferredTime is when the customer says they CAN be there/);
    assert.match(triage, /Never record an unavailability as a preferred time/);
  });
});
