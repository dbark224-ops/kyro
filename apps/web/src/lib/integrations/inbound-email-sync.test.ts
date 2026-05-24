import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classificationForSenderRule,
  isRecoverableTokenAccessError,
} from "./inbound-email-sync";

describe("isRecoverableTokenAccessError", () => {
  it("treats encrypted OAuth token decrypt failures as reconnect-needed", () => {
    assert.equal(
      isRecoverableTokenAccessError("Unsupported state or unable to authenticate data"),
      true,
    );
    assert.equal(isRecoverableTokenAccessError("Invalid authentication tag"), true);
  });

  it("does not hide provider/API failures behind reconnect state", () => {
    assert.equal(isRecoverableTokenAccessError("Gmail API returned 429"), false);
    assert.equal(isRecoverableTokenAccessError("Unable to load email integrations"), false);
  });
});

describe("classificationForSenderRule", () => {
  it("promotes messages from senders the user marked relevant", () => {
    const classification = classificationForSenderRule(
      {
        action: "always_promote",
        match: "email",
        value: "client@example.com",
      },
      {
        bodyText: "Can you quote this job?",
        fromEmail: "client@example.com",
        snippet: null,
        subject: "Quote",
      },
    );

    assert.equal(classification.category, "business_actionable");
    assert.equal(classification.promote, true);
    assert.equal(classification.providerUsed, "sender_rule");
  });

  it("skips messages from senders the user always ignores", () => {
    const classification = classificationForSenderRule(
      {
        action: "always_ignore",
        match: "email",
        value: "noise@example.com",
      },
      {
        bodyText: "Weekly newsletter",
        fromEmail: "noise@example.com",
        snippet: null,
        subject: "Newsletter",
      },
    );

    assert.equal(classification.category, "personal_ignore");
    assert.equal(classification.promote, false);
    assert.equal(classification.providerUsed, "sender_rule");
  });
});
