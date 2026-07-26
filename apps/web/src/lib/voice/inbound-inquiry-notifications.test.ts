import assert from "node:assert/strict";
import test from "node:test";
import { buildInboundInquiryNotificationBody } from "./inbound-inquiry-notifications";

/**
 * These cover the last-resort body, used only when the model could not be
 * reached. Its job is to state what is known and stop -- it no longer offers
 * advice, because recommending is the model's call and this file is in no
 * position to make it.
 */

test("labels promoted email inquiries as email notifications", () => {
  const body = buildInboundInquiryNotificationBody({
    channel: "email",
    contactName: "Jason",
    contactPhone: "+15755550123",
    conversationId: "conversation-1",
    missingInfo: ["Job address", "Preferred time"],
    preferredTime: null,
    preparedReplyAvailable: true,
    recommendedAction:
      "Offer an early-next-week quote visit and ask Jason to confirm the address and preferred time.",
    summary: "Landscaping quote requested for early next week.",
  });

  assert.match(body, /^New email inquiry - Jason/);
  assert.match(body, /Summary: Landscaping quote requested/);
  assert.match(body, /Call: \+15755550123/);
  assert.match(body, /\/open\/inbox\?conversationId=conversation-1/);
});

test("passes through a model recommendation but never invents one", () => {
  const withRecommendation = buildInboundInquiryNotificationBody({
    channel: "email",
    contactName: "Kyro",
    contactPhone: null,
    conversationId: "conversation-account-notice",
    missingInfo: ["Job address", "Preferred time", "Phone number"],
    preferredTime: null,
    preparedReplyAvailable: false,
    recommendedAction:
      "Review the Stripe payout settings in the account portal.",
    summary: "Stripe requested updated payout information.",
  });
  const withoutRecommendation = buildInboundInquiryNotificationBody({
    channel: "email",
    contactName: "Kyro",
    contactPhone: null,
    conversationId: "conversation-account-notice",
    missingInfo: ["Job address"],
    preferredTime: null,
    preparedReplyAvailable: false,
    summary: "Stripe requested updated payout information.",
  });

  assert.match(
    withRecommendation,
    /Recommended: Review the Stripe payout settings in the account portal\./,
  );
  // With nothing from the model, the fallback states the gap and stops rather
  // than reaching for "follow up while the inquiry is fresh".
  assert.doesNotMatch(withoutRecommendation, /Recommended:/);
  assert.match(withoutRecommendation, /Still needed: the job address/i);
  assert.doesNotMatch(withoutRecommendation, /while the inquiry is fresh/i);
});

test("asks the owner one focused question when the customer answer is unavailable", () => {
  const body = buildInboundInquiryNotificationBody({
    channel: "email",
    contactName: "Jamie",
    contactPhone: "+15755550123",
    conversationId: "conversation-owner-question",
    missingInfo: [],
    ownerQuestion:
      "Should I tell Jamie the team can leave the side gate unlocked?",
    preparedReplyAvailable: true,
    summary: "Jamie asked about the team's access procedure.",
  });

  assert.match(body, /^New email inquiry - Jamie/);
  assert.match(
    body,
    /I need from you: Should I tell Jamie the team can leave the side gate unlocked\?/,
  );
  assert.match(
    body,
    /Reply here with the answer and I'll finish the customer response\./,
  );
});

test("labels inbound SMS notifications without phone-call wording", () => {
  const body = buildInboundInquiryNotificationBody({
    channel: "sms",
    contactName: "+15755550123",
    contactPhone: "+15755550123",
    conversationId: null,
    missingInfo: [],
    preferredTime: null,
    preparedReplyAvailable: false,
    summary: "Can someone quote a blocked drain today?",
  });

  assert.match(body, /^New SMS inquiry - \+15755550123/);
  assert.doesNotMatch(body, /phone inquiry/);
  assert.match(body, /Open in Kyro: .*\/open\/inbox/);
});

test("states a booking as a fact rather than as advice", () => {
  const body = buildInboundInquiryNotificationBody({
    channel: "phone",
    contactName: "David",
    contactPhone: null,
    conversationId: "conversation-2",
    eventLabel: "Tuesday at 10:00 AM",
    missingInfo: [],
    outcome: "booked",
    preferredTime: "Tuesday at 10:00 AM",
    preparedReplyAvailable: false,
    summary: "Bathroom quote requested.",
  });

  assert.match(body, /^New phone inquiry - David/);
  assert.match(body, /Booked: Tuesday at 10:00 AM/);
  assert.doesNotMatch(body, /I recommend:/);
});

test("offers no advice of its own anywhere", () => {
  // The five sentences this builder used to choose between.
  const bannedAdvice = [
    "Review the prepared response and follow up while the inquiry is fresh",
    "Reply SEND IT and I'll send the prepared response",
    "Reply here if you want me to help with the next step",
    "Kyro answered this using the public business details saved in the workspace",
    "Review the proposed",
  ];
  const bodies = [
    buildInboundInquiryNotificationBody({
      autoReplySent: true,
      channel: "email",
      contactName: "Jamie",
      contactPhone: null,
      conversationId: "conversation-auto-reply",
      missingInfo: [],
      preparedReplyAvailable: false,
      summary: "Asked for the public business phone number.",
    }),
    buildInboundInquiryNotificationBody({
      channel: "phone",
      contactName: "David",
      contactPhone: null,
      conversationId: "conversation-3",
      missingInfo: [],
      outcome: "proposed",
      preparedReplyAvailable: true,
      summary: "Bathroom quote requested.",
    }),
  ];

  for (const body of bodies) {
    for (const advice of bannedAdvice) {
      assert.ok(
        !body.includes(advice),
        `fallback should not offer advice, found: ${advice}`,
      );
    }
  }
});
