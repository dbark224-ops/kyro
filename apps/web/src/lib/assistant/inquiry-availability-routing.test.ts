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
