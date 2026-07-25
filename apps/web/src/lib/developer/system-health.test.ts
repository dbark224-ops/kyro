import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backgroundQueueCheckStatus,
  formatQueueAge,
  type BackgroundQueueMetric,
} from "./system-health";

function metric(overrides: Partial<BackgroundQueueMetric> = {}) {
  return {
    expiredLeaseCount: 0,
    failedCount: 0,
    jobType: "outbound_delivery",
    oldestReadyAgeSeconds: 0,
    oldestScheduleAgeSeconds: 0,
    overdueScheduleCount: 0,
    processingCount: 0,
    readyCount: 0,
    ...overrides,
  } satisfies BackgroundQueueMetric;
}

describe("formatQueueAge", () => {
  it("renders minutes, hours and days", () => {
    assert.equal(formatQueueAge(90), "1m");
    assert.equal(formatQueueAge(45 * 60), "45m");
    assert.equal(formatQueueAge(3 * 60 * 60), "3h");
    assert.equal(formatQueueAge(50 * 60 * 60), "2d");
  });

  it("never renders a bare zero for sub-minute work", () => {
    assert.equal(formatQueueAge(0), "0m");
    assert.equal(formatQueueAge(30), "1m");
  });
});

describe("backgroundQueueCheckStatus", () => {
  it("reports ok for a drained queue", () => {
    const { status, summary } = backgroundQueueCheckStatus(metric());

    assert.equal(status, "ok");
    assert.match(summary, /0 ready/);
    assert.match(summary, /0 dead-lettered/);
  });

  it("reports ok while work is in flight but fresh", () => {
    const { status } = backgroundQueueCheckStatus(
      metric({ oldestReadyAgeSeconds: 60, processingCount: 1, readyCount: 3 }),
    );

    assert.equal(status, "ok");
  });

  it("errors on a dead letter -- the real 2026-07-25 production case", () => {
    // outbound_delivery sat with one failed job for two days while the old
    // dashboard showed "ok" because CRON_SECRET was set.
    const { status, summary } = backgroundQueueCheckStatus(
      metric({ failedCount: 1, jobType: "outbound_delivery" }),
    );

    assert.equal(status, "error");
    assert.match(summary, /1 dead-lettered/);
    assert.match(summary, /background\/retry/);
  });

  it("errors on an expired lease", () => {
    const { status, summary } = backgroundQueueCheckStatus(
      metric({ expiredLeaseCount: 2 }),
    );

    assert.equal(status, "error");
    assert.match(summary, /2 expired lease/);
  });

  it("warns when work sits longer than the job type allows", () => {
    // outbound_delivery tolerates 10 minutes.
    const { status, summary } = backgroundQueueCheckStatus(
      metric({ oldestReadyAgeSeconds: 30 * 60, readyCount: 4 }),
    );

    assert.equal(status, "warning");
    assert.match(summary, /processor may not be running/);
  });

  it("uses each job type's own threshold rather than one global number", () => {
    // 30 minutes is stale for outbound_delivery (10m) but fine for
    // crm_lifecycle_review (12h). A single threshold would get one of these wrong.
    const stale = backgroundQueueCheckStatus(
      metric({ jobType: "outbound_delivery", oldestReadyAgeSeconds: 30 * 60 }),
    );
    const fine = backgroundQueueCheckStatus(
      metric({
        jobType: "crm_lifecycle_review",
        oldestReadyAgeSeconds: 30 * 60,
      }),
    );

    assert.equal(stale.status, "warning");
    assert.equal(fine.status, "ok");
  });

  it("treats an overdue schedule as visible, not silent", () => {
    const { summary } = backgroundQueueCheckStatus(
      metric({ overdueScheduleCount: 3 }),
    );

    assert.match(summary, /3 overdue schedule/);
  });

  it("prefers the dead-letter error over a staleness warning", () => {
    const { status } = backgroundQueueCheckStatus(
      metric({ failedCount: 1, oldestReadyAgeSeconds: 30 * 60 }),
    );

    assert.equal(status, "error");
  });

  it("falls back to a sane threshold for an unknown job type", () => {
    const fresh = backgroundQueueCheckStatus(
      metric({ jobType: "not_a_real_job", oldestReadyAgeSeconds: 60 }),
    );
    const stale = backgroundQueueCheckStatus(
      metric({ jobType: "not_a_real_job", oldestReadyAgeSeconds: 3 * 60 * 60 }),
    );

    assert.equal(fresh.status, "ok");
    assert.equal(stale.status, "warning");
  });
});
