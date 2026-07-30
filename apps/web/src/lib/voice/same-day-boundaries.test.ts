import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateKeyInTimeZone } from "../timezone";
import { readRepoFile } from "../testing/repo-files";

/**
 * "Is this today" has to mean today where the van is.
 *
 * The same-day booking rule added 30 Jul holds a same-day appointment as a
 * draft for the owner to confirm instead of booking it outright. It decides
 * "same day" by comparing date keys in the workspace timezone.
 *
 * The obvious way to get that wrong is to compare in UTC. For a Denver
 * workspace, every evening from 18:00 onwards is already tomorrow in UTC, so a
 * 7pm booking for 8pm would look like a different day and be booked
 * automatically -- exactly the case the rule exists to catch, since the evening
 * is when the owner is least able to take on another job.
 *
 * DST is the other way: on the two changeover days a fixed offset is wrong for
 * part of the day.
 */
const TZ = "America/Denver";

function sameDay(a: string, b: string) {
  return dateKeyInTimeZone(a, TZ) === dateKeyInTimeZone(b, TZ);
}

describe("late evening is still today where the customer is", () => {
  it("treats a 7pm booking made at 6pm as same day", () => {
    // 2026-07-30 18:00 and 20:00 Denver = 2026-07-31 00:00 and 02:00 UTC.
    // Both are already "tomorrow" in UTC and must not be.
    assert.equal(
      sameDay("2026-07-31T00:00:00.000Z", "2026-07-31T02:00:00.000Z"),
      true,
    );
  });

  it("gives the same key across the whole Denver evening", () => {
    const evening = [
      "2026-07-31T00:30:00.000Z",
      "2026-07-31T03:00:00.000Z",
      "2026-07-31T05:59:00.000Z",
    ];

    for (const instant of evening) {
      assert.equal(
        dateKeyInTimeZone(instant, TZ),
        "2026-07-30",
        `${instant} is still 30 July in Denver`,
      );
    }
  });

  it("rolls over at Denver midnight, not UTC midnight", () => {
    // 06:00 UTC is 00:00 Denver in summer.
    assert.equal(dateKeyInTimeZone("2026-07-31T05:59:00.000Z", TZ), "2026-07-30");
    assert.equal(dateKeyInTimeZone("2026-07-31T06:00:00.000Z", TZ), "2026-07-31");
  });

  it("knows a genuine next-day booking is not same day", () => {
    assert.equal(
      sameDay("2026-07-31T00:00:00.000Z", "2026-07-31T15:00:00.000Z"),
      false,
    );
  });
});

describe("the changeover days", () => {
  it("handles the spring forward", () => {
    // US DST begins 08 Mar 2026: 02:00 MST becomes 03:00 MDT. The offset moves
    // from -07:00 to -06:00 partway through the day.
    assert.equal(dateKeyInTimeZone("2026-03-08T08:59:00.000Z", TZ), "2026-03-08");
    assert.equal(dateKeyInTimeZone("2026-03-08T09:00:00.000Z", TZ), "2026-03-08");
    assert.equal(
      sameDay("2026-03-08T08:00:00.000Z", "2026-03-08T20:00:00.000Z"),
      true,
    );
  });

  it("handles the fall back", () => {
    // US DST ends 01 Nov 2026: 02:00 MDT becomes 01:00 MST.
    assert.equal(dateKeyInTimeZone("2026-11-01T07:59:00.000Z", TZ), "2026-11-01");
    assert.equal(
      sameDay("2026-11-01T08:00:00.000Z", "2026-11-01T22:00:00.000Z"),
      true,
    );
  });

  it("still rolls the day at local midnight either side of the change", () => {
    // Denver is -07:00 in winter, so midnight is 07:00 UTC.
    assert.equal(dateKeyInTimeZone("2026-11-02T06:59:00.000Z", TZ), "2026-11-01");
    assert.equal(dateKeyInTimeZone("2026-11-02T07:00:00.000Z", TZ), "2026-11-02");
  });
});

describe("the booking rule uses the zone-aware comparison", () => {
  it("compares date keys in the workspace timezone, not UTC", () => {
    const booking = readRepoFile("apps/web/src/lib/voice/inbound-booking.ts");

    assert.match(
      booking,
      /dateKeyInTimeZone\(requestedStart, timeZone\) ===\s*dateKeyInTimeZone\(new Date\(\)\.toISOString\(\), timeZone\)/,
    );
    // A UTC comparison would look like slicing an ISO string.
    assert.doesNotMatch(booking, /requestedStart\.slice\(0, 10\)/);
  });
});
