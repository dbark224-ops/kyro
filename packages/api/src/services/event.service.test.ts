import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertEventTransition,
  canTransitionEvent,
  createEvent,
  eventStatusTransitions,
  type EventStatus,
} from "./event.service";

const ALL_STATUSES = Object.keys(eventStatusTransitions) as EventStatus[];

describe("event processing gate", () => {
  it("starts every ingested event pending", () => {
    const event = createEvent({
      idempotencyKey: "twilio:SM123",
      payload: {},
      source: "twilio.webhook",
      type: "inbound.sms.received",
      workspaceId: "ws-1",
    });

    assert.equal(event.status, "pending");
    assert.ok(event.id);
  });

  it("carries the idempotency key through, since it is the replay guard", () => {
    const event = createEvent({
      idempotencyKey: "twilio:SM123",
      payload: { from: "+61412345678" },
      source: "twilio.webhook",
      type: "inbound.sms.received",
      workspaceId: "ws-1",
    });

    assert.equal(event.idempotencyKey, "twilio:SM123");
    assert.deepEqual(event.payload, { from: "+61412345678" });
  });

  it("gives each event its own id", () => {
    const input = {
      idempotencyKey: "twilio:SM123",
      payload: {},
      source: "twilio.webhook",
      type: "inbound.sms.received",
      workspaceId: "ws-1",
    };

    assert.notEqual(createEvent(input).id, createEvent(input).id);
  });

  it("allows the full happy path", () => {
    assert.doesNotThrow(() => assertEventTransition("pending", "processing"));
    assert.doesNotThrow(() => assertEventTransition("processing", "processed"));
  });

  it("never lets an event skip straight to processed", () => {
    // Skipping "processing" would mean an event marked done that no worker
    // ever picked up.
    assert.equal(canTransitionEvent("pending", "processed"), false);
    assert.throws(
      () => assertEventTransition("pending", "processed"),
      /Event cannot transition from pending to processed/,
    );
  });

  it("lets either stage fail", () => {
    assert.equal(canTransitionEvent("pending", "failed"), true);
    assert.equal(canTransitionEvent("processing", "failed"), true);
  });

  it("treats processed and failed as final", () => {
    for (const status of ["processed", "failed"] as const) {
      for (const target of ALL_STATUSES) {
        assert.equal(
          canTransitionEvent(status, target),
          false,
          `${status} must not transition to ${target}`,
        );
      }
    }
  });

  it("never allows an event to re-enter its own state", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        canTransitionEvent(status, status),
        false,
        `${status} must not transition to itself`,
      );
    }
  });
});
