import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptModelSignals, evidenceIsFromCustomer } from "./model-signals";
import { detectUrgentEscalationTriggers } from "./urgent-escalation";

/**
 * The whole point of this layer is that the model cannot be believed on its
 * own word, so most of these are about refusing it.
 */
const MESSAGE =
  "Hi, I got a shock off the shower switch this morning and there's a burning smell from the fuse box. Please can the owner ring me, it's urgent.";

describe("a model may add a trigger, but only by quoting the customer", () => {
  it("accepts a signal the customer's own words support", () => {
    const { accepted, rejected } = acceptModelSignals(
      [
        { evidence: "I got a shock off the shower switch", trigger: "safety_risk" },
        { evidence: "can the owner ring me", trigger: "asks_for_owner_now" },
      ],
      MESSAGE,
    );

    assert.deepEqual(accepted.sort(), ["asks_for_owner_now", "safety_risk"]);
    assert.deepEqual(rejected, []);
  });

  it("forgives punctuation and casing, which are not the customer's meaning", () => {
    const { accepted } = acceptModelSignals(
      [{ evidence: "Burning smell, from the fuse box!", trigger: "safety_risk" }],
      MESSAGE,
    );

    assert.deepEqual(accepted, ["safety_risk"]);
  });

  it("refuses a paraphrase, which is the fault that started all this", () => {
    // Kyro once summarised a tap that "drips" as "an outside tap leak" and
    // escalated at midnight on a word the customer never wrote. A model is
    // free to make the same mistake; it just is not believed for it.
    const dripping = "The kitchen tap drips and I'd like it sorted eventually.";
    const { accepted, rejected } = acceptModelSignals(
      [{ evidence: "an outside tap leak causing damage", trigger: "active_property_damage" }],
      dripping,
    );

    assert.deepEqual(accepted, []);
    assert.equal(rejected[0]?.reason, "the quote is not in the customer's message");
  });

  it("refuses an invented emergency outright", () => {
    const ordinary = "Could you quote for a new vanity unit when you get a chance?";
    const { accepted } = acceptModelSignals(
      [
        { evidence: "water pouring through the ceiling", trigger: "active_property_damage" },
        { evidence: "this is an emergency", trigger: "explicit_urgency" },
      ],
      ordinary,
    );

    assert.deepEqual(accepted, []);
  });

  it("refuses a quote too short to mean anything", () => {
    // "It", "the leak", "urgent" would wave through almost any claim.
    for (const evidence of ["it", "the leak", "urgent", ""]) {
      assert.equal(evidenceIsFromCustomer(evidence, MESSAGE), false, evidence);
    }
  });

  it("refuses triggers the model has no business deciding", () => {
    // The clock, the contact history and the call metadata are exact in code.
    for (const trigger of [
      "after_hours_emergency",
      "repeat_contact_pressure",
      "missed_known_customer_call",
      "vip_customer",
      "not_a_real_trigger",
    ]) {
      const { accepted, rejected } = acceptModelSignals(
        [{ evidence: "I got a shock off the shower switch", trigger }],
        MESSAGE,
      );

      assert.deepEqual(accepted, [], trigger);
      assert.equal(
        rejected[0]?.reason,
        "not a trigger the model may raise from the message",
      );
    }
  });

  it("copes with the model returning nothing, or rubbish", () => {
    assert.deepEqual(acceptModelSignals(null, MESSAGE).accepted, []);
    assert.deepEqual(acceptModelSignals(undefined, MESSAGE).accepted, []);
    assert.deepEqual(acceptModelSignals([], MESSAGE).accepted, []);
    assert.deepEqual(
      acceptModelSignals(
        [{ evidence: null, trigger: null } as never],
        MESSAGE,
      ).accepted,
      [],
    );
  });

  it("does not repeat a trigger two signals both claim", () => {
    const { accepted } = acceptModelSignals(
      [
        { evidence: "I got a shock off the shower switch", trigger: "safety_risk" },
        { evidence: "burning smell from the fuse box", trigger: "safety_risk" },
      ],
      MESSAGE,
    );

    assert.deepEqual(accepted, ["safety_risk"]);
  });
});

/**
 * The layer wired into the detector, which is where it has to hold up.
 */
describe("the model opinion joins the keywords without overruling them", () => {
  const fire = (
    content: string,
    modelSignals: Array<{ evidence: string; trigger: string }> = [],
    over: Record<string, unknown> = {},
  ) =>
    detectUrgentEscalationTriggers(
      { content, modelSignals, sourceKey: "test", sourceType: "email", ...over },
      { afterHours: false },
    );

  it("catches what the keywords miss", () => {
    // Phrasing no pattern here covers, and the model quotes it exactly.
    const content =
      "The ceiling in the back bedroom has started bowing downwards and there is water coming through the light fitting above the stairs.";

    assert.ok(
      fire(content, [
        {
          evidence: "the ceiling in the back bedroom has started bowing downwards",
          trigger: "active_property_damage",
        },
      ]).includes("active_property_damage"),
    );
  });

  it("leaves the keyword result alone when the model says nothing", () => {
    const content = "Urgent -- burst pipe, water pouring through the ceiling.";

    assert.deepEqual(fire(content, []), fire(content));
  });

  it("cannot escalate an ordinary job on an invented quote", () => {
    const content = "Could you quote to replace a kitchen tap when you're free?";

    assert.deepEqual(
      fire(content, [
        { evidence: "water is pouring through the ceiling", trigger: "active_property_damage" },
        { evidence: "this is an emergency", trigger: "explicit_urgency" },
      ]),
      [],
    );
  });

  it("cannot undo the withdrawal guard", () => {
    // That guard stops somebody being woken for a cancellation. A model
    // finding "pressure" in a message calling the job off must not reinstate
    // it -- which is why the signals are applied after the suppression.
    const found = fire(
      "Actually we've changed our mind, please cancel the enquiry.",
      [
        {
          evidence: "please cancel the enquiry",
          trigger: "repeat_contact_pressure",
        },
      ],
      { existingCustomer: true },
    );

    assert.ok(!found.includes("repeat_contact_short_window" as never));
  });

  it("still refuses to read Kyro's own title and summary", () => {
    // The model reads the customer's message. The evidence check compares
    // against content, so a quote lifted from a generated title fails.
    const found = fire(
      "Could you quote for a new vanity unit when you get a chance?",
      [{ evidence: "Emergency Bathroom Leak reported", trigger: "safety_risk" }],
      { summary: "Urgent: burst pipe reported", title: "Emergency Bathroom Leak" },
    );

    assert.deepEqual(found, []);
  });
});
