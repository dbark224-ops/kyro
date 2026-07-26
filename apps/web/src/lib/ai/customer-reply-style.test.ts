import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerReplyConversationRules,
  isSmsLikeChannel,
} from "./customer-reply-style";
import {
  DEFAULT_REPLY_WRITING_SETTINGS,
  replyWritingPromptRules,
} from "../communication/settings";

function joined(rules: string[]) {
  return rules.join("\n").toLowerCase();
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

describe("customerReplyConversationRules", () => {
  it("asks an SMS to carry its own greeting and sign-off", () => {
    const rules = joined(customerReplyConversationRules({ channel: "sms" }));

    assert.match(rules, /addressing the customer/);
    assert.match(rules, /signing off as the business/);
  });

  it("tells an SMS that nothing is appended after it writes", () => {
    const rules = joined(customerReplyConversationRules({ channel: "sms" }));

    assert.match(rules, /nothing is appended to an sms/);
    assert.match(rules, /never a full email signature/);
  });

  it("keeps SMS self-contained even mid-conversation", () => {
    // Each text is read on its own, so the sign-off is not dropped just
    // because the thread is established.
    const rules = joined(
      customerReplyConversationRules({
        channel: "sms",
        isFirstCustomerTurn: false,
      }),
    );

    assert.match(rules, /signing off as the business/);
    assert.doesNotMatch(rules, /without restarting with a greeting/);
  });

  it("tells email not to sign off, because the system appends one", () => {
    const rules = joined(customerReplyConversationRules({ channel: "email" }));

    assert.match(rules, /do not write your own sign-off/);
    assert.match(rules, /appends the configured email signature/);
  });
});

describe("replyWritingPromptRules", () => {
  it("does not tell an SMS to rely on the saved email signature", () => {
    // The 2026-07-25 contradiction: this rule said "use the saved email
    // signature", the channel rule said "sign off yourself". The model obeyed
    // this one and wrote nothing, then the code appended the email signature.
    const emailRules = joined(
      replyWritingPromptRules(DEFAULT_REPLY_WRITING_SETTINGS, "email"),
    );
    const smsRules = joined(
      replyWritingPromptRules(DEFAULT_REPLY_WRITING_SETTINGS, "sms"),
    );

    assert.match(emailRules, /saved email signature/);
    assert.doesNotMatch(smsRules, /saved email signature/);
  });

  it("asks an SMS for both a greeting and a sign-off", () => {
    const rules = joined(
      replyWritingPromptRules(DEFAULT_REPLY_WRITING_SETTINGS, "sms"),
    );

    assert.match(rules, /short greeting/);
    assert.match(rules, /sign-off naming the business/);
  });

  it("agrees with the channel rules rather than contradicting them", () => {
    const combined = joined([
      ...replyWritingPromptRules(DEFAULT_REPLY_WRITING_SETTINGS, "sms"),
      ...customerReplyConversationRules({ channel: "sms" }),
    ]);

    // Exactly one instruction about what to do with a signature on SMS:
    // write your own. Nothing anywhere telling it to defer to a saved one.
    assert.doesNotMatch(combined, /saved email signature/);
    assert.doesNotMatch(combined, /duplicate the signature text/);
  });

  it("falls back to the configured sign-off when no channel is given", () => {
    const rules = joined(replyWritingPromptRules(DEFAULT_REPLY_WRITING_SETTINGS));

    assert.match(rules, /saved email signature/);
  });
});
