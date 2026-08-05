import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEmergency, signalsFromReply } from "./emergency-classifier";
import { acceptModelSignals } from "./model-signals";

/**
 * The parsing, and the promise that this can never cost an enquiry.
 *
 * Whether the model is any good at either judgement is measured live, against
 * real messages -- that is not something a unit test can tell you. What these
 * pin is that nothing it returns, however malformed, can throw on the way back
 * into the inbound path.
 */
describe("reading the classifier's answer", () => {
  it("takes a clean yes", () => {
    assert.deepEqual(
      signalsFromReply(
        '{"urgent": true, "trigger": "safety_risk", "quote": "there is a smell of gas in the hallway", "trade": "Electrical - Fault Finding"}',
      ),
      {
        signals: [
          {
            evidence: "there is a smell of gas in the hallway",
            trigger: "safety_risk",
          },
        ],
        trade: "Electrical - Fault Finding",
      },
    );
  });

  it("takes one wrapped in a code fence, which models do", () => {
    assert.deepEqual(
      signalsFromReply(
        '```json\n{"urgent": true, "trigger": "active_property_damage", "quote": "water is coming through the ceiling", "trade": "Plumbing"}\n```',
      ).signals,
      [
        {
          evidence: "water is coming through the ceiling",
          trigger: "active_property_damage",
        },
      ],
    );
  });

  it("raises nothing for an ordinary enquiry but still learns the trade", () => {
    // The point of carrying the trade here. Most enquiries are ordinary, and
    // those are exactly the ones whose kind of work was going unrecorded.
    const result = signalsFromReply(
      '{"urgent": false, "trigger": "explicit_urgency", "quote": "", "trade": "Bathroom Renovation"}',
    );

    assert.deepEqual(result.signals, []);
    assert.equal(result.trade, "Bathroom Renovation");
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
      assert.deepEqual(signalsFromReply(reply).signals, [], JSON.stringify(reply));
    }
  });

  it("returns nothing when there is no key or no message", async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    assert.deepEqual((await classifyEmergency("water everywhere")).signals, []);

    if (key) {
      process.env.OPENAI_API_KEY = key;
    }

    assert.deepEqual((await classifyEmergency("   ")).signals, []);
  });
});

describe("the trade, which has been wrong twice already", () => {
  const tradeFor = (trade: unknown) =>
    signalsFromReply(
      `{"urgent": false, "trigger": "explicit_urgency", "quote": "", "trade": ${JSON.stringify(trade)}}`,
    ).trade;

  it("refuses the channel the message arrived on", () => {
    // The exact fault being fixed: inbound SMS wrote "SMS" into the field
    // meant for the kind of work, so all 97 text enquiries were filed under
    // their transport. A model repeating that mistake is not humoured.
    for (const channel of ["SMS", "sms", "Text", "WhatsApp", "Email", "phone", "Voice"]) {
      assert.equal(tradeFor(channel), null, channel);
    }
  });

  it("refuses a whole sentence dressed up as a trade", () => {
    assert.equal(
      tradeFor(
        "The customer has a dripping mixer tap in the kitchen that needs replacing soon",
      ),
      null,
    );
  });

  it("keeps a trade as a tradesperson would write it", () => {
    for (const trade of [
      "Plumbing",
      "Plumbing - Tap Repair",
      "Bathroom Renovation",
      "Hot Water System Replacement",
      "Electrical - Fault Finding",
    ]) {
      assert.equal(tradeFor(trade), trade);
    }
  });

  it("accepts that some messages are not jobs", () => {
    for (const value of [null, "", "   "]) {
      assert.equal(tradeFor(value), null, JSON.stringify(value));
    }
  });
});

describe("and the evidence check still applies to it", () => {
  // The classifier is trusted no further than the triage field was. Its quote
  // is checked against the customer's real message, so a confident model that
  // invents an emergency still raises nothing.
  const message = "Could you quote for a new vanity unit when you get a chance?";

  it("refuses a quote the customer never wrote", () => {
    const { signals } = signalsFromReply(
      '{"urgent": true, "trigger": "active_property_damage", "quote": "water is pouring through the ceiling", "trade": "Plumbing"}',
    );

    assert.equal(signals.length, 1);
    assert.deepEqual(acceptModelSignals(signals, message).accepted, []);
  });

  it("accepts one the customer did write", () => {
    const real = "There is a smell of gas in the hallway and we have opened the windows.";
    const { signals } = signalsFromReply(
      '{"urgent": true, "trigger": "safety_risk", "quote": "a smell of gas in the hallway", "trade": "Electrical - Fault Finding"}',
    );

    assert.deepEqual(acceptModelSignals(signals, real).accepted, ["safety_risk"]);
  });
});
