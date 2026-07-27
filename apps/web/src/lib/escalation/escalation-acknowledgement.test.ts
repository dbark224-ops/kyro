import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * Replying to an urgent escalation has to stop it.
 *
 * Acknowledgement used to be reachable only through the token URL in the
 * message, so answering in writing -- the obvious response, and how every
 * other Kyro alert works -- left the incident open and the later steps still
 * fired. The owner could be phoned about something they had already handled.
 *
 * These assert the wiring, since the behaviour itself needs a live incident,
 * a delivered step and an inbound message to exercise end to end.
 */
const ESCALATION = "apps/web/src/lib/escalation/urgent-escalation.ts";
const INBOUND = "apps/web/src/lib/assistant/internal-messaging.ts";

describe("a reply acknowledges an escalation", () => {
  const escalation = readRepoFile(ESCALATION);
  const inbound = readRepoFile(INBOUND);

  it("exposes a path in that does not need the token", () => {
    assert.match(
      escalation,
      /export async function acknowledgeEscalationFromReply/,
    );
  });

  it("is called from the inbound message handler", () => {
    assert.match(inbound, /acknowledgeEscalationFromReply\(/);
  });

  it("only settles an incident that is still open", () => {
    // A second reply must not reopen or re-audit a settled incident.
    const fromReply = escalation.slice(
      escalation.indexOf("acknowledgeEscalationFromReply"),
    );

    assert.match(fromReply, /\.eq\("status", "open"\)/);
  });

  it("cancels the pending steps when it settles one", () => {
    assert.match(escalation, /settleAcknowledgedIncident/);
    assert.match(escalation, /\.update\(\{ status: "cancelled" \}\)/);
  });

  it("asks for a reply rather than leading with a link", () => {
    assert.match(escalation, /Reply here and I'll stop escalating this/);
  });

  it("tells the assistant, so the reply can say it stopped", () => {
    assert.match(inbound, /acknowledgementSnapshots/);
    assert.match(inbound, /remaining escalation steps were cancelled/i);
  });
});

describe("no escalation step reports success without sending", () => {
  const escalation = readRepoFile(ESCALATION);

  it("refuses a channel it cannot deliver", () => {
    // A false success is worse than a failure: a failure hands on to the next
    // step, while a step that claims delivery quietly ends the chain.
    assert.match(escalation, /has no delivery method, so nobody was contacted/);
  });

  it("does not treat the in-app notification as undeliverable", () => {
    // The step row is the notification. getNotificationSummary selects sent
    // app_notification steps on open incidents and renders them in the bell,
    // so recording the step as sent is what publishes it -- the missing
    // provider id is because the app is the provider.
    //
    // Making this channel throw took the bell's escalation notifications with
    // it, which is the regression this guards.
    assert.match(escalation, /step\.channel === "app_notification"/);
    assert.match(escalation, /sendAppNotificationStep\(\)/);

    const branch = escalation.slice(
      escalation.indexOf("function sendAppNotificationStep"),
    );

    assert.doesNotMatch(
      branch.slice(0, branch.indexOf("async function sendPhoneStep")),
      /throw new Error/,
    );
  });
});

describe("the notification bell reads the escalation steps", () => {
  it("selects exactly what the escalation step writes", () => {
    // These two have to agree: the query filters on channel and status, and
    // the sender is what sets them. They live in different modules, so a
    // change to either silently breaks the bell.
    const notifications = readRepoFile(
      "apps/web/src/lib/notifications/queries.ts",
    );

    assert.match(notifications, /\.eq\("channel", "app_notification"\)/);
    assert.match(notifications, /\.eq\("status", "sent"\)/);
    assert.match(readRepoFile(ESCALATION), /status: "sent"/);
  });
});
