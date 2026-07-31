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

/**
 * Measured the same way as every keyword rule this codebase has got wrong, and
 * this one was mine, written earlier the same night.
 *
 * Twenty natural ways of calling a job off: nine were read, and those nine were
 * exactly the nine phrasings the patterns had been written from. "Actually
 * never mind", "we've found someone else", "changed our mind", "we got it
 * fixed already" and seven others read as ordinary contact.
 *
 * The false positive mattered more than the misses. A bare \bcancel\b caught
 * "can I cancel Tuesday and come Wednesday instead?", which is a customer
 * rearranging a visit. This function suppresses escalation, so reading an
 * engaged customer as a withdrawal is what leaves somebody waiting in silence
 * -- the opposite asymmetry to the triggers themselves, and the reason the
 * additions here are anchored rather than generous.
 */
describe("calling a job off, in the words people use", () => {
  it("reads a withdrawal however it is phrased", () => {
    for (const body of [
      "Not interested, thanks",
      "we no longer need the work doing",
      "please cancel my enquiry",
      "we've decided not to go ahead",
      "not going to bother in the end",
      "we'll leave it for now, thanks",
      "we sorted it ourselves in the end",
      "we've gone with someone else",
      "disregard my last message",
      "actually never mind",
      "we've found someone else",
      "we got it fixed already",
      "no need anymore, thank you",
      "changed our mind, sorry",
      "we'll hold off for now",
      "please take us off the job",
      "forget it, thanks anyway",
      "we've had it done",
    ]) {
      assert.equal(readsAsWithdrawal(body), true, body);
    }
  });

  it("does not silence a customer who is still waiting", () => {
    for (const body of [
      // Rearranging a visit is not leaving.
      "can I cancel Tuesday and come Wednesday instead?",
      "can I cancel my appointment for Tuesday and rebook?",
      // The phrase appears, the meaning does not.
      "the leak sorted itself out but the tap still drips",
      "we need it done, no longer able to wait",
      "sorry, ignore that -- the address is 12 not 21",
      "I never mind waiting but this is three weeks now",
      "when can you come? we've had it done before by you",
      "we had it done last year and it has failed again",
    ]) {
      assert.equal(readsAsWithdrawal(body), false, body);
    }
  });
});
