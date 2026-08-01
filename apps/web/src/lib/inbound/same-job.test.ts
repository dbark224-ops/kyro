import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideSameJob, SAME_JOB_WINDOW_MS } from "./same-job";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const lead = (over: Partial<Parameters<typeof decideSameJob>[0]["openLead"] & object> = {}) => ({
  createdAt: minutesAgo(20),
  id: "lead-1",
  serviceType: "Plumbing",
  status: "new",
  title: "Leaking tap",
  ...over,
});

describe("one customer, one problem, two channels", () => {
  it("attaches the second channel to the job already open", () => {
    // The case this exists for: emailed, heard nothing, texted twenty minutes
    // later because they are worried.
    const decision = decideSameJob({
      incomingServiceType: "Plumbing",
      now: NOW,
      openLead: lead(),
    });

    assert.equal(decision.attach, true);
    assert.equal(decision.attach && decision.leadId, "lead-1");
  });

  it("attaches when only one side names the trade", () => {
    // An unnamed service is not evidence of a different job.
    for (const [existing, incoming] of [
      [null, "Plumbing"],
      ["Plumbing", null],
      [null, null],
    ] as const) {
      const decision = decideSameJob({
        incomingServiceType: incoming,
        now: NOW,
        openLead: lead({ serviceType: existing }),
      });

      assert.equal(decision.attach, true, `${existing} / ${incoming}`);
    }
  });

  it("ignores casing and padding around the trade", () => {
    const decision = decideSameJob({
      incomingServiceType: "  plumbing ",
      now: NOW,
      openLead: lead({ serviceType: "Plumbing" }),
    });

    assert.equal(decision.attach, true);
  });
});

describe("and the times it must not merge them", () => {
  it("keeps two different trades apart", () => {
    // A blocked drain and a dead socket on the same afternoon are two visits.
    const decision = decideSameJob({
      incomingServiceType: "Electrical",
      now: NOW,
      openLead: lead({ serviceType: "Plumbing" }),
    });

    assert.equal(decision.attach, false);
  });

  it("will not merge when it is unsure who the person is", () => {
    // Merging two people's jobs is the worst outcome available here.
    const decision = decideSameJob({
      hasProfileConflict: true,
      incomingServiceType: "Plumbing",
      now: NOW,
      openLead: lead(),
    });

    assert.equal(decision.attach, false);
  });

  it("leaves a settled job alone", () => {
    for (const status of [
      "won",
      "lost",
      "completed",
      "closed",
      "archived",
      "cancelled",
      "not_fit",
      "COMPLETED",
    ]) {
      const decision = decideSameJob({
        incomingServiceType: "Plumbing",
        now: NOW,
        openLead: lead({ status }),
      });

      assert.equal(decision.attach, false, status);
    }
  });

  it("does not reach back beyond the window", () => {
    const justInside = decideSameJob({
      now: NOW,
      openLead: lead({ createdAt: minutesAgo(SAME_JOB_WINDOW_MS / 60_000 - 1) }),
    });
    const justOutside = decideSameJob({
      now: NOW,
      openLead: lead({ createdAt: minutesAgo(SAME_JOB_WINDOW_MS / 60_000 + 1) }),
    });

    assert.equal(justInside.attach, true);
    assert.equal(justOutside.attach, false);
  });

  it("treats a job dated in the future as a clock fault, not a duplicate", () => {
    const decision = decideSameJob({
      now: NOW,
      openLead: lead({ createdAt: minutesAgo(-30) }),
    });

    assert.equal(decision.attach, false);
  });

  it("declines on an unusable date rather than guessing", () => {
    const decision = decideSameJob({
      now: NOW,
      openLead: lead({ createdAt: "not a date" }),
    });

    assert.equal(decision.attach, false);
  });

  it("declines when there is no open job at all", () => {
    assert.equal(decideSameJob({ now: NOW, openLead: null }).attach, false);
  });
});
