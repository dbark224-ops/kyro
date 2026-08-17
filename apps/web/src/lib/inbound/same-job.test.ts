import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideSameJob, mergeTradeLabels, SAME_JOB_WINDOW_MS } from "./same-job";

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
      now: NOW,
      openLead: lead(),
    });

    assert.equal(decision.attach, true);
    assert.equal(decision.attach && decision.leadId, "lead-1");
  });

  it("attaches a different trade to the same job", () => {
    // The owner's decision, and a reversal of the earlier rule: a firm that
    // does plumbing and electrical wants one visit carrying both, not two jobs
    // for the customer who mentions a socket after a tap.
    for (const existing of ["Plumbing", "Electrical", null]) {
      const decision = decideSameJob({
        now: NOW,
        openLead: lead({ serviceType: existing }),
      });

      assert.equal(decision.attach, true, `existing: ${existing}`);
    }
  });
});

describe("and the times it must not merge them", () => {
  it("will not merge when it is unsure who the person is", () => {
    // Merging two people's jobs is the worst outcome available here.
    const decision = decideSameJob({
      hasProfileConflict: true,
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

describe("a job that carries more than one trade", () => {
  it("joins two genuinely different trades", () => {
    // What the owner asked for in as many words.
    assert.equal(
      mergeTradeLabels("Plumbing", "Electrical"),
      "Plumbing + Electrical",
    );
  });

  it("keeps the more specific of two names for the same trade", () => {
    // These labels are free text from a model. Production holds "Plumbing",
    // "Plumbing Repair" and "Plumbing - Tap Repair" as separate values, and
    // listing them side by side would read as three jobs.
    assert.equal(mergeTradeLabels("Plumbing", "Plumbing Repair"), "Plumbing Repair");
    assert.equal(mergeTradeLabels("Plumbing Repair", "Plumbing"), "Plumbing Repair");
    assert.equal(mergeTradeLabels("Plumbing", "  plumbing  "), "Plumbing");
    assert.equal(
      mergeTradeLabels("Plumbing - Tap Repair", "plumbing tap repair"),
      "Plumbing - Tap Repair",
    );
  });

  it("does not let one trade swallow a different one that contains it", () => {
    // "Retiling" is not "Tiling" done again, so word boundaries matter.
    assert.equal(mergeTradeLabels("Tiling", "Retiling"), "Tiling + Retiling");
  });

  it("does not add a trade the job already carries", () => {
    assert.equal(
      mergeTradeLabels("Plumbing + Electrical", "Electrical"),
      "Plumbing + Electrical",
    );
  });

  it("takes whichever side exists when the other is empty", () => {
    assert.equal(mergeTradeLabels(null, "Plumbing"), "Plumbing");
    assert.equal(mergeTradeLabels("Plumbing", null), "Plumbing");
    assert.equal(mergeTradeLabels("Plumbing", "   "), "Plumbing");
    assert.equal(mergeTradeLabels(null, null), null);
  });

  it("stops before the label outgrows the job card", () => {
    // A card that names everything names nothing.
    const crowded = "Plumbing + Electrical + Tiling + Carpentry";

    assert.equal(mergeTradeLabels(crowded, "Roofing"), crowded);

    const long = "Emergency Plumbing And Drainage Investigation Works";
    assert.equal(
      mergeTradeLabels(`${long} + Electrical Fault Finding And Certification`, long.replace("Plumbing", "Heating")),
      `${long} + Electrical Fault Finding And Certification`,
    );
  });
});
