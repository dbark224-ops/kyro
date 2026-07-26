import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordUsageEvents } from "./openai";

/**
 * usage_events is what customer charges are computed from. Two of the three
 * call sites used to insert into it and drop the returned error on the floor,
 * so a failed write meant billable work vanished with nothing to reconstruct
 * it from. These tests pin the two properties that prevents:
 *
 *   1. a failure is always reported back to the caller, and
 *   2. the event payload is written to the audit log so the charge survives.
 */
type Insert = { table: string; rows: unknown };

function fakeSupabase({ failOn = [] }: { failOn?: string[] } = {}) {
  const inserts: Insert[] = [];

  return {
    inserts,
    client: {
      from(table: string) {
        return {
          insert(rows: unknown) {
            inserts.push({ rows, table });

            return Promise.resolve({
              error: failOn.includes(table)
                ? { message: `${table} write failed` }
                : null,
            });
          },
        };
      },
    } as never,
  };
}

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

// Must satisfy usageEventCreateSchema -- the rows go through Zod on the way in.
const EVENT = {
  costSnapshot: 0.01,
  currency: "USD",
  customerChargeSnapshot: 0.02,
  markupSnapshot: 1,
  provider: "openai",
  quantity: 1,
  service: "llm",
  unit: "tokens",
  unitCostSnapshot: 0.00001,
  usageType: "llm_input_tokens",
  workspaceId: WORKSPACE_ID,
} as never;

describe("recordUsageEvents", () => {
  it("reports no error when the write lands", async () => {
    const { client, inserts } = fakeSupabase();

    const { error } = await recordUsageEvents(client, {
      context: "test",
      events: [EVENT],
      workspaceId: WORKSPACE_ID,
    });

    assert.equal(error, null);
    assert.deepEqual(
      inserts.map((entry) => entry.table),
      ["usage_events"],
      "a successful write must not also write an audit row",
    );
  });

  it("returns the failure instead of swallowing it", async () => {
    const { client } = fakeSupabase({ failOn: ["usage_events"] });

    const { error } = await recordUsageEvents(client, {
      context: "reply_draft",
      events: [EVENT],
      workspaceId: WORKSPACE_ID,
    });

    assert.ok(error, "a failed usage write must be reported to the caller");
    assert.match(error.message, /reply_draft/);
  });

  it("preserves the lost charge in the audit log", async () => {
    const { client, inserts } = fakeSupabase({ failOn: ["usage_events"] });

    await recordUsageEvents(client, {
      context: "reply_draft",
      events: [EVENT],
      workspaceId: WORKSPACE_ID,
    });

    const audit = inserts.find((entry) => entry.table === "audit_logs");

    assert.ok(audit, "the failure must leave a durable record");

    const row = audit.rows as {
      action: string;
      after: { events: unknown[] };
      workspace_id: string;
    };

    assert.equal(row.action, "usage.recording_failed");
    assert.equal(row.workspace_id, WORKSPACE_ID);
    assert.equal(
      row.after.events.length,
      1,
      "the event payload must survive so the charge can be reconstructed",
    );
  });

  it("survives the audit log failing too, rather than throwing", async () => {
    const { client } = fakeSupabase({ failOn: ["usage_events", "audit_logs"] });

    const { error } = await recordUsageEvents(client, {
      context: "triage",
      events: [EVENT],
      workspaceId: WORKSPACE_ID,
    });

    assert.ok(error, "the original failure is still what gets reported");
  });

  it("does not write at all for an empty event list", async () => {
    const { client, inserts } = fakeSupabase();

    const { error } = await recordUsageEvents(client, {
      context: "test",
      events: [],
      workspaceId: WORKSPACE_ID,
    });

    assert.equal(error, null);
    assert.equal(inserts.length, 0);
  });
});
