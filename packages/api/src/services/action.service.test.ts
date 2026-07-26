import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionStatus } from "@kyro/contracts";
import {
  assertActionTransition,
  canTransitionAction,
  createPendingAction,
  getInitialActionStatus,
} from "./action.service";

const ALL_STATUSES: ActionStatus[] = [
  "requested",
  "pending_approval",
  "approved",
  "executing",
  "completed",
  "failed",
  "cancelled",
];

const TERMINAL: ActionStatus[] = ["completed", "failed", "cancelled"];

/**
 * The approval state machine is the safety engine: it is what stands between
 * an AI-proposed action and it actually running against a customer. It had no
 * tests, so the rules are walked exhaustively here rather than sampled.
 */
describe("action approval gate", () => {
  it("holds an approval-required action at pending_approval", () => {
    assert.equal(getInitialActionStatus(true), "pending_approval");
    assert.equal(
      createPendingAction({
        approvalRequired: true,
        input: {},
        requestedBy: "ai",
        type: "draft_reply",
        workspaceId: "ws-1",
      }).status,
      "pending_approval",
    );
  });

  it("lets an action that needs no approval start approved", () => {
    assert.equal(getInitialActionStatus(false), "approved");
    assert.equal(
      createPendingAction({
        approvalRequired: false,
        input: {},
        requestedBy: "system",
        type: "draft_reply",
        workspaceId: "ws-1",
      }).status,
      "approved",
    );
  });

  it("never lets a pending action reach executing without approval", () => {
    // The invariant the whole engine exists for.
    assert.equal(canTransitionAction("pending_approval", "executing"), false);
    assert.throws(
      () => assertActionTransition("pending_approval", "executing"),
      /Action cannot transition from pending_approval to executing/,
    );
    assert.equal(canTransitionAction("requested", "executing"), false);
  });

  it("only reaches executing from approved", () => {
    const canExecuteFrom = ALL_STATUSES.filter((status) =>
      canTransitionAction(status, "executing"),
    );

    assert.deepEqual(canExecuteFrom, ["approved"]);
  });

  it("allows the full happy path", () => {
    const path: ActionStatus[] = [
      "requested",
      "pending_approval",
      "approved",
      "executing",
      "completed",
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      assert.doesNotThrow(() =>
        assertActionTransition(path[index], path[index + 1]),
      );
    }
  });

  it("allows cancelling any time before execution starts", () => {
    for (const status of ["requested", "pending_approval", "approved"] as const) {
      assert.equal(canTransitionAction(status, "cancelled"), true);
    }

    // Once it is running, cancelling is no longer a truthful outcome: it has
    // either completed or failed.
    assert.equal(canTransitionAction("executing", "cancelled"), false);
  });

  it("lets a running action only complete or fail", () => {
    const fromExecuting = ALL_STATUSES.filter((status) =>
      canTransitionAction("executing", status),
    );

    assert.deepEqual(fromExecuting.sort(), ["completed", "failed"]);
  });

  it("treats completed, failed and cancelled as final", () => {
    for (const status of TERMINAL) {
      for (const target of ALL_STATUSES) {
        assert.equal(
          canTransitionAction(status, target),
          false,
          `${status} must not transition to ${target}`,
        );
      }
    }
  });

  it("never allows an action to re-enter its own state", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        canTransitionAction(status, status),
        false,
        `${status} must not transition to itself`,
      );
    }
  });

  it("names both states when it refuses", () => {
    assert.throws(
      () => assertActionTransition("completed", "executing"),
      /Action cannot transition from completed to executing/,
    );
  });
});
