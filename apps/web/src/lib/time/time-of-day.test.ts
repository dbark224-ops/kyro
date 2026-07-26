import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatTimeOfDay,
  isTimeOfDay,
  stepTimeOfDay,
  timeOfDayDisplayParts,
  toggleTimeOfDayMeridiem,
} from "./time-of-day";

describe("formatTimeOfDay", () => {
  it("reads a 24-hour time as a 12-hour clock", () => {
    assert.equal(formatTimeOfDay("14:30"), "2:30 PM");
    assert.equal(formatTimeOfDay("07:05"), "7:05 AM");
  });

  it("handles both ends of the day", () => {
    assert.equal(formatTimeOfDay("00:00"), "12:00 AM");
    assert.equal(formatTimeOfDay("12:00"), "12:00 PM");
    assert.equal(formatTimeOfDay("23:59"), "11:59 PM");
  });

  it("returns anything unparseable unchanged rather than inventing a time", () => {
    for (const value of ["", "nonsense", "25:00", "10:75", "10"]) {
      assert.equal(formatTimeOfDay(value), value);
    }
  });

  it("is timezone-free -- a wall-clock time means the same everywhere", () => {
    // Formatted against a fixed synthetic date for exactly this reason.
    assert.equal(formatTimeOfDay("09:00"), "9:00 AM");
  });
});

describe("isTimeOfDay", () => {
  it("accepts real times and rejects the rest", () => {
    assert.equal(isTimeOfDay("00:00"), true);
    assert.equal(isTimeOfDay("23:59"), true);
    assert.equal(isTimeOfDay("24:00"), false);
    assert.equal(isTimeOfDay("9:00 AM"), false);
  });
});

describe("stepTimeOfDay", () => {
  it("moves the hour and wraps around midnight", () => {
    assert.equal(stepTimeOfDay("09:30", "hour", 1), "10:30");
    assert.equal(stepTimeOfDay("09:30", "hour", -1), "08:30");
    assert.equal(stepTimeOfDay("23:30", "hour", 1), "00:30");
    assert.equal(stepTimeOfDay("00:30", "hour", -1), "23:30");
  });

  it("moves the minute by the step when already on the grid", () => {
    assert.equal(stepTimeOfDay("09:30", "minute", 1), "09:45");
    assert.equal(stepTimeOfDay("09:30", "minute", -1), "09:15");
  });

  it("tidies an off-grid minute onto the grid on the first press", () => {
    // A synced event at 07:05 should become 07:15, not drift to 07:20.
    assert.equal(stepTimeOfDay("07:05", "minute", 1), "07:15");
    assert.equal(stepTimeOfDay("07:05", "minute", -1), "07:00");
  });

  it("carries the minute into the hour", () => {
    // 09:45 pressed up is ten o'clock to anyone looking at it.
    assert.equal(stepTimeOfDay("09:45", "minute", 1), "10:00");
    assert.equal(stepTimeOfDay("09:00", "minute", -1), "08:45");
  });

  it("carries across midnight in both directions", () => {
    assert.equal(stepTimeOfDay("23:45", "minute", 1), "00:00");
    assert.equal(stepTimeOfDay("00:00", "minute", -1), "23:45");
  });

  it("honours a different step", () => {
    assert.equal(stepTimeOfDay("09:00", "minute", 1, 5), "09:05");
    assert.equal(stepTimeOfDay("09:00", "minute", 1, 30), "09:30");
  });

  it("leaves an unparseable value alone", () => {
    assert.equal(stepTimeOfDay("nope", "hour", 1), "nope");
  });
});

describe("toggleTimeOfDayMeridiem", () => {
  it("swaps morning and afternoon", () => {
    assert.equal(toggleTimeOfDayMeridiem("09:30"), "21:30");
    assert.equal(toggleTimeOfDayMeridiem("21:30"), "09:30");
  });

  it("handles the two noon/midnight edges", () => {
    assert.equal(toggleTimeOfDayMeridiem("00:00"), "12:00");
    assert.equal(toggleTimeOfDayMeridiem("12:00"), "00:00");
  });
});

describe("timeOfDayDisplayParts", () => {
  it("splits into the pieces a stepper shows", () => {
    assert.deepEqual(timeOfDayDisplayParts("14:30"), {
      hour: 2,
      meridiem: "PM",
      minute: "30",
    });
  });

  it("shows 12 rather than 0 at midnight and noon", () => {
    assert.equal(timeOfDayDisplayParts("00:15")?.hour, 12);
    assert.equal(timeOfDayDisplayParts("00:15")?.meridiem, "AM");
    assert.equal(timeOfDayDisplayParts("12:15")?.hour, 12);
    assert.equal(timeOfDayDisplayParts("12:15")?.meridiem, "PM");
  });

  it("returns null for anything that is not a time", () => {
    assert.equal(timeOfDayDisplayParts("nope"), null);
  });
});
