import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * Record what happened, so the next question is a query and not an autopsy.
 *
 * Two things went unrecorded and both cost real time on 29 Jul 2026.
 *
 * Whether an alert was written by the model or by the code fallback was
 * invisible once sent. The escalation writer went its entire life without
 * running and nobody noticed; a truncated fallback went out reading like
 * something Kyro had composed. Telling them apart meant lining up ai_runs
 * timestamps against outbound_messages by hand.
 *
 * And how an incident was acknowledged lived only in audit_logs, so "does
 * replying actually stop the chain" got answered with a guess -- twice, wrongly
 * -- when the evidence was one join away. It works, incidentally: an incident
 * was acknowledged via reply on 29 Jul at 19:16.
 */
const escalation = readRepoFile(
  "apps/web/src/lib/escalation/urgent-escalation.ts",
);
const notifications = readRepoFile(
  "apps/web/src/lib/voice/inbound-inquiry-notifications.ts",
);

describe("an incident says how it was settled", () => {
  it("writes the source onto the incident, not only the audit log", () => {
    const settle = escalation.slice(
      escalation.indexOf("async function settleAcknowledgedIncident"),
      escalation.indexOf("export async function acknowledgeUrgentEscalation"),
    );

    assert.match(settle, /acknowledgedVia: input\.source/);
    assert.match(settle, /from\("urgent_escalation_incidents"\)/);
  });

  it("merges rather than replacing the existing metadata", () => {
    // contactId, conversationId and leadId live in the same object.
    const settle = escalation.slice(
      escalation.indexOf("async function settleAcknowledgedIncident"),
      escalation.indexOf("export async function acknowledgeUrgentEscalation"),
    );

    assert.match(settle, /\.\.\.objectRecord\(incident\.metadata\)/);
  });

  it("loads the metadata it is about to merge into", () => {
    // Both acknowledgement routes feed the same function, so both selects have
    // to carry it or one of them silently drops the other fields.
    const selects = [
      ...escalation.matchAll(/\.select\("id,workspace_id,title[^"]*"\)/g),
    ].map((match) => match[0]);

    assert.ok(selects.length >= 2, "both acknowledgement paths should select");

    for (const select of selects) {
      assert.match(select, /metadata/, select);
    }
  });

  it("still keeps the audit log entry", () => {
    assert.match(escalation, /action: "urgent_escalation\.acknowledged"/);
  });
});

describe("an alert says who wrote it", () => {
  it("distinguishes the model, the fallback and a person", () => {
    for (const value of ["person", "model", "fallback"]) {
      assert.ok(
        escalation.includes(`generatedBy: "${value}" as const`),
        `escalation should report generatedBy ${value}`,
      );
    }
  });

  it("records the reason the model was not used", () => {
    assert.match(escalation, /generationError:/);
    assert.match(escalation, /alertGenerationError: written\.generationError/);
  });

  it("stores it on the incident", () => {
    assert.match(escalation, /alertGeneratedBy: written\.generatedBy/);
  });

  it("does the same for the inquiry alert", () => {
    assert.ok(notifications.includes('generatedBy: "model" as const'));
    assert.ok(notifications.includes('generatedBy: "fallback" as const'));
    assert.match(notifications, /generatedBy: written\.generatedBy/);
  });

  it("records how many messages the alert became", () => {
    // Segment behaviour has now caused two separate defects, and neither was
    // visible without counting the rows by hand.
    assert.match(notifications, /messageParts: parts\.length/);
  });

  it("keeps recording the transport actually used", () => {
    assert.match(notifications, /transport,/);
  });
});
