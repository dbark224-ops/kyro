import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectUrgentEscalationTriggers } from "./urgent-escalation";

/**
 * Kyro's own paraphrase was deciding whether the owner got woken up.
 *
 * Found by running a long, deliberately unhurried mock inquiry: a customer
 * listing several small plumbing faults, saying outright that she would rather
 * have them done properly over a year than badly in a week. It escalated on
 * after_hours_emergency at midnight.
 *
 * She wrote that a tap "drips" and that another "drips constantly". The
 * classifier wrote that back as "leaking taps ... an outside tap leak", the
 * summary was fed to the keyword match along with the message, and `\bleak\b`
 * did the rest. No negation was involved and no guard was wrong -- the word
 * being matched was never in the inquiry.
 *
 * Both `title` and `summary` are Kyro's, written for display. Only `content`
 * is the customer: subject and body for email, the message for SMS, the call
 * note for voice. So triggers read `content` and nothing else.
 *
 * The narrower predecessor excluded titles for voice calls only, on exactly
 * this reasoning, and missed that the summary and the email lead title are
 * generated too.
 */
const INQUIRY =
  "The kitchen sink drains slowly and the tap drips. The outside tap drips constantly. Happy to spread this over the year -- I would rather it was done properly than quickly.";

describe("a trigger must come from the customer, not from Kyro", () => {
  it("does not escalate the inquiry that started this", () => {
    const found = detectUrgentEscalationTriggers(
      {
        content: INQUIRY,
        sourceKey: "test",
        sourceType: "email",
        // What the classifier made of it, verbatim from the run.
        summary:
          "Gmail email from Constance Aldebrand: Constance Aldebrand requests a plumbing assessment for slow drainage, leaking taps, low water pressure, sink gurgling, an outside tap leak, a smelly floor waste, and hot-water concerns.",
        title: "Plumbing Inspection And Repairs Prioritization",
      },
      { afterHours: true },
    );

    assert.deepEqual(found, []);
  });

  it("ignores a generated title on every source, not just voice calls", () => {
    for (const sourceType of ["email", "sms", "manual", "voice_call"] as const) {
      const found = detectUrgentEscalationTriggers(
        {
          content: "Could you quote for a new vanity unit when you get a chance?",
          sourceKey: "test",
          sourceType,
          title: "Emergency Bathroom Leak",
          summary: "Urgent: burst pipe reported",
        },
        { afterHours: true },
      );

      assert.deepEqual(found, [], `${sourceType} read a generated field`);
    }
  });

  it("still escalates when the customer is the one saying it", () => {
    // The same words, in the message this time. These must keep firing --
    // suppressing a real emergency is far worse than an extra alert.
    const found = detectUrgentEscalationTriggers(
      {
        content: "Urgent -- burst pipe, water pouring through the ceiling.",
        sourceKey: "test",
        sourceType: "email",
        title: "Quote request",
        summary: "Customer would like a quote at some point.",
      },
      { afterHours: true },
    );

    assert.ok(found.includes("explicit_urgency"));
    assert.ok(found.includes("active_property_damage"));
    assert.ok(found.includes("after_hours_emergency"));
  });

  it("keeps reading the voice call note, which is all a call has", () => {
    const found = detectUrgentEscalationTriggers(
      {
        content: "Caller reports a gas smell in the kitchen and has left the house.",
        sourceKey: "test",
        sourceType: "voice_call",
      },
      { afterHours: false },
    );

    assert.ok(found.includes("safety_risk"));
  });
});
