import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectUrgentEscalationTriggers,
  readsAsWithdrawal,
} from "./urgent-escalation";

/**
 * Being woken at midnight because a customer cancelled.
 *
 * repeat_contact_short_window counts inbound messages since the last outbound
 * and never reads what they say. Two messages with no answer is real pressure.
 * But the withdraws scenario sent a job request and then, on the same thread,
 * "Actually, we've decided not to go ahead for now -- my brother-in-law is
 * going to do it. Please cancel the enquiry, no need to quote." That escalated,
 * and the alert opened "Urgent: I'll keep chasing until you reply."
 *
 * A customer withdrawing is releasing the owner, not chasing them.
 *
 * The bound matters more than the vocabulary: this only applies when repeat
 * contact is the ONLY reason to escalate. A wrong call here means an alert
 * that never arrives, which is the expensive direction, so the wording is
 * narrow and misses withdrawals rather than risking a customer who is
 * genuinely chasing.
 */
const repeatContact = { repeatContact: true };

function triggers(content: string, metadata: Record<string, unknown> = repeatContact) {
  return detectUrgentEscalationTriggers(
    { content, metadata, sourceKey: "test", sourceType: "email" },
    { afterHours: false },
  );
}

describe("a customer calling the work off", () => {
  it("does not escalate as repeat contact", () => {
    const found = triggers(
      "Actually, we've decided not to go ahead for now -- my brother-in-law is going to do it. Please cancel the enquiry, no need to quote.",
    );

    assert.deepEqual(found, []);
  });

  it("is recognised in the ways people write it", () => {
    // The vocabulary triage already had caught 2 of these 10.
    for (const text of [
      "Please cancel the enquiry, no need to quote",
      "We've decided not to go ahead for now",
      "we'll leave it for now thanks",
      "no longer need this doing",
      "we've sorted it ourselves",
      "not interested thanks",
      "we've gone with someone else",
      "please disregard my last message",
      "wrong number sorry",
      "we're not going to proceed",
    ]) {
      assert.equal(readsAsWithdrawal(text), true, text);
    }
  });
});

describe("what must still wake the owner", () => {
  it("keeps escalating a customer who is chasing", () => {
    for (const content of [
      "when can you come? I still haven't heard back",
      "the tap is still dripping, any update",
      "can you confirm you got my message",
      "I need this cancelled appointment rebooked urgently",
    ]) {
      assert.deepEqual(
        triggers(content),
        ["repeat_contact_short_window"],
        content,
      );
    }
  });

  it("never suppresses when anything else is wrong", () => {
    // A withdrawal that also reports a burst pipe is still an emergency. The
    // suppression only ever applies when repeat contact stands alone.
    const found = triggers(
      "Please cancel the enquiry -- although there is water pouring through the ceiling now.",
    );

    assert.ok(found.includes("active_property_damage"));
    assert.ok(found.includes("repeat_contact_short_window"));
  });

  it("leaves a withdrawal alone when there was no repeat contact", () => {
    // Nothing to suppress, and nothing to add.
    assert.deepEqual(triggers("Please cancel the enquiry.", {}), []);
  });

  it("does not read a cancelled appointment as a cancellation", () => {
    // "cancel" is matched as a bare verb only. Widening it to "cancelled"
    // would silence the alert for a customer chasing about one.
    assert.equal(readsAsWithdrawal("my cancelled appointment needs rebooking"), false);
  });
});
