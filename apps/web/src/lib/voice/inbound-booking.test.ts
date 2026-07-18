import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarIntervalsOverlap } from "./inbound-booking";

describe("inbound booking availability", () => {
  it("detects overlapping calendar intervals", () => {
    assert.equal(
      calendarIntervalsOverlap(
        "2026-08-03T15:00:00.000Z",
        "2026-08-03T16:00:00.000Z",
        "2026-08-03T15:30:00.000Z",
        "2026-08-03T16:30:00.000Z",
      ),
      true,
    );
  });

  it("allows adjacent calendar intervals", () => {
    assert.equal(
      calendarIntervalsOverlap(
        "2026-08-03T15:00:00.000Z",
        "2026-08-03T16:00:00.000Z",
        "2026-08-03T16:00:00.000Z",
        "2026-08-03T17:00:00.000Z",
      ),
      false,
    );
  });
});
