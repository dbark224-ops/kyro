import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerReplyConversationRules,
  firstCustomerTurnFromCount,
  firstCustomerTurnFromThread,
  isSmsLikeChannel,
} from "./customer-reply-style";
import {
  DEFAULT_REPLY_WRITING_SETTINGS,
  replyWritingPromptRules,
} from "../communication/settings";

function joined(rules: string[]) {
  return rules.join("\n").toLowerCase();
}

function smsRules(isFirstCustomerTurn?: boolean) {
  return joined([
    ...replyWritingPromptRules(
      DEFAULT_REPLY_WRITING_SETTINGS,
      "sms",
      isFirstCustomerTurn,
    ),
    ...customerReplyConversationRules({
      channel: "sms",
      isFirstCustomerTurn,
    }),
  ]);
}

describe("isSmsLikeChannel", () => {
  it("covers the text-message channels and nothing else", () => {
    assert.equal(isSmsLikeChannel("sms"), true);
    assert.equal(isSmsLikeChannel("SMS"), true);
    assert.equal(isSmsLikeChannel(" whatsapp "), true);
    assert.equal(isSmsLikeChannel("email"), false);
    assert.equal(isSmsLikeChannel(null), false);
    assert.equal(isSmsLikeChannel(undefined), false);
  });
});

describe("first customer turn detection", () => {
  it("reads a first turn from a thread count", () => {
    assert.equal(firstCustomerTurnFromCount(1), true);
    assert.equal(firstCustomerTurnFromCount(0), true);
    assert.equal(firstCustomerTurnFromCount(4), false);
  });

  it("stays undecided rather than guessing first contact", () => {
    // Defaulting to `true` would re-introduce the business mid-thread every
    // time the count was missing.
    assert.equal(firstCustomerTurnFromCount(undefined), undefined);
    assert.equal(firstCustomerTurnFromCount(null), undefined);
    assert.equal(firstCustomerTurnFromThread(undefined), undefined);
    assert.equal(firstCustomerTurnFromThread([]), undefined);
    assert.equal(firstCustomerTurnFromThread([{}]), true);
    assert.equal(firstCustomerTurnFromThread([{}, {}]), false);
  });
});

describe("SMS reply rules", () => {
  it("identifies the business on the first text from an unknown number", () => {
    const rules = smsRules(true);

    assert.match(rules, /first text/);
    assert.match(rules, /sign-off naming the business/);
    assert.match(rules, /nothing is appended to an sms/);
  });

  it("drops the greeting and sign-off once the thread is underway", () => {
    // The customer already knows who they are texting. Re-greeting and
    // re-signing every message in a live back-and-forth reads like a robot.
    const rules = smsRules(false);

    assert.match(rules, /already underway|established text thread/);
    assert.match(rules, /no greeting, no sign-off|no repeated sign-off/);
    assert.doesNotMatch(rules, /must say who it is/);
  });

  it("asks the model to judge it when the thread position is unknown", () => {
    const rules = smsRules(undefined);

    assert.match(rules, /if this is a first contact|infer whether/);
    assert.doesNotMatch(rules, /must say who it is/);
  });

  it("never lets an SMS lean on the saved email signature", () => {
    // The 2026-07-25 contradiction: the writing-style rule said "use the saved
    // email signature", the channel rule said "sign off yourself". The model
    // obeyed the first and wrote nothing, then the code appended the email
    // signature, logo and all.
    for (const turn of [true, false, undefined]) {
      const rules = smsRules(turn);

      assert.doesNotMatch(rules, /saved email signature/);
      assert.doesNotMatch(rules, /duplicate the signature text/);
    }
  });

  it("bans the email signature furniture whatever the thread position", () => {
    for (const turn of [true, false, undefined]) {
      assert.match(
        smsRules(turn),
        /never a full email signature, job title, phone number, address, or logo/,
      );
    }
  });
});

describe("email reply rules", () => {
  it("keeps deferring to the configured signature", () => {
    const rules = joined([
      ...replyWritingPromptRules(DEFAULT_REPLY_WRITING_SETTINGS, "email", true),
      ...customerReplyConversationRules({
        channel: "email",
        isFirstCustomerTurn: true,
      }),
    ]);

    assert.match(rules, /saved email signature/);
    assert.match(rules, /do not write your own sign-off/);
  });

  it("still varies by thread position the way it always did", () => {
    assert.match(
      joined(
        customerReplyConversationRules({
          channel: "email",
          isFirstCustomerTurn: false,
        }),
      ),
      /without restarting with a greeting/,
    );
  });

  it("falls back to the configured sign-off when no channel is given", () => {
    assert.match(
      joined(replyWritingPromptRules(DEFAULT_REPLY_WRITING_SETTINGS)),
      /saved email signature/,
    );
  });
});
