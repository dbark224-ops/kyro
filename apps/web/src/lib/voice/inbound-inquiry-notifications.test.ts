import assert from "node:assert/strict";
import test from "node:test";
import { buildInboundInquiryNotificationBody } from "./inbound-inquiry-notifications";

test("labels promoted email inquiries as email notifications", () => {
  const body = buildInboundInquiryNotificationBody({
    channel: "email",
    contactName: "Jason",
    conversationId: "conversation-1",
    summary: "Landscaping quote requested for early next week.",
  });

  assert.match(body, /^New Kyro email inquiry from Jason\./);
  assert.match(body, /Kyro captured the inquiry for review\./);
  assert.match(body, /conversationId=conversation-1/);
});

test("labels inbound SMS notifications without phone-call wording", () => {
  const body = buildInboundInquiryNotificationBody({
    channel: "sms",
    contactName: "+15755550123",
    conversationId: null,
    summary: "Can someone quote a blocked drain today?",
  });

  assert.match(body, /^New Kyro SMS inquiry from \+15755550123\./);
  assert.doesNotMatch(body, /phone inquiry/);
});

test("keeps the existing phone booking outcome wording", () => {
  const body = buildInboundInquiryNotificationBody({
    channel: "phone",
    contactName: "David",
    conversationId: "conversation-2",
    eventLabel: "Tuesday at 10:00 AM",
    outcome: "booked",
    summary: "Bathroom quote requested.",
  });

  assert.match(body, /^New Kyro phone inquiry from David\./);
  assert.match(body, /Kyro booked Tuesday at 10:00 AM\./);
});
