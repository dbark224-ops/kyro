import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sendTwilioSmsMessage } from "./twilio";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_VOICE_NUMBER,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
};

afterEach(() => {
  globalThis.fetch = originalFetch;

  for (const [key, value] of Object.entries({
    TWILIO_ACCOUNT_SID: originalEnvironment.accountSid,
    TWILIO_AUTH_TOKEN: originalEnvironment.authToken,
    TWILIO_MESSAGING_SERVICE_SID: originalEnvironment.messagingServiceSid,
    TWILIO_VOICE_NUMBER: originalEnvironment.fromNumber,
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
