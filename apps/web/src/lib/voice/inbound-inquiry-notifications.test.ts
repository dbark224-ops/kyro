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
    summary: "Landscaping quote requested for early next week.",
  });

  assert.match(body, /^New email inquiry - Jason/);
  assert.match(
    body,
    /I recommend: Ask for the job address and a suitable day and time\./,
  );
  assert.match(body, /Reply SEND IT and I'll send the prepared response\./);
  assert.match(body, /Call: \+15755550123/);
  assert.match(body, /\/open\/inbox\?conversationId=conversation-1/);
  assert.match(body, /conversationId=conversation-1/);
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
