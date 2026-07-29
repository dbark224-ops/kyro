import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inboundInquiryAlertRules } from "../voice/inbound-inquiry-notifications";
import { readRepoFile } from "../testing/repo-files";

/**
 * One inquiry, two alerts, neither aware of the other.
 *
 * An urgent email raised an incident at 23:50:47 and the ordinary new-inquiry
 * alert went out eleven seconds later saying nothing about it. The owner
 * answered that alert twice, at 23:53 and 23:54 -- and was escalated at
 * anyway at 23:55:49, because acknowledgement only looked for escalation steps
 * already *sent*, and none had been. The incident stayed open until 00:10.
 *
 * So he answered before it escalated, and it escalated regardless. Left alone
 * that is an endless queue of alerts about work already dealt with.
 */
describe("replying settles an incident that has not texted yet", () => {
  const escalation = readRepoFile(
    "apps/web/src/lib/escalation/urgent-escalation.ts",
  );

  it("looks for open incidents rather than sent steps", () => {
    const fromReply = escalation.slice(
      escalation.indexOf(
        "export async function acknowledgeEscalationFromReply",
      ),
    );

    assert.match(fromReply, /from\("urgent_escalation_incidents"\)/);
    assert.match(fromReply, /\.eq\("status", "open"\)/);
  });

  it("no longer requires a step to have been delivered first", () => {
    // The old query filtered steps on status "sent", which is precisely the
    // condition that was false at the moment the owner replied.
    const fromReply = escalation.slice(
      escalation.indexOf(
        "export async function acknowledgeEscalationFromReply",
      ),
    );
    const query = fromReply.slice(0, fromReply.indexOf("const match"));

    assert.doesNotMatch(query, /\.eq\("status", "sent"\)/);
  });

  it("still matches the person by phone digits", () => {
    assert.match(escalation, /samePhoneNumber\(/);
  });

  it("still bounds how far back a reply can reach", () => {
    assert.match(escalation, /REPLY_ACKNOWLEDGEMENT_WINDOW_MS/);
  });
});

describe("the ordinary alert says an escalation is running", () => {
  const rules = inboundInquiryAlertRules().join("\n");

  it("tells the owner it is being chased", () => {
    assert.match(rules, /context\.escalationStarted is true/);
    assert.match(rules, /keep chasing until someone responds/);
  });

  it("tells him replying here is enough to stop it", () => {
    // Without this he has no reason to believe answering the ordinary alert
    // counted, which is what makes the second message feel like a system that
    // is not listening.
    assert.match(rules, /a reply to this message stops that/);
  });

  it("stays quiet about escalation when there is none", () => {
    assert.match(rules, /do not mention escalation at all/i);
  });

  it("is handed the fact rather than inferring it", () => {
    const notifications = readRepoFile(
      "apps/web/src/lib/voice/inbound-inquiry-notifications.ts",
    );

    assert.match(
      notifications,
      /escalationStarted: Boolean\(input\.escalationStarted\)/,
    );
  });

  it("is wired from where the escalation is actually raised", () => {
    const emailSync = readRepoFile(
      "apps/web/src/lib/integrations/inbound-email-sync.ts",
    );

    assert.match(
      emailSync,
      /const escalation = await createUrgentEscalationIncident/,
    );
    assert.match(
      emailSync,
      /escalationStarted: escalation\?\.created === true/,
    );
    assert.match(emailSync, /escalationStarted: promoted\.escalationStarted/);
  });
});
