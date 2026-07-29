import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * Two rules about when Kyro may commit to a time.
 *
 * Not offering the past was the fix for a customer being sent a 7:00am slot at
 * 1:11pm. It was not enough on its own: it left Kyro free to say "we can be
 * there at 3:15" at 2:55, which is a commitment nobody agreed to and no van can
 * keep. An hour's notice is the floor now.
 *
 * And a same-day time is never booked automatically, even where the workspace
 * has allowed Kyro to book straight from the calendar. Next Tuesday is a
 * scheduling question; this afternoon is a question about where the owner
 * currently is and what they are under. Kyro offers it, the business confirms.
 */
const booking = readRepoFile("apps/web/src/lib/voice/inbound-booking.ts");

describe("nothing is offered inside the notice window", () => {
  it("floors the search an hour out, not just at now", () => {
    assert.match(booking, /MINIMUM_BOOKING_NOTICE_MS = 60 \* 60_000/);
    assert.match(
      booking,
      /Math\.max\(fromMs, Date\.now\(\) \+ MINIMUM_BOOKING_NOTICE_MS\)/,
    );
  });

  it("still returns nothing rather than something stale", () => {
    assert.match(booking, /if \(searchFromMs >= toMs\) \{/);
    assert.match(booking, /return \{ durationMinutes, slots: \[\], timeZone \}/);
  });

  it("says the notice applies to what Kyro offers, not what the owner books", () => {
    const doc = booking.slice(
      booking.indexOf("* The soonest Kyro may offer"),
      booking.indexOf("const MINIMUM_BOOKING_NOTICE_MS"),
    );

    assert.match(doc, /the owner can still book anything they like by\s+\* hand/);
  });
});

describe("a same-day time is offered, not booked", () => {
  it("compares the slot against today in the workspace timezone", () => {
    // Not UTC: "today" for a Denver workspace is not "today" in UTC for six
    // hours of every evening, and that is exactly when a late booking lands.
    assert.match(
      booking,
      /dateKeyInTimeZone\(requestedStart, timeZone\) ===\s*dateKeyInTimeZone\(new Date\(\)\.toISOString\(\), timeZone\)/,
    );
  });

  it("downgrades book_from_calendar to a draft for today only", () => {
    assert.match(
      booking,
      /mode === "book_from_calendar" && !sameDay \? "scheduled" : "suggested"/,
    );
  });

  it("still books ahead automatically when the workspace allows it", () => {
    // The rule must not quietly disable the mode the workspace chose.
    assert.match(booking, /"scheduled"/);
  });

  it("tells the caller it is awaiting confirmation, not booked", () => {
    assert.match(
      booking,
      /Same-day times are not booked automatically/,
    );
  });

  it("reports the outcome as proposed rather than booked", () => {
    assert.match(booking, /outcome: status === "scheduled" \? "booked" : "proposed"/);
  });
});

describe("the phone agent is told both rules", () => {
  const vapi = readRepoFile("apps/web/src/lib/assistant/vapi-inbound.ts");

  it("must not call a same-day time booked", () => {
    assert.match(vapi, /A time today is never booked automatically/);
    assert.match(vapi, /do not tell the caller it is booked/);
  });

  it("is told to follow the tool result rather than assume", () => {
    assert.match(vapi, /The tool result says which of the two happened/);
  });

  it("knows the earliest it may offer", () => {
    assert.match(vapi, /The earliest time you may offer is an hour from now/);
    assert.match(vapi, /rather than naming a time/);
  });
});
