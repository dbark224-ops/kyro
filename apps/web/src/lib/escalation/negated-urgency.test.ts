import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectUrgentEscalationTriggers } from "./urgent-escalation";

/**
 * "Not urgent" was reading as urgent.
 *
 * Found by running three mock inquiries and reading what came out: all three
 * escalated on explicit_urgency, including one whose subject line was "Rough
 * quote for an ensuite renovation, no rush" and one that said "Not urgent, I
 * just can't raise the order until I have those answers."
 *
 * `\burgent\b` matches the word inside its own negation. The classifier
 * summarised the first as "No urgent deadline", and that was enough to text the
 * owner, text them again at fifteen minutes, and ring them at the hour -- about
 * a bathroom quote somebody had gone out of their way to say was not urgent.
 *
 * The guard is deliberately narrow. A missed emergency is far worse than an
 * extra alert, so it only suppresses a keyword directly preceded by a negation
 * in the same clause. Everything in the second block below must keep escalating.
 */
function triggers(content: string, options = { afterHours: false }) {
  return detectUrgentEscalationTriggers(
    { content, sourceKey: "test", sourceType: "email" },
    options,
  );
}

/**
 * The most-fired trigger in the system caught 3 of 11 ways of saying it.
 *
 * Swept after the same fault turned up in seven other patterns. The stand-out
 * was that it matched "asap" and not "as soon as possible" -- the same words,
 * spelled out, which is how most people write it. Also missing: "this can't
 * wait", "straight away", "right away" (it had "right now"), "please hurry",
 * "we're desperate" and "we need this sorted today".
 *
 * after_hours_emergency fired on 2 of 6 in the same sweep: it knew "no hot
 * water" but not "no water at all", "no heating" but not "the heating has
 * packed up", and had nothing for an overflowing toilet.
 *
 * Widening these is only safe because the negation guard below holds, so the
 * two are tested together.
 */
describe("urgency, in the words people use", () => {
  it("hears all of these", () => {
    for (const content of [
      "please come as soon as possible",
      "this can't wait",
      "we're desperate, please help",
      "can someone come straight away",
      "I need someone right away",
      "please hurry",
      "we need this sorted today",
      "how quickly can someone get here",
    ]) {
      assert.ok(triggers(content).includes("explicit_urgency"), content);
    }
  });

  it("hears an out-of-hours emergency the same way", () => {
    for (const content of [
      "the heating has packed up",
      "we've got no water at all",
      "the toilet is overflowing",
      "there's no electricity in half the house",
    ]) {
      assert.ok(
        triggers(content, { afterHours: true }).includes(
          "after_hours_emergency",
        ),
        content,
      );
    }
  });

  it("still says nothing when the customer is relaxed", () => {
    // The counterweight to all that widening, tested out of hours where the
    // bar is lowest. "no hurry" leans on the negation guard below.
    for (const content of [
      "no rush at all",
      "whenever suits you",
      "sometime next month",
      "not urgent, just a quote",
      "no hurry, we're away anyway",
      "can you quote to replace a kitchen tap",
      "we're thinking about a new bathroom next year",
      "the outside tap drips a bit",
    ]) {
      assert.deepEqual(triggers(content, { afterHours: true }), [], content);
    }
  });
});

describe("denying a thing is not reporting it", () => {
  it("does not escalate the inquiry that started this", () => {
    // The classifier's own words for a customer who said "No rush at all".
    const found = triggers(
      "Bea Ferreira is seeking a rough quote for a small ensuite renovation. No urgent deadline; she is available for a site visit within the next couple of weeks.",
    );

    assert.deepEqual(found, []);
  });

  it("does not escalate a customer who says it is not urgent", () => {
    const found = triggers(
      "Not urgent, I just can't raise the order until I have those answers.",
    );

    assert.deepEqual(found, []);
  });

  it("handles the ordinary ways people phrase it", () => {
    for (const phrase of [
      "this is not urgent",
      "nothing urgent here",
      "no emergency, just a quote",
      "it isn't urgent",
      "not particularly urgent",
      "not that urgent",
      "there is no flooding",
      "no gas leak, just a smell of damp",
      "we have no complaint about the work",
    ]) {
      assert.deepEqual(triggers(phrase), [], phrase);
    }
  });
});

describe("everything that should still wake someone up", () => {
  it("escalates plain urgency", () => {
    for (const phrase of [
      "this is urgent",
      "we need someone urgently -- it is an emergency",
      "please come asap",
      "I need someone immediately",
    ]) {
      assert.ok(
        triggers(phrase).includes("explicit_urgency"),
        `should escalate: ${phrase}`,
      );
    }
  });

  it("does not let a negation reach across a comma", () => {
    // The dangerous false negative. "no water" and "urgent" are two separate
    // statements, and the second is the one that matters.
    assert.ok(
      triggers("no water, urgent please").includes("explicit_urgency"),
    );
    assert.ok(
      triggers("no access to the rear. Flooding in the kitchen").includes(
        "active_property_damage",
      ),
    );
  });

  it("keeps a negation from suppressing a later sentence", () => {
    assert.ok(
      triggers(
        "The quote is not urgent. But there is a gas leak in the laundry.",
      ).includes("safety_risk"),
    );
  });

  it("still escalates real damage and danger", () => {
    assert.ok(triggers("the kitchen is flooding").includes("active_property_damage"));
    assert.ok(triggers("I can smell gas").includes("safety_risk"));
    assert.ok(
      triggers("the light fitting was sparking").includes("safety_risk"),
    );
  });

  it("catches gas however it is worded", () => {
    // "Gas smell in the laundry" reached production and matched nothing in the
    // safety list, which had only "gas leak" and "smell gas". It escalated on
    // the word "urgent" alone; a calmer customer would not have been.
    for (const phrase of [
      "gas smell in the laundry",
      "there is a gas leak",
      "I can smell gas",
      "smells of gas near the meter",
      "strong gas odour outside",
      "gas odor in the kitchen",
    ]) {
      assert.ok(
        triggers(phrase).includes("safety_risk"),
        `should be a safety risk: ${phrase}`,
      );
    }
  });

  it("does not fire on gas that is merely mentioned as ruled out", () => {
    assert.deepEqual(triggers("no gas smell, just a damp patch"), []);
  });

  it("still escalates a complaint", () => {
    assert.ok(
      triggers("this is unacceptable and I want a refund").includes(
        "complaint_or_reputation_risk",
      ),
    );
  });

  it("keeps the structured priority flag independent of wording", () => {
    // An explicit priority is a decision, not a phrase, and no amount of
    // hedging in the text should talk it down.
    const found = detectUrgentEscalationTriggers(
      {
        content: "Not urgent at all.",
        priority: "urgent",
        sourceKey: "test",
        sourceType: "email",
      },
      { afterHours: false },
    );

    assert.ok(found.includes("explicit_urgency"));
  });

  it("still treats an absence of utilities as an after-hours emergency", () => {
    // "no hot water" is the absence being reported, not a denial of anything.
    // The keyword list matches it whole, so the negation check never sees a
    // bare "water" preceded by "no".
    const found = triggers("no hot water since this morning", {
      afterHours: true,
    });

    assert.ok(found.includes("after_hours_emergency"), found.join(","));
  });
});
