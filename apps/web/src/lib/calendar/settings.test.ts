import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CALENDAR_SETTINGS,
  normalizeCalendarSettings,
} from "./settings";

test("defaults calendar weeks to two days before and four days after", () => {
  const settings = normalizeCalendarSettings(null);

  assert.equal(settings.weekLayout, "rolling");
  assert.equal(settings.weekDaysBefore, 2);
});

test("normalizes persisted week layout values", () => {
  assert.deepEqual(
    normalizeCalendarSettings({
      weekDaysBefore: 5,
      weekLayout: "fixed",
    }),
    {
      ...DEFAULT_CALENDAR_SETTINGS,
      weekDaysBefore: 5,
      weekLayout: "fixed",
    },
  );
  assert.equal(
    normalizeCalendarSettings({ weekDaysBefore: 99 }).weekDaysBefore,
    6,
  );
});
