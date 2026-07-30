import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inquiryFactsWithVerifiedAvailability } from "./triage";
import { buildInboundInquiryNotificationBody } from "../voice/inbound-inquiry-notifications";
import { readRepoFile } from "../testing/repo-files";

/**
 * Kyro's answer must not become Kyro's next question.
 *
 * An urgent ceiling leak was offered "Aug 3, 7 AM" -- five days out -- while
 * Thursday and Friday sat completely empty and both are working days. The slot
 * finder was innocent: asked directly for a wide window it returns Jul 30,
 * 7:00 AM.
 *
 * The fault was that inquiryFactsWithVerifiedAvailability overwrote
 * preferredTime with the slot label, so one field meant "what the customer
 * asked for" before the calendar lookup and "what Kyro decided to offer"
 * afterwards. That value is persisted, handed back on a regenerate as
 * inquiryFactsOverride, and parsed as the requested window --
 * calendarDateRangeFromPrompts("Aug 3, 2026, 7:00 AM") resolves to a range
 * covering only 3 August. The window collapsed to one day and the date walked
 * forward.
 *
 * It also made every screen wrong. The assistant console labels this field
 * "Preferred", and it was showing a time the customer never mentioned.
 */
function facts(preferredTime: string | null, missingInfo: string[] = []) {
  return {
    address: null,
    budget: null,
    fit: "likely_fit" as const,
    jobType: null,
    missingInfo,
    preferredTime,
    urgency: "urgent" as const,
  };
}

const slot = {
  endsAt: "2026-07-30T14:00:00.000Z",
  label: "Jul 30, 2026, 7:00 AM",
  startsAt: "2026-07-30T13:00:00.000Z",
  timeZone: "America/Denver",
};

describe("a verified slot fills the gap without rewriting the ask", () => {
  it("leaves the customer's own words alone", () => {
    const result = inquiryFactsWithVerifiedAvailability(
      facts("Saturday morning if possible"),
      slot,
    );

    assert.equal(result.preferredTime, "Saturday morning if possible");
  });

  it("does not invent a preference where the customer gave none", () => {
    const result = inquiryFactsWithVerifiedAvailability(facts(null), slot);

    assert.equal(result.preferredTime, null);
  });

  it("still closes the timing gap in missingInfo", () => {
    // The slot is verified, so the owner is not still waiting on a time.
    const result = inquiryFactsWithVerifiedAvailability(
      facts(null, ["Preferred time", "Job address"]),
      slot,
    );

    assert.deepEqual(result.missingInfo, ["Job address"]);
  });

  it("never round-trips a slot label back into the field", () => {
    // The loop in one assertion: feed the previous answer in, and it must not
    // come back out as the customer's request.
    const once = inquiryFactsWithVerifiedAvailability(facts("today"), slot);
    const twice = inquiryFactsWithVerifiedAvailability(once, slot);

    assert.equal(twice.preferredTime, "today");
    assert.notEqual(twice.preferredTime, slot.label);
  });
});

describe("the alert keeps the two apart", () => {
  it("labels the offer as ours and the request as theirs", () => {
    const body = buildInboundInquiryNotificationBody({
      channel: "email",
      contactName: "Zoé",
      offeredTime: "Jul 30, 2026, 7:00 AM",
      preferredTime: "as soon as possible",
      summary: "Upstairs shower leaking through the ceiling.",
    });

    assert.match(body, /We can do: Jul 30, 2026, 7:00 AM/);
    assert.match(body, /They asked for: as soon as possible/);
  });

  it("does not repeat itself when they are the same", () => {
    const body = buildInboundInquiryNotificationBody({
      channel: "email",
      contactName: "Zoé",
      offeredTime: "Jul 30, 2026, 7:00 AM",
      preferredTime: "Jul 30, 2026, 7:00 AM",
      summary: "Upstairs shower leaking through the ceiling.",
    });

    assert.match(body, /We can do:/);
    assert.doesNotMatch(body, /They asked for:/);
  });

  it("copes when only one of them is known", () => {
    const offerOnly = buildInboundInquiryNotificationBody({
      channel: "email",
      offeredTime: "Jul 30, 2026, 7:00 AM",
      summary: "Leak.",
    });
    const askOnly = buildInboundInquiryNotificationBody({
      channel: "email",
      preferredTime: "Saturday",
      summary: "Leak.",
    });

    assert.match(offerOnly, /We can do:/);
    assert.doesNotMatch(offerOnly, /They asked for:/);
    assert.match(askOnly, /They asked for: Saturday/);
    assert.doesNotMatch(askOnly, /We can do:/);
  });
});

describe("the offer reaches the alert without the overwrite", () => {
  it("is returned by triage as a distinct value", () => {
    const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");
    const returned = triage.slice(triage.lastIndexOf("    replyDraft: triageDecision.replyDraft,"));

    assert.match(returned, /verifiedAvailability,/);
  });

  it("is carried through the email sync to the notification", () => {
    const sync = readRepoFile(
      "apps/web/src/lib/integrations/inbound-email-sync.ts",
    );

    assert.match(
      sync,
      /offeredTime: triageResult\.verifiedAvailability\?\.label \?\? null/,
    );
    assert.match(sync, /offeredTime: promoted\.offeredTime/);
  });

  it("tells the writer which is which", () => {
    const notifications = readRepoFile(
      "apps/web/src/lib/voice/inbound-inquiry-notifications.ts",
    );

    assert.match(notifications, /offeredTimeKyroChecked/);
    assert.match(notifications, /preferredTimeCustomerAsked/);
    assert.match(
      notifications,
      /Never present the offered slot as something the customer requested/,
    );
  });
});
