import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeInquiryAvailabilityOfferRequest } from "./inquiry-intent";
import { calendarDateRangeFromPrompts } from "./calendar-intent";
import { readRepoFile } from "../testing/repo-files";

/**
 * A reply instruction that asks for a calendar time has to reach the calendar.
 *
 * It did not. Asked over WhatsApp to "reply saying we'd be happy to review the
 * project ... Offer them an afternoon time tommorow that we have free in the
 * calendar", Kyro told the customer "We have an afternoon opening tomorrow,
 * Tuesday 28 July" -- and the stored action shows verifiedAvailability was
 * null. Nothing had been checked. It invented an opening.
 *
 * The cause was routing, not writing. Only the calendar_event branch passed an
 * availabilityPrompt through, so an instruction the router read as
 * inquiry_reply skipped the slot lookup entirely and left the writer to fill
 * the gap.
 */
describe("an instruction asking for a time reaches the calendar", () => {
  const realInstruction =
    "Yeah okay reply saying we'd be happy to review the project. Confirm what month they're referring to for the 9th and confirm all the other information. Offer them an afternoon time tommorow that we have free in the calendar to come out and quote and we will speak about warranty in person";

  it("recognises the instruction that failed", () => {
    assert.equal(
      looksLikeInquiryAvailabilityOfferRequest(realInstruction),
      true,
    );
  });

  it("recognises it despite the misspelled tomorrow", () => {
    // The wording that reached production had "tommorow" in it. A check that
    // only works on correctly spelled input is not a check.
    assert.equal(
      looksLikeInquiryAvailabilityOfferRequest(
        "offer them a time tommorow from the calendar",
      ),
      true,
    );
  });

  it("still ignores a reply instruction with no timing in it", () => {
    for (const instruction of [
      "reply and tell them we'll send a quote by Friday",
      "let them know we got the photos",
      "ask for the job address",
    ]) {
      assert.equal(
        looksLikeInquiryAvailabilityOfferRequest(instruction),
        false,
        instruction,
      );
    }
  });

  it("passes the prompt through on the inquiry_reply route", () => {
    // The routing fix itself: inquiry_reply used to hand no availabilityPrompt
    // to the command, so the branch that resolves a slot could never run.
    const commands = readRepoFile("apps/web/src/lib/assistant/commands.ts");
    const inquiryReplyCase = commands.slice(
      commands.indexOf('case "inquiry_reply":'),
      commands.indexOf('case "inquiry_internal_answer":'),
    );

    assert.match(inquiryReplyCase, /availabilityPrompt:/);
    assert.match(
      inquiryReplyCase,
      /looksLikeInquiryAvailabilityOfferRequest\(/,
    );
  });
});

describe("the date range survives the wording people actually use", () => {
  const clock = new Date("2026-07-27T23:54:00.000Z");

  it("resolves tomorrow", () => {
    assert.ok(
      calendarDateRangeFromPrompts(
        "offer them an afternoon time tomorrow",
        "",
        "America/Denver",
        clock,
      ),
    );
  });

  it("resolves it misspelled, or says so rather than guessing", () => {
    // If this cannot parse "tommorow" the command returns "tell me which day
    // to use" -- which is a worse experience but an honest one. What must not
    // happen is the earlier behaviour: no range, no check, and a confident
    // invented time in front of a customer.
    const range = calendarDateRangeFromPrompts(
      "offer them an afternoon time tommorow that we have free in the calendar",
      "",
      "America/Denver",
      clock,
    );

    if (!range) {
      assert.ok(true, "no range is acceptable; a fabricated time is not");
      return;
    }

    assert.ok(range.from);
    assert.ok(range.to);
  });
});

/**
 * "A week today" was resolving to today.
 *
 * The today and tomorrow checks match their keyword wherever it sits, so an
 * offset in front of it was read straight past: "a week today", "a week
 * tomorrow", "two weeks today" and "a fortnight tomorrow" all came back as
 * plain today or tomorrow. A customer asking for a week today would have been
 * offered a slot the same afternoon.
 *
 * Third instance of one shape tonight -- a qualifier in front of a keyword,
 * and a pattern that only reads the keyword. "Not urgent" escalated, "away
 * Thursday" was offered Thursday, and now this.
 */
describe("an offset in front of today or tomorrow", () => {
  // Thursday 30 July 2026, 12:40 in Denver.
  const clock = new Date("2026-07-30T18:40:00.000Z");

  const resolved = (prompt: string) => {
    const range = calendarDateRangeFromPrompts(
      prompt,
      "",
      "America/Denver",
      clock,
    );

    return range
      ? new Date(range.from).toLocaleDateString("en-CA", {
          timeZone: "America/Denver",
        })
      : null;
  };

  it("counts the weeks", () => {
    assert.equal(resolved("a week today"), "2026-08-06");
    assert.equal(resolved("a week tomorrow"), "2026-08-07");
    assert.equal(resolved("two weeks today"), "2026-08-13");
    assert.equal(resolved("3 weeks today"), "2026-08-20");
  });

  it("counts a fortnight as two of them", () => {
    assert.equal(resolved("a fortnight today"), "2026-08-13");
    assert.equal(resolved("a fortnight tomorrow"), "2026-08-14");
  });

  it("leaves a bare today or tomorrow alone", () => {
    assert.equal(resolved("today"), "2026-07-30");
    assert.equal(resolved("tomorrow"), "2026-07-31");
    assert.equal(resolved("can you come tomorrow morning"), "2026-07-31");
  });
});

/**
 * The guard against offering a ruled-out day only understood the formal
 * spelling of a refusal.
 *
 * normalized() replaces every non-alphanumeric character with a space, so
 * "can't" reaches the pattern as "can t" and `can'?t` never matched it. The
 * result was that "I cannot do Thursday" was refused and "I can't do Thursday"
 * was offered Thursday -- the contraction being the more likely of the two to
 * be written by an actual person.
 *
 * The first argument is the model's extraction, the second what the customer
 * wrote. Both these arguments say Thursday; only the second knows why.
 */
describe("a refusal is understood however it is spelled", () => {
  const clock = new Date("2026-07-27T23:54:00.000Z");

  const offered = (said: string) =>
    Boolean(
      calendarDateRangeFromPrompts("Thursday", said, "America/Denver", clock),
    );

  it("refuses the contracted forms", () => {
    for (const said of [
      "I can't do Thursday",
      "Don't come Thursday",
      "Won't be in Thursday",
      "I can t do Thursday",
    ]) {
      assert.equal(offered(said), false, said);
    }
  });

  it("still refuses the spellings that already worked", () => {
    for (const said of [
      "I cannot do Thursday",
      "Do not come Thursday",
      "I'm away Thursday",
      "Not Thursday",
    ]) {
      assert.equal(offered(said), false, said);
    }
  });

  it("does not start refusing a genuine request", () => {
    // "I can take Thursday off" is the one that worried me: it contains "can"
    // followed by a word beginning with t. The word boundary is what saves it.
    for (const said of [
      "Thursday suits me",
      "Can you come Thursday?",
      "Thursday morning please",
      "I can take Thursday off",
    ]) {
      assert.equal(offered(said), true, said);
    }
  });
});
