import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { sendTwilioSmsMessage, twilioSmsDeliveryState } from "./twilio";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_VOICE_NUMBER,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  whatsappNumber: process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER,
  whatsappRecipient: process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT,
};

beforeEach(() => {
  delete process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER;
  delete process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT;
});

afterEach(() => {
  globalThis.fetch = originalFetch;

  for (const [key, value] of Object.entries({
    TWILIO_ACCOUNT_SID: originalEnvironment.accountSid,
    TWILIO_AUTH_TOKEN: originalEnvironment.authToken,
    TWILIO_MESSAGING_SERVICE_SID: originalEnvironment.messagingServiceSid,
    TWILIO_VOICE_NUMBER: originalEnvironment.fromNumber,
    TWILIO_WHATSAPP_SANDBOX_NUMBER: originalEnvironment.whatsappNumber,
    TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT:
      originalEnvironment.whatsappRecipient,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("pins the workspace sender while retaining its Messaging Service", async () => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
  process.env.TWILIO_VOICE_NUMBER = "+15550000000";

  globalThis.fetch = async (_input, init) => {
    const body = init?.body as URLSearchParams;

    assert.equal(body.get("MessagingServiceSid"), "MG_test");
    assert.equal(body.get("From"), "+15753835284");
    assert.equal(body.get("To"), "+15755712705");

    return new Response(
      JSON.stringify({
        account_sid: "AC_test",
        direction: "outbound-api",
        num_segments: "1",
        price: null,
        price_unit: "USD",
        sid: "SM_test",
        status: "queued",
      }),
      {
        headers: { "content-type": "application/json" },
        status: 201,
      },
    );
  };

  const result = await sendTwilioSmsMessage({
    body: "Test message",
    from: "+15753835284",
    to: "+15755712705",
  });

  assert.equal(result.messageId, "SM_test");
  assert.equal(result.transport, "sms");
});

test("routes only the configured test recipient through the WhatsApp Sandbox", async () => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
  process.env.TWILIO_VOICE_NUMBER = "+15550000000";
  process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER = "+14155238886";
  process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT = "+15755712705";

  globalThis.fetch = async (_input, init) => {
    const body = init?.body as URLSearchParams;

    assert.equal(body.get("To"), "whatsapp:+15755712705");
    assert.equal(body.get("From"), "whatsapp:+14155238886");
    assert.equal(body.has("MessagingServiceSid"), false);

    return new Response(
      JSON.stringify({
        account_sid: "AC_test",
        direction: "outbound-api",
        num_segments: "1",
        price: null,
        price_unit: "USD",
        sid: "SM_whatsapp",
        status: "queued",
      }),
      {
        headers: { "content-type": "application/json" },
        status: 201,
      },
    );
  };

  const result = await sendTwilioSmsMessage({
    body: "WhatsApp test",
    from: "+15753835284",
    to: "+15755712705",
  });

  assert.equal(result.messageId, "SM_whatsapp");
  assert.equal(result.transport, "whatsapp");
});

test("keeps other recipients on normal SMS while the Sandbox bridge is enabled", async () => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
  process.env.TWILIO_VOICE_NUMBER = "+15550000000";
  process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT = "+15755712705";

  globalThis.fetch = async (_input, init) => {
    const body = init?.body as URLSearchParams;

    assert.equal(body.get("To"), "+15551234567");
    assert.equal(body.get("From"), "+15753835284");
    assert.equal(body.get("MessagingServiceSid"), "MG_test");

    return new Response(
      JSON.stringify({
        account_sid: "AC_test",
        direction: "outbound-api",
        sid: "SM_sms",
        status: "queued",
      }),
      {
        headers: { "content-type": "application/json" },
        status: 201,
      },
    );
  };

  const result = await sendTwilioSmsMessage({
    body: "Normal SMS",
    from: "+15753835284",
    to: "+15551234567",
  });

  assert.equal(result.transport, "sms");
});

test("allows the Messaging Service to select a sender when none is requested", async () => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
  process.env.TWILIO_VOICE_NUMBER = "+15550000000";

  globalThis.fetch = async (_input, init) => {
    const body = init?.body as URLSearchParams;

    assert.equal(body.get("MessagingServiceSid"), "MG_test");
    assert.equal(body.has("From"), false);

    return new Response(
      JSON.stringify({
        account_sid: "AC_test",
        direction: "outbound-api",
        num_segments: "1",
        price: null,
        price_unit: "USD",
        sid: "SM_test",
        status: "accepted",
      }),
      {
        headers: { "content-type": "application/json" },
        status: 201,
      },
    );
  };

  await sendTwilioSmsMessage({
    body: "Test message",
    from: null,
    to: "+15755712705",
  });
});

test("treats an error-bearing queued callback as failed", () => {
  assert.deepEqual(
    twilioSmsDeliveryState({
      errorCode: "30034",
      status: "queued",
    }),
    {
      errorCode: "30034",
      failed: true,
      normalizedStatus: "queued",
      succeeded: false,
    },
  );
});

test("classifies clean delivery statuses without hiding failures", () => {
  assert.equal(twilioSmsDeliveryState({ status: "delivered" }).succeeded, true);
  assert.equal(twilioSmsDeliveryState({ status: "sent" }).succeeded, true);
  assert.equal(twilioSmsDeliveryState({ status: "queued" }).succeeded, false);
  assert.equal(twilioSmsDeliveryState({ status: "undelivered" }).failed, true);
});
