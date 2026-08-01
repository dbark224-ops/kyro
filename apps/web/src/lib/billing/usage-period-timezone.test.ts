import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBillingPeriod } from "./usage-summary";

/**
 * "This month" has to mean the owner's month, not UTC's.
 *
 * Found on the live dashboard, and diagnosed by the owner rather than by me.
 * The sidebar read "this week $18.45, this month $0.00" while the database
 * held $30.38 for the month. My first guess was a swallowed query error. It
 * was not: UTC had already turned over to the 1st, so the monthly window was
 * a few hours old and empty, while the weekly window still reached back over
 * the whole of the previous month. Both figures were correct for the windows
 * that were asked for, and the windows were the wrong ones.
 *
 * The workspace is six hours behind UTC. That is an evening every month spent
 * being told the month's spend is nothing, and the same on Sunday evenings
 * for the week.
 *
 * The anchor below is the exact moment it was seen: 2026-08-01T04:16Z, which
 * in Albuquerque is ten past ten on the evening of 31 July.
 */
const SEEN_AT = "2026-08-01T04:16:16.362Z";
const DENVER = "America/Denver";

describe("a billing period belongs to the workspace, not to UTC", () => {
  it("keeps the month open while it is still that month for the owner", () => {
    const period = resolveBillingPeriod({
      anchor: SEEN_AT,
      period: "monthly",
      timeZone: DENVER,
    });

    // July, local -- starting at midnight Denver, which is 06:00 UTC.
    assert.equal(period.start, "2026-07-01T06:00:00.000Z");
    assert.equal(period.end, "2026-08-01T06:00:00.000Z");
  });

  it("is the month that was actually wrong on screen", () => {
    const utc = resolveBillingPeriod({ anchor: SEEN_AT, period: "monthly" });
    const local = resolveBillingPeriod({
      anchor: SEEN_AT,
      period: "monthly",
      timeZone: DENVER,
    });

    // What the dashboard used: August, hours old, holding nothing.
    assert.equal(utc.start, "2026-08-01T00:00:00.000Z");
    assert.notEqual(utc.start, local.start);
  });

  it("anchors the week to the workspace day as well", () => {
    const period = resolveBillingPeriod({
      anchor: SEEN_AT,
      period: "weekly",
      timeZone: DENVER,
    });

    // Locally it is Friday 31 July, so the week began Monday 27 July.
    assert.equal(period.start, "2026-07-27T06:00:00.000Z");
    assert.equal(period.end, "2026-08-03T06:00:00.000Z");
  });

  it("still means UTC when no zone is given", () => {
    // Every existing caller relied on this, so it must not move.
    const period = resolveBillingPeriod({ anchor: SEEN_AT, period: "monthly" });

    assert.equal(period.start, "2026-08-01T00:00:00.000Z");
    assert.equal(period.end, "2026-09-01T00:00:00.000Z");
  });

  it("survives a zone ahead of UTC, where the error runs the other way", () => {
    // Sydney is ten or eleven hours ahead, so its month starts before UTC's
    // and the same fault would show a month that has not begun yet.
    const period = resolveBillingPeriod({
      anchor: "2026-07-31T20:00:00.000Z",
      period: "monthly",
      timeZone: "Australia/Sydney",
    });

    // Locally that is already 1 August in Sydney.
    assert.equal(period.start, "2026-07-31T14:00:00.000Z");
    assert.equal(period.end, "2026-08-31T14:00:00.000Z");
  });

  it("gets the offset right across a DST changeover", () => {
    // Denver is UTC-7 in winter and UTC-6 in summer. A month spanning the
    // March change must start at the winter offset, not the summer one.
    const period = resolveBillingPeriod({
      anchor: "2026-03-20T12:00:00.000Z",
      period: "monthly",
      timeZone: DENVER,
    });

    assert.equal(period.start, "2026-03-01T07:00:00.000Z");
    assert.equal(period.end, "2026-04-01T06:00:00.000Z");
  });

  it("leaves an explicit custom range exactly as given", () => {
    const period = resolveBillingPeriod({
      end: "2026-07-15T00:00:00.000Z",
      period: "custom",
      start: "2026-07-01T00:00:00.000Z",
      timeZone: DENVER,
    });

    assert.equal(period.start, "2026-07-01T00:00:00.000Z");
    assert.equal(period.end, "2026-07-15T00:00:00.000Z");
  });
});
