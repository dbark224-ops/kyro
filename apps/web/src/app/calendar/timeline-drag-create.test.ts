import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timelineCreateDurationMinutes } from "./use-timeline-drag-create";

const SNAP = 15;
const DEFAULT_DURATION = 60;

function duration(startMinutes: number, endMinutes: number) {
  return timelineCreateDurationMinutes({
    defaultDurationMinutes: DEFAULT_DURATION,
    endMinutes,
    snapMinutes: SNAP,
    startMinutes,
  });
}

describe("how long a dragged-out event runs", () => {
  it("uses the workspace default for a plain click", () => {
    // A click says when, not how long.
    assert.equal(duration(540, 540), DEFAULT_DURATION);
  });

  it("uses the dragged length once it covers a snap step", () => {
    assert.equal(duration(540, 555), 15);
    assert.equal(duration(540, 660), 120);
  });

  it("falls back to the default for a wobble smaller than one step", () => {
    // A press that shifted a few pixels must not create a near-zero event.
    assert.equal(duration(540, 545), DEFAULT_DURATION);
    assert.equal(duration(540, 554), DEFAULT_DURATION);
  });

  it("never returns a negative duration", () => {
    // The hook normalises an upward drag before calling this, so a reversed
    // range means something went wrong -- fall back rather than invert time.
    assert.equal(duration(600, 540), DEFAULT_DURATION);
  });

  it("respects a workspace default other than an hour", () => {
    assert.equal(
      timelineCreateDurationMinutes({
        defaultDurationMinutes: 45,
        endMinutes: 540,
        snapMinutes: SNAP,
        startMinutes: 540,
      }),
      45,
    );
  });

  it("keeps a long drag exactly as dragged", () => {
    // No rounding surprises: eight hours dragged is eight hours booked.
    assert.equal(duration(480, 960), 480);
  });
});
