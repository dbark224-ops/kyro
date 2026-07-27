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
    assert.match(escalation, /export async function acknowledgeEscalationFromReply/);
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
  it("refuses a channel it cannot deliver", () => {
    // app_notification used to fall through to a null result and then be
    // recorded as "sent" -- a step that contacted nobody and reported success,
    // which quietly ended the chain instead of handing on like a failure does.
    const escalation = readRepoFile(ESCALATION);

    assert.match(escalation, /has no delivery method, so nobody was contacted/);
  });
});
