import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  sendTwilioSmsMessage,
  telephonyUsageCost,
  twilioMessageTransportForWorkspace,
  twilioSmsDeliveryState,
} from "./twilio";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_VOICE_NUMBER,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  whatsappNumber: process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER,
  whatsappRecipient: process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT,
  whatsappWorkspace: process.env.TWILIO_WHATSAPP_SANDBOX_WORKSPACE_ID,
};

// The pricing tests below set these, and a leaked unit cost would quietly
// change what a later test measures.
const PRICING_KEYS = [
  "TWILIO_MARKUP_RATE",
  "TWILIO_SMS_INBOUND_UNIT_COST_USD",
  "TWILIO_SMS_OUTBOUND_UNIT_COST_USD",
  "TWILIO_VOICE_UNIT_COST_USD",
  "TWILIO_WHATSAPP_UNIT_COST_USD",
] as const;
const originalPricing = new Map(
  PRICING_KEYS.map((key) => [key, process.env[key]] as const),
);

beforeEach(() => {
  delete process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER;
  delete process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT;
  delete process.env.TWILIO_WHATSAPP_SANDBOX_WORKSPACE_ID;
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
    TWILIO_WHATSAPP_SANDBOX_WORKSPACE_ID:
      originalEnvironment.whatsappWorkspace,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  for (const [key, value] of originalPricing) {
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
    transport: "whatsapp_sandbox",
  });

  assert.equal(result.messageId, "SM_whatsapp");
  assert.equal(result.transport, "whatsapp");
});

test("selects the WhatsApp Sandbox only for its configured workspace and recipient", () => {
  process.env.TWILIO_WHATSAPP_SANDBOX_WORKSPACE_ID = "workspace-test";
  process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT = "+15755712705";

  assert.equal(
    twilioMessageTransportForWorkspace({
      recipientPhone: "+1 (575) 571-2705",
      workspaceId: "workspace-test",
    }),
    "whatsapp_sandbox",
  );
  assert.equal(
    twilioMessageTransportForWorkspace({
      recipientPhone: "+15755712705",
      workspaceId: "another-workspace",
    }),
    "sms",
  );
  assert.equal(
    twilioMessageTransportForWorkspace({
      recipientPhone: "+15551234567",
      workspaceId: "workspace-test",
    }),
    "sms",
  );
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

/**
 * Every Twilio usage event in production recorded a cost of exactly zero:
 * 120 outbound SMS, 87 inbound, and the one Vapi voice call. Not a rounding
 * problem -- literally no cost was ever recorded for sending a message.
 *
 * Twilio does not price a message when you send it. The create-message
 * response carries `price: null` and Twilio fills it in asynchronously once
 * the message reaches a final state, which is long after this code has
 * written its usage row. Proof is in the same data: the one thing Twilio
 * prices synchronously, a phone number purchase, recorded its $6.00 correctly.
 *
 * So for messages the environment fallback is not a fallback. It is the only
 * price this code will ever see, and with the variables unset the cost is
 * zero -- indistinguishable in the usage report from Gmail and the WhatsApp
 * sandbox, which really are free.
 *
 * These pin the fallback so it cannot be tidied away as dead configuration.
 */
test("a message with no provider price falls back to configured cost", () => {
  process.env.TWILIO_SMS_OUTBOUND_UNIT_COST_USD = "0.0079";
  process.env.TWILIO_MARKUP_RATE = "0";

  const usage = telephonyUsageCost({
    direction: "outbound",
    kind: "sms",
    // What Twilio actually returns at send time.
    providerPrice: null,
  });

  assert.equal(usage.cost, 0.0079);
});

test("a provider price, when there is one, wins over the configured cost", () => {
  process.env.TWILIO_SMS_OUTBOUND_UNIT_COST_USD = "0.0079";
  process.env.TWILIO_MARKUP_RATE = "0";

  const usage = telephonyUsageCost({
    direction: "outbound",
    kind: "sms",
    providerPrice: 0.0092,
  });

  assert.equal(usage.cost, 0.0092);
});

test("unconfigured and unpriced records zero, which is the live behaviour", () => {
  delete process.env.TWILIO_SMS_OUTBOUND_UNIT_COST_USD;
  delete process.env.TWILIO_SMS_INBOUND_UNIT_COST_USD;
  delete process.env.TWILIO_VOICE_UNIT_COST_USD;

  for (const input of [
    { direction: "outbound", kind: "sms" },
    { direction: "inbound", kind: "sms" },
    { direction: "outbound", kind: "voice_call" },
  ] as const) {
    assert.equal(
      telephonyUsageCost({ ...input, providerPrice: null }).cost,
      0,
      `${input.direction} ${input.kind}`,
    );
  }
});

test("a credit from Twilio is never recorded as a negative cost", () => {
  process.env.TWILIO_MARKUP_RATE = "0";

  assert.equal(
    telephonyUsageCost({
      direction: "outbound",
      kind: "sms",
      providerPrice: -0.0079,
    }).cost,
    0.0079,
  );
});

/**
 * Which price it is matters as much as what it is.
 *
 * Twilio's own price covers a whole message however many segments it took. A
 * configured rate is per segment. Multiplying the first by the segment count
 * double-counts a long message; not multiplying the second undercounts it. The
 * caller cannot tell them apart from the number alone, so this says so.
 */
test("reports whether the price came from Twilio or from configuration", () => {
  process.env.TWILIO_SMS_OUTBOUND_UNIT_COST_USD = "0.0125";
  process.env.TWILIO_MARKUP_RATE = "0";

  assert.equal(
    telephonyUsageCost({ direction: "outbound", kind: "sms", providerPrice: null }).source,
    "configured",
  );
  assert.equal(
    telephonyUsageCost({ direction: "outbound", kind: "sms", providerPrice: -0.0092 }).source,
    "provider",
  );

  delete process.env.TWILIO_SMS_OUTBOUND_UNIT_COST_USD;

  assert.equal(
    telephonyUsageCost({ direction: "outbound", kind: "sms", providerPrice: null }).source,
    "none",
  );
});

/**
 * WhatsApp is not a flavour of SMS, and pricing it as one was harmless only
 * while every rate was unset and everything recorded zero.
 *
 * The moment real SMS rates were configured, the 60 sandbox messages in this
 * workspace would have started recording a long-code charge each -- on the one
 * channel it actually routes through. Twilio bills SMS per segment and
 * WhatsApp per message, and the sandbox is free outright.
 */
test("a WhatsApp message is not charged at SMS rates", () => {
  process.env.TWILIO_SMS_OUTBOUND_UNIT_COST_USD = "0.0125";
  process.env.TWILIO_SMS_INBOUND_UNIT_COST_USD = "0.0127";
  process.env.TWILIO_MARKUP_RATE = "0";
  delete process.env.TWILIO_WHATSAPP_UNIT_COST_USD;

  for (const direction of ["inbound", "outbound"] as const) {
    const usage = telephonyUsageCost({
      direction,
      kind: "whatsapp",
      providerPrice: null,
    });

    assert.equal(usage.cost, 0, `${direction} WhatsApp was charged`);
    // "none" also keeps the caller from multiplying it by a segment count.
    assert.equal(usage.source, "none");
  }

  // SMS in the same process is still priced, so this is not a blanket zero.
  assert.equal(
    telephonyUsageCost({ direction: "outbound", kind: "sms", providerPrice: null }).cost,
    0.0125,
  );
});

test("a WhatsApp rate applies once one is configured", () => {
  process.env.TWILIO_WHATSAPP_UNIT_COST_USD = "0.005";
  process.env.TWILIO_MARKUP_RATE = "0";

  const usage = telephonyUsageCost({
    direction: "outbound",
    kind: "whatsapp",
    providerPrice: null,
  });

  assert.equal(usage.cost, 0.005);
  assert.equal(usage.source, "configured");
});
