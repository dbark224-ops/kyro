import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyInboundEmailHeuristically,
  classificationForSenderRule,
  inboundEmailIdempotencyKey,
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

describe("classifyInboundEmailHeuristically", () => {
  it("promotes clear trade enquiries even without exact quote wording", () => {
    const classification = classifyInboundEmailHeuristically({
      automated: false,
      bodyText:
        "Hi, my sewerage is backed up. Could someone come out and check it?",
      fromEmail: "customer@example.com",
      snippet: null,
      subject: "Sewerage backup",
    });

    assert.equal(classification.category, "business_actionable");
    assert.equal(classification.promote, true);
    assert.equal(classification.providerUsed, "heuristic");
  });

  it("promotes renovation and bathroom quote language", () => {
    const classification = classifyInboundEmailHeuristically({
      automated: false,
      bodyText:
        "I am looking at renovating my bathroom and would love someone to come and quote.",
      fromEmail: "customer@example.com",
      snippet: null,
      subject: "Bathroom renovation",
    });

    assert.equal(classification.category, "business_actionable");
    assert.equal(classification.promote, true);
  });

  it("keeps newsletter and automated mail out of the CRM queue", () => {
    const classification = classifyInboundEmailHeuristically({
      automated: false,
      bodyText: "This week's offers. Click unsubscribe to stop receiving these.",
      fromEmail: "marketing@example.com",
      snippet: "Weekly offers",
      subject: "Newsletter",
    });

    assert.equal(classification.category, "newsletter_or_automated");
    assert.equal(classification.promote, false);
  });

  it("keeps casual personal mail out of the CRM queue", () => {
    const classification = classifyInboundEmailHeuristically({
      automated: false,
      bodyText: "Haha that weekend dinner was a good one.",
      fromEmail: "mate@example.com",
      snippet: null,
      subject: "Weekend",
    });

    assert.equal(classification.category, "personal_ignore");
    assert.equal(classification.promote, false);
  });

  it("keeps neutral low-signal mail as awareness only", () => {
    const classification = classifyInboundEmailHeuristically({
      automated: false,
      bodyText: "Just confirming I saw this.",
      fromEmail: "person@example.com",
      snippet: null,
      subject: "Thanks",
    });

    assert.equal(classification.category, "business_reference");
    assert.equal(classification.promote, false);
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

describe("inboundEmailIdempotencyKey", () => {
  it("scopes duplicate detection by provider, connection, and provider message id", () => {
    assert.equal(
      inboundEmailIdempotencyKey({
        connectionId: "connection-a",
        externalMessageId: "message-1",
        provider: "google",
      }),
      "email.inbound.google.connection-a.message-1",
    );
    assert.notEqual(
      inboundEmailIdempotencyKey({
        connectionId: "connection-a",
        externalMessageId: "message-1",
        provider: "google",
      }),
      inboundEmailIdempotencyKey({
        connectionId: "connection-b",
        externalMessageId: "message-1",
        provider: "google",
      }),
    );
  });
});
