import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rangeForCalendarViewDateKey } from "../timezone";
import {
  calendarNavigationPreloadRange,
  calendarWeekVisibleRange,
  dateKeyRangeContainsRange,
} from "./navigation-range";

describe("calendar week layouts", () => {
  it("builds a rolling seven-day range around the anchor day", () => {
    assert.deepEqual(
      calendarWeekVisibleRange("2026-07-19", {
        weekDaysBefore: 2,
        weekLayout: "rolling",
      }),
      {
        from: "2026-07-17",
        to: "2026-07-24",
      },
    );
  });

  it("retains a fixed Monday-to-Sunday option", () => {
    assert.deepEqual(
      calendarWeekVisibleRange("2026-07-19", {
        weekDaysBefore: 2,
        weekLayout: "fixed",
      }),
      {
        from: "2026-07-13",
        to: "2026-07-20",
      },
    );
  });
});

describe("calendar navigation preload ranges", () => {
  it("loads the surrounding month grids for fast local navigation", () => {
    assert.deepEqual(calendarNavigationPreloadRange("2026-07-13"), {
      from: "2026-04-27",
      to: "2026-11-02",
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
        rangeForCalendarViewDateKey("2026-11-01", "month"),
      ),
      false,
    );
  });
});
