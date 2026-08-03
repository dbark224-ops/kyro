import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEmergency, signalsFromReply } from "./emergency-classifier";
import { acceptModelSignals } from "./model-signals";

/**
 * The parsing, and the promise that this can never cost an enquiry.
 *
 * Whether the model is any good at the judgement is measured live, against
 * real messages -- that is not something a unit test can tell you. What these
 * pin is that nothing it returns, however malformed, can throw on the way back
 * into the inbound path.
 */
describe("reading the classifier's answer", () => {
  it("takes a clean yes", () => {
    assert.deepEqual(
      signalsFromReply(
        '{"urgent": true, "trigger": "safety_risk", "quote": "there is a smell of gas in the hallway"}',
      ),
      [{ evidence: "there is a smell of gas in the hallway", trigger: "safety_risk" }],
    );
  });

  it("takes one wrapped in a code fence, which models do", () => {
    assert.deepEqual(
      signalsFromReply(
        '```json\n{"urgent": true, "trigger": "active_property_damage", "quote": "water is coming through the ceiling"}\n```',
      ),
      [{ evidence: "water is coming through the ceiling", trigger: "active_property_damage" }],
    );
  });

  it("says nothing for an ordinary enquiry", () => {
    assert.deepEqual(
      signalsFromReply('{"urgent": false, "trigger": "explicit_urgency", "quote": ""}'),
      [],
    );
  });

  it("says nothing rather than throwing on anything malformed", () => {
    // A classifier having a bad day must cost at most a missed escalation --
    // never the enquiry, which is already in the inbound path by this point.
    for (const reply of [
      "",
      "   ",
      "I think this one is urgent, actually",
      "{",
      "null",
      "[]",
      '{"urgent": "yes"}',
      '{"urgent": true}',
      '{"urgent": true, "trigger": "safety_risk"}',
      '{"urgent": true, "quote": "a smell of gas"}',
      '{"urgent": true, "trigger": null, "quote": null}',
    ]) {
      assert.deepEqual(signalsFromReply(reply), [], JSON.stringify(reply));
    }
  });

  it("returns nothing when there is no key or no message", async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    assert.deepEqual(await classifyEmergency("water everywhere"), []);

    if (key) {
      process.env.OPENAI_API_KEY = key;
    }

    assert.deepEqual(await classifyEmergency("   "), []);
  });
});

describe("and the evidence check still applies to it", () => {
  // The classifier is trusted no further than the triage field was. Its quote
  // is checked against the customer's real message, so a confident model that
  // invents an emergency still raises nothing.
  const message = "Could you quote for a new vanity unit when you get a chance?";

  it("refuses a quote the customer never wrote", () => {
    const signals = signalsFromReply(
      '{"urgent": true, "trigger": "active_property_damage", "quote": "water is pouring through the ceiling"}',
    );

    assert.equal(signals.length, 1);
    assert.deepEqual(acceptModelSignals(signals, message).accepted, []);
  });

  it("accepts one the customer did write", () => {
    const real = "There is a smell of gas in the hallway and we have opened the windows.";
    const signals = signalsFromReply(
      '{"urgent": true, "trigger": "safety_risk", "quote": "a smell of gas in the hallway"}',
    );

    assert.deepEqual(acceptModelSignals(signals, real).accepted, ["safety_risk"]);
  });
});
