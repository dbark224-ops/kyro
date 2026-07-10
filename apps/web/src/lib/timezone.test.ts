import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dateTimeLocalValueInTimeZone,
  isoFromDateTimeLocalInTimeZone,
  isoRangeForDateKeyRange,
  providerDateTimeToIso,
} from "./timezone";

describe("workspace timezone helpers", () => {
  it("treats provider date-only values as workspace-local midnight", () => {
    assert.equal(
      providerDateTimeToIso("2026-07-10", "America/Denver"),
      "2026-07-10T06:00:00.000Z",
    );
  });

  it("treats timezone-less provider datetimes as wall time in the supplied timezone", () => {
    assert.equal(
      providerDateTimeToIso("2026-07-10T09:30:00", "America/Denver"),
      "2026-07-10T15:30:00.000Z",
    );
  });

  it("round-trips datetime-local values through the workspace timezone", () => {
    const iso = "2026-07-10T15:30:00.000Z";

    assert.equal(
      dateTimeLocalValueInTimeZone(iso, "America/Denver"),
      "2026-07-10T09:30",
    );
    assert.equal(
      isoFromDateTimeLocalInTimeZone("2026-07-10T09:30", "America/Denver"),
      iso,
    );
  });

  it("builds workspace-local date query ranges as UTC instants", () => {
    assert.deepEqual(
      isoRangeForDateKeyRange(
        { from: "2026-07-10", to: "2026-07-11" },
        "America/Denver",
      ),
      {
        from: "2026-07-10T06:00:00.000Z",
        to: "2026-07-11T06:00:00.000Z",
      },
    );
  });
});
