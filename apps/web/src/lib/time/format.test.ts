import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceDateWithYear,
  formatWorkspaceTime,
} from "./format";

// 2026-07-25 20:57 UTC is 2026-07-26 06:57 in Melbourne: the following day.
const OVERNIGHT = "2026-07-25T20:57:59.217Z";
const MELBOURNE = "Australia/Melbourne";

describe("workspace timezone formatting", () => {
  it("shows the workspace's day, not the server's", () => {
    // The real defect: this message arrived Sunday morning in Melbourne and was
    // displayed as Saturday night, because the server runs on UTC.
    assert.match(
      formatWorkspaceDateTime({ timeZone: MELBOURNE, value: OVERNIGHT }),
      /Jul 26/,
    );
    assert.match(
      formatWorkspaceDateTime({ timeZone: "UTC", value: OVERNIGHT }),
      /Jul 25/,
    );
  });

  it("shows the workspace's time", () => {
    assert.match(
      formatWorkspaceDateTime({ timeZone: MELBOURNE, value: OVERNIGHT }),
      /6:57/,
    );
    assert.match(
      formatWorkspaceDateTime({ timeZone: "UTC", value: OVERNIGHT }),
      /8:57/,
    );
  });

  it("gives each workspace its own answer for the same instant", () => {
    const melbourne = formatWorkspaceDateTime({ timeZone: MELBOURNE, value: OVERNIGHT });
    const london = formatWorkspaceDateTime({ timeZone: "Europe/London", value: OVERNIGHT });
    const denver = formatWorkspaceDateTime({ timeZone: "America/Denver", value: OVERNIGHT });

    assert.notEqual(melbourne, london);
    assert.notEqual(london, denver);
  });

  it("handles daylight saving rather than a fixed offset", () => {
    // Melbourne is UTC+10 in July and UTC+11 in January.
    const july = formatWorkspaceTime({ timeZone: MELBOURNE, value: "2026-07-01T00:00:00Z" });
    const january = formatWorkspaceTime({ timeZone: MELBOURNE, value: "2026-01-01T00:00:00Z" });

    assert.match(july, /10:00/);
    assert.match(january, /11:00/);
  });
});

describe("format variants", () => {
  it("renders the shapes the app needs", () => {
    const value = OVERNIGHT;
    const timeZone = MELBOURNE;

    assert.match(formatWorkspaceDateTime({ timeZone, value }), /Jul 26.*6:57/);
    assert.match(formatWorkspaceDate({ timeZone, value }), /^Jul 26$/);
    assert.match(formatWorkspaceDateWithYear({ timeZone, value }), /Jul 26, 2026/);
    assert.match(formatWorkspaceTime({ timeZone, value }), /^6:57/);
  });

  it("agrees on the day across every variant", () => {
    const timeZone = MELBOURNE;
    const value = OVERNIGHT;

    for (const formatter of [
      formatWorkspaceDateTime,
      formatWorkspaceDate,
      formatWorkspaceDateWithYear,
    ]) {
      assert.match(formatter({ timeZone, value }), /Jul 26/);
    }
  });
});

describe("absent and unusable values", () => {
  it("returns the empty label rather than a date", () => {
    for (const value of [null, undefined, ""]) {
      assert.equal(formatWorkspaceDateTime({ timeZone: MELBOURNE, value }), "-");
      assert.equal(formatWorkspaceDate({ timeZone: MELBOURNE, value }), "-");
    }
  });

  it("lets a caller name the empty state", () => {
    assert.equal(
      formatWorkspaceDateTime({ emptyLabel: "No messages", timeZone: MELBOURNE, value: null }),
      "No messages",
    );
  });

  it("does not render Invalid Date", () => {
    assert.equal(
      formatWorkspaceDateTime({ timeZone: MELBOURNE, value: "not a date" }),
      "-",
    );
  });

  it("still shows a date when the timezone is unusable", () => {
    // A bad workspace setting should offset the time, never blank the screen.
    const result = formatWorkspaceDateTime({ timeZone: "Not/AZone", value: OVERNIGHT });

    assert.notEqual(result, "-");
    assert.match(result, /Jul/);
  });

  it("treats a missing timezone as the runtime's, not as an error", () => {
    assert.match(formatWorkspaceDateTime({ value: OVERNIGHT }), /Jul/);
    assert.match(formatWorkspaceDateTime({ timeZone: "   ", value: OVERNIGHT }), /Jul/);
  });

  it("accepts a Date as well as an ISO string", () => {
    assert.equal(
      formatWorkspaceDate({ timeZone: MELBOURNE, value: new Date(OVERNIGHT) }),
      formatWorkspaceDate({ timeZone: MELBOURNE, value: OVERNIGHT }),
    );
  });
});
