import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatTimeOfDay,
  isTimeOfDay,
  timeOfDayOptions,
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

describe("timeOfDayOptions", () => {
  it("covers the whole day at quarter-hour steps", () => {
    const options = timeOfDayOptions();

    assert.equal(options.length, 96);
    assert.equal(options[0].value, "00:00");
    assert.equal(options.at(-1)?.value, "23:45");
  });

  it("labels each option on a 12-hour clock", () => {
    const options = timeOfDayOptions();

    assert.equal(options[0].label, "12:00 AM");
    assert.deepEqual(
      options.find((option) => option.value === "14:30"),
      { label: "2:30 PM", value: "14:30" },
    );
  });

  it("honours a different step", () => {
    assert.equal(timeOfDayOptions({ stepMinutes: 30 }).length, 48);
    assert.equal(timeOfDayOptions({ stepMinutes: 60 }).length, 24);
  });

  it("keeps an off-grid existing time selectable", () => {
    // An event synced from Google at 07:05 must not silently snap to 07:00
    // just because the picker offers quarter hours.
    const options = timeOfDayOptions({ include: "07:05" });
    const values = options.map((option) => option.value);

    assert.ok(values.includes("07:05"));
    assert.equal(
      values.indexOf("07:05"),
      values.indexOf("07:00") + 1,
      "the extra option belongs in chronological order",
    );
  });

  it("does not duplicate a time already on the grid", () => {
    const values = timeOfDayOptions({ include: "07:00" }).map(
      (option) => option.value,
    );

    assert.equal(values.filter((value) => value === "07:00").length, 1);
  });

  it("ignores an unparseable include rather than adding junk", () => {
    assert.equal(timeOfDayOptions({ include: "nope" }).length, 96);
  });
});
