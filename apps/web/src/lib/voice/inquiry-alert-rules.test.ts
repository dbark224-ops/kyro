import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inboundInquiryAlertRules } from "./inbound-inquiry-notifications";

/**
 * Two behaviours the owner asked for, asserted on the rules rather than on a
 * model's output so they cannot drift back silently.
 *
 * The alert used to announce that a reply was drafted without saying what it
 * said -- approving it meant approving something unread. And it told the owner
 * to "reply SEND IT", which is not how approval works: the reply is read by the
 * assistant and any clear yes is enough, so naming one phrase was restrictive
 * and untrue at the same time.
 */
describe("the new-inquiry alert rules", () => {
  const rules = inboundInquiryAlertRules().join("\n");

  it("asks the model to convey what the drafted reply says", () => {
    assert.match(rules, /preparedReplyDraft/);
    assert.match(rules, /what that reply would tell the customer/i);
  });

  it("asks for the gist, not the wording", () => {
    assert.match(rules, /gist, not the wording/i);
  });

  it("prescribes no magic approval phrase", () => {
    assert.doesNotMatch(
      rules,
      /SEND IT/i,
      "any clear yes approves the draft; naming one phrase is untrue",
    );
    assert.match(rules, /confirm however they like/i);
    assert.match(rules, /Do not instruct them to send a specific phrase/i);
  });

  it("still keeps the alert inside a two-segment SMS budget", () => {
    // 153 x 2 -- see smsCharacterBudget. A number here rather than a vague
    // "keep it short" so the model has something to actually aim at.
    assert.match(rules, /under 306 characters/);
  });

  it("leaves the summarising judgement to the model", () => {
    // The same latitude it has on the customer's message: quote when the
    // wording matters, summarise when it does not.
    assert.match(rules, /Quote the customer only when their wording matters/i);
  });
});

describe("the channel is stated, not inferred", () => {
  const rules = inboundInquiryAlertRules().join("\n");

  it("names arrivedVia as the only source for the channel", () => {
    // An email whose signature carried a phone number was announced as "SMS
    // from Rachel Nunez". contactPhone sits next to arrivedVia in the facts,
    // and a phone number reads like a text message.
    assert.match(rules, /channel is exactly context\.arrivedVia/i);
  });

  it("rules out inferring it from a phone number", () => {
    assert.match(rules, /never infer it from whether a phone number is present/i);
    assert.match(rules, /never call an email an SMS/i);
  });
});
