import assert from "node:assert/strict";
import test from "node:test";
import { buildInboundInquiryNotificationBody } from "./inbound-inquiry-notifications";

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
  assert.match(
    body,
    /I recommend: Offer an early-next-week quote visit and ask Jason to confirm the address and preferred time\./,
  );
  assert.match(body, /Reply SEND IT and I'll send the prepared response\./);
  assert.match(body, /Call: \+15755550123/);
  assert.match(body, /\/open\/inbox\?conversationId=conversation-1/);
  assert.match(body, /conversationId=conversation-1/);
});

test("reports when Kyro already answered a known business fact", () => {
  const body = buildInboundInquiryNotificationBody({
    autoReplySent: true,
    channel: "email",
    contactName: "Jamie",
    contactPhone: null,
    conversationId: "conversation-auto-reply",
    missingInfo: [],
    preparedReplyAvailable: false,
    summary: "Asked for the public business phone number.",
  });

  assert.match(
    body,
    /Kyro answered this using the public business details saved in the workspace\./,
  );
  assert.doesNotMatch(body, /Reply SEND IT|help with the next step/i);
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
  assert.doesNotMatch(body, /Reply SEND IT|I recommend:/);
});

test("uses the model recommendation instead of generic missing-info advice", () => {
  const body = buildInboundInquiryNotificationBody({
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

  assert.match(
    body,
    /I recommend: Review the Stripe payout settings in the account portal\./,
  );
  assert.doesNotMatch(body, /job address|suitable day|callback number/i);
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

test("keeps the existing phone booking outcome wording", () => {
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
  assert.match(
    body,
    /I recommend: The booking is set for Tuesday at 10:00 AM\./,
  );
  assert.doesNotMatch(body, /Reply SEND IT/);
});
