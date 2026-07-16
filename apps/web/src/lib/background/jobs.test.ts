import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKGROUND_JOB_MAX_READY_AGE_SECONDS,
  unhealthyBackgroundQueueMetrics,
} from "./jobs";

function metric(
  overrides: Partial<
    Parameters<typeof unhealthyBackgroundQueueMetrics>[0][number]
  > = {},
): Parameters<typeof unhealthyBackgroundQueueMetrics>[0][number] {
  return {
    expiredLeaseCount: 0,
    failedCount: 0,
    jobType: "inbound_email_sync",
    oldestReadyAgeSeconds: 0,
    oldestReadyAt: null,
    oldestScheduleAgeSeconds: 0,
    oldestScheduleAt: null,
    overdueScheduleCount: 0,
    processingCount: 0,
    readyCount: 0,
    ...overrides,
  };
}

describe("background queue health", () => {
  it("keeps work healthy through its service threshold", () => {
    const threshold = BACKGROUND_JOB_MAX_READY_AGE_SECONDS.inbound_email_sync;

    assert.deepEqual(
      unhealthyBackgroundQueueMetrics([
        metric({
          oldestReadyAgeSeconds: threshold,
          oldestReadyAt: new Date().toISOString(),
          readyCount: 1,
        }),
      ]),
      [],
    );
  });

  it("flags work older than its job-specific service threshold", () => {
    const overdue = metric({
      jobType: "outbound_delivery",
      oldestReadyAgeSeconds:
        BACKGROUND_JOB_MAX_READY_AGE_SECONDS.outbound_delivery + 1,
      oldestReadyAt: new Date().toISOString(),
      readyCount: 1,
    });

    assert.deepEqual(unhealthyBackgroundQueueMetrics([overdue]), [overdue]);
  });

  it("flags expired leases even when the ready queue is empty", () => {
    const expired = metric({ expiredLeaseCount: 1, processingCount: 1 });

    assert.deepEqual(unhealthyBackgroundQueueMetrics([expired]), [expired]);
  });

  it("flags a scheduler that has stopped producing due jobs", () => {
    const stalled = metric({
      jobType: "calendar_sync",
      oldestScheduleAgeSeconds:
        BACKGROUND_JOB_MAX_READY_AGE_SECONDS.calendar_sync + 1,
      oldestScheduleAt: new Date().toISOString(),
      overdueScheduleCount: 1,
    });

    assert.deepEqual(unhealthyBackgroundQueueMetrics([stalled]), [stalled]);
  });

  it("keeps health unhealthy until dead letters are replayed or resolved", () => {
    const failed = metric({ failedCount: 4 });

    assert.deepEqual(unhealthyBackgroundQueueMetrics([failed]), [failed]);
  });
});
