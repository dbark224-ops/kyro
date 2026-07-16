import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectUrgentEscalationTriggers } from "./urgent-escalation";

describe("urgent escalation trigger detection", () => {
  it("detects explicit emergencies and active property damage", () => {
    const triggers = detectUrgentEscalationTriggers(
      {
        content:
          "This is urgent, a burst pipe is flooding the kitchen right now.",
        sourceKey: "email:test-1",
        sourceType: "email",
      },
      { afterHours: false },
    );

    assert.ok(triggers.includes("explicit_urgency"));
    assert.ok(triggers.includes("active_property_damage"));
  });

  it("adds the after-hours trigger only outside business hours", () => {
    const input = {
      content: "We have no hot water and need an emergency callout.",
      sourceKey: "sms:test-2",
      sourceType: "sms" as const,
    };

    assert.ok(
      detectUrgentEscalationTriggers(input, { afterHours: true }).includes(
        "after_hours_emergency",
      ),
    );
    assert.equal(
      detectUrgentEscalationTriggers(input, { afterHours: false }).includes(
        "after_hours_emergency",
      ),
      false,
    );
  });

  it("does not treat an ordinary request as an urgent escalation", () => {
    assert.deepEqual(
      detectUrgentEscalationTriggers(
        {
          content: "Could you quote a bathroom renovation next month?",
          sourceKey: "manual:test-3",
          sourceType: "manual",
        },
        { afterHours: false },
      ),
      ["high_value_lead"],
    );
  });

  it("uses known-customer context for missed-call and job-failure triggers", () => {
    const triggers = detectUrgentEscalationTriggers(
      {
        content: "The repair from your previous job has failed again.",
        existingCustomer: true,
        metadata: { missedOrVoicemail: true },
        sourceKey: "voice:test-4",
        sourceType: "voice_call",
      },
      { afterHours: false },
    );

    assert.ok(triggers.includes("existing_job_serious_issue"));
    assert.ok(triggers.includes("missed_known_customer_call"));
  });
});
