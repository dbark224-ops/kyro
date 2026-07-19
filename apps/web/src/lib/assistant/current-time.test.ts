import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAssistantCurrentTimeContext } from "./current-time";

describe("assistant current time context", () => {
  it("keeps the workspace on its local date when UTC has crossed midnight", () => {
    const context = buildAssistantCurrentTimeContext(
      "America/Denver",
      new Date("2026-07-19T03:31:00.000Z"),
    );

    assert.equal(context.currentDateKey, "2026-07-18");
    assert.equal(context.tomorrowDateKey, "2026-07-19");
    assert.equal(context.currentTimezone, "America/Denver");
    assert.match(context.currentDate, /Saturday/);
    assert.match(context.tomorrowDate, /Sunday/);
    assert.match(context.promptLine, /Never substitute the UTC calendar date/);
  });
});
