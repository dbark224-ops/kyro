import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_INBOUND_EMAIL_SETTINGS,
  normalizeInboundEmailSettings,
  shouldRunInboundEmailSync,
} from "./inbound-email-settings";

const automaticSettings = normalizeInboundEmailSettings({
  ...DEFAULT_INBOUND_EMAIL_SETTINGS,
  pollIntervalMinutes: 5,
  quietHoursEnabled: true,
  quietHoursEnd: "04:00",
  quietHoursMode: "paused",
  quietHoursStart: "22:00",
  syncMode: "automatic",
  timeZone: "UTC",
});

describe("shouldRunInboundEmailSync", () => {
  it("pauses scheduled polling during quiet hours", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-21T20:00:00.000Z",
        now: new Date("2026-05-21T23:15:00.000Z"),
        settings: automaticSettings,
      }),
      false,
    );
  });

  it("resumes on the first due scheduled poll after quiet hours end", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-21T20:00:00.000Z",
        now: new Date("2026-05-22T04:01:00.000Z"),
        settings: automaticSettings,
      }),
      true,
    );
  });

  it("does not run before the daytime interval is due", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-22T04:00:00.000Z",
        now: new Date("2026-05-22T04:03:00.000Z"),
        settings: automaticSettings,
      }),
      false,
    );
  });

  it("can keep the same polling interval overnight for emergency businesses", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-21T23:00:00.000Z",
        now: new Date("2026-05-21T23:10:00.000Z"),
        settings: {
          ...automaticSettings,
          quietHoursMode: "same_interval",
        },
      }),
      true,
    );
  });

  it("never runs scheduled polling when sync mode is not automatic", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: null,
        now: new Date("2026-05-22T10:00:00.000Z"),
        settings: {
          ...automaticSettings,
          syncMode: "manual_only",
        },
      }),
      false,
    );
  });
});
