import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInboundSmsPayload } from "./inbound-sms";

describe("normalizeInboundSmsPayload", () => {
  it("maps the four Twilio fields Kyro consumes", () => {
    assert.deepEqual(
      normalizeInboundSmsPayload({
        Body: "  Can you quote a bathroom renovation?  ",
        From: " +15755550123 ",
        MessageSid: " SM123 ",
        To: " +15753835284 ",
      }),
      {
        body: "Can you quote a bathroom renovation?",
        from: "+15755550123",
        messageSid: "SM123",
        to: "+15753835284",
      },
    );
  });

  it("rejects incomplete webhook payloads", () => {
    assert.equal(
      normalizeInboundSmsPayload({
        Body: "Hello",
        From: "+15755550123",
      }),
      null,
    );
  });

  it("creates an idempotency identifier when Twilio omits MessageSid", () => {
    const payload = normalizeInboundSmsPayload({
      Body: "Hello",
      From: "+15755550123",
      To: "+15753835284",
    });

    assert.ok(payload?.messageSid);
  });
});
