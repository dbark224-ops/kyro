import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateContactLifecycle } from "./lifecycle";

describe("evaluateContactLifecycle", () => {
  it("keeps manual lifecycle choices authoritative", () => {
    const result = evaluateContactLifecycle({
      currentStage: "lead",
      lifecycleSource: "manual",
      quoteApprovalLinks: [{ approvedAt: "2026-05-01T00:00:00.000Z" }],
    });

    assert.equal(result.manualOverride, true);
    assert.equal(result.recommendedStage, "lead");
    assert.equal(result.shouldSuggest, false);
  });

  it("suggests client when a quote has been approved", () => {
    const result = evaluateContactLifecycle({
      currentStage: "lead",
      quoteApprovalLinks: [{ status: "approved" }],
    });

    assert.equal(result.recommendedStage, "client");
    assert.equal(result.confidence, "high");
    assert.equal(result.shouldSuggest, true);
  });

  it("uses quote metadata approval evidence when approval links are not loaded", () => {
    const result = evaluateContactLifecycle({
      currentStage: "lead",
      quoteDrafts: [
        {
          metadata: {
            latestApproval: {
              approvedAt: "2026-05-10T00:00:00.000Z",
            },
          },
          status: "sent",
        },
      ],
    });

    assert.equal(result.recommendedStage, "client");
    assert.equal(result.confidence, "high");
    assert.equal(
      result.evidence.some((signal) => signal.key === "accepted_quote"),
      true,
    );
  });

  it("suggests client when work appears booked or started", () => {
    const result = evaluateContactLifecycle({
      currentStage: "lead",
      leads: [{ status: "in_progress" }],
    });

    assert.equal(result.recommendedStage, "client");
    assert.equal(result.shouldSuggest, true);
  });

  it("uses future commercial records as high-confidence lifecycle evidence", () => {
    const result = evaluateContactLifecycle({
      commercialRecords: [
        {
          kind: "invoice",
          paidAt: "2026-05-12T00:00:00.000Z",
          status: "paid",
        },
      ],
      currentStage: "lead",
    });

    assert.equal(result.recommendedStage, "client");
    assert.equal(result.confidence, "high");
    assert.equal(
      result.evidence.some((signal) => signal.key === "commercial_record"),
      true,
    );
  });

  it("uses completed business actions as lifecycle evidence", () => {
    const result = evaluateContactLifecycle({
      actions: [
        {
          status: "completed",
          type: "record_work_order",
        },
      ],
      currentStage: "lead",
    });

    assert.equal(result.recommendedStage, "client");
    assert.equal(result.confidence, "high");
    assert.equal(
      result.evidence.some(
        (signal) => signal.key === "completed_business_action",
      ),
      true,
    );
  });

  it("keeps unresolved enquiries as leads", () => {
    const result = evaluateContactLifecycle({
      currentStage: "lead",
      leads: [{ nextStep: "Review AI proposed reply", status: "new" }],
      messages: [{ direction: "inbound" }],
    });

    assert.equal(result.recommendedStage, "lead");
    assert.equal(result.shouldSuggest, false);
  });

  it("uses repeated two-way communication as a medium confidence signal", () => {
    const result = evaluateContactLifecycle({
      currentStage: "lead",
      messages: [
        { direction: "inbound" },
        { direction: "outbound" },
        { direction: "inbound" },
      ],
    });

    assert.equal(result.recommendedStage, "client");
    assert.equal(result.confidence, "medium");
    assert.equal(result.shouldSuggest, true);
  });
});
