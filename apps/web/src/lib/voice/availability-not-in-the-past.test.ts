import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * Kyro offered a flooding customer a visit six hours in the past.
 *
 * Priya emailed at 1:11pm Mountain saying water was coming through her kitchen
 * ceiling. The drafted reply proposed "July 29, 2026, at 7:00 AM (Mountain
 * Time)" -- that morning.
 *
 * The calendar was consulted and did its job; the window was wrong. Triage
 * resolves a range meaning "today", which starts at midnight, and
 * findWorkspaceAvailableSlots searched from the start of that range. The first
 * free slot inside a working day is the start of the working day, whatever the
 * clock says, so 7:00am was returned as availability and the writer proposed
 * it faithfully.
 *
 * This is not a writing fault and no prompt rule fixes it. "You cannot book
 * the past" is exactly the kind of invariant code is supposed to guarantee
 * before the model ever sees the facts.
 */
const booking = readRepoFile("apps/web/src/lib/voice/inbound-booking.ts");
const finder = booking.slice(
  booking.indexOf("export async function findWorkspaceAvailableSlots"),
  booking.indexOf("function bookingTitle"),
);

describe("availability never starts before now", () => {
  it("floors the search at the current time or later", () => {
    // The floor has since moved out by a notice window, which is strictly
    // stronger. Asserting the exact expression made this fail on a change that
    // improved the very thing it exists to protect, so it checks the shape:
    // the search start is Date.now() raised to at least the caller's `from`.
    assert.match(finder, /Math\.max\(fromMs, Date\.now\(\)[^)]*\)/);
  });

  it("searches from the floored time, not the caller's start", () => {
    // The bug in one line: the caller's `from` was passed straight through.
    assert.match(finder, /from: searchFrom,/);
    assert.doesNotMatch(finder, /from: input\.from,/);
  });

  it("loads busy events from the floored time too", () => {
    assert.match(finder, /searchFromMs - calendarSettings\.bufferMinutesBefore/);
    assert.doesNotMatch(finder, /fromMs - calendarSettings\.bufferMinutesBefore/);
  });

  it("returns nothing when the whole window has already gone", () => {
    // No slots rather than stale ones. The caller then asks what suits instead
    // of proposing a time that has been and gone.
    assert.match(finder, /if \(searchFromMs >= toMs\) \{/);
    assert.match(finder, /return \{ durationMinutes, slots: \[\], timeZone \}/);
  });

  it("still rejects a window that was nonsense to begin with", () => {
    assert.match(finder, /toMs <= fromMs/);
    assert.match(finder, /A valid calendar availability window is required/);
  });
});

describe("the slot generator still honours the start it is given", () => {
  const slots = booking.slice(
    booking.indexOf("async function availableSlots"),
    booking.indexOf("export async function findWorkspaceAvailableSlots"),
  );

  it("begins day one at the later of the working start and the range start", () => {
    // Flooring at the entry point only works because this respects `from`
    // rather than snapping to the start of the working day.
    assert.match(slots, /Math\.max\(dayStart, roundedUpToHalfHour\(firstMinutes\)\)/);
  });

  it("also discards any slot that starts before the range", () => {
    assert.match(
      slots,
      /new Date\(startsAt\)\.getTime\(\) < new Date\(input\.from\)\.getTime\(\)/,
    );
  });
});
