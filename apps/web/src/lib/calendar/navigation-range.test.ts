import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calendarNavigationPreloadRange,
  dateKeyRangeContainsRange,
} from "./navigation-range";
import { rangeForCalendarViewDateKey } from "../timezone";

describe("calendar navigation preload ranges", () => {
  it("loads the surrounding month grids for fast local navigation", () => {
    assert.deepEqual(calendarNavigationPreloadRange("2026-07-13"), {
      from: "2026-04-27",
      to: "2026-10-05",
    });
  });

  it("detects whether a target day, week, or month can be rendered locally", () => {
    const preloaded = calendarNavigationPreloadRange("2026-07-13");

    assert.equal(
      dateKeyRangeContainsRange(
        preloaded,
        rangeForCalendarViewDateKey("2026-07-14", "day"),
      ),
      true,
    );
    assert.equal(
      dateKeyRangeContainsRange(
        preloaded,
        rangeForCalendarViewDateKey("2026-08-24", "week"),
      ),
      true,
    );
    assert.equal(
      dateKeyRangeContainsRange(
        preloaded,
        rangeForCalendarViewDateKey("2026-10-01", "month"),
      ),
      false,
    );
  });
});
