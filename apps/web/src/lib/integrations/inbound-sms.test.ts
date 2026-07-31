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

describe("a photo with no words still reaches somebody", () => {
  // Sending a picture of the problem and nothing else is one of the most
  // ordinary things a customer of a trade business does. Twilio delivers it
  // with media and an empty Body, and an empty Body meant the webhook answered
  // 200 and dropped it: no lead, no alert, no inbox entry, no reply. The
  // customer thinks the leak is reported and the owner never hears about it.
  const base = { From: "+15055550123", To: "+15055550100", MessageSid: "SM1" };

  it("keeps a photo-only message instead of discarding it", () => {
    const payload = normalizeInboundSmsPayload({
      ...base,
      Body: "",
      MediaContentType0: "image/jpeg",
      NumMedia: "1",
    });

    assert.ok(payload, "a photo-only message was dropped");
    assert.equal(payload.body, "[Sent one photo and no message.]");
  });

  it("counts them, and does not call a PDF a photo", () => {
    assert.equal(
      normalizeInboundSmsPayload({
        ...base,
        Body: "",
        MediaContentType0: "image/png",
        NumMedia: "3",
      })?.body,
      "[Sent 3 photos and no message.]",
    );

    assert.equal(
      normalizeInboundSmsPayload({
        ...base,
        Body: "",
        MediaContentType0: "application/pdf",
        NumMedia: "1",
      })?.body,
      "[Sent one attachment and no message.]",
    );
  });

  it("prefers the customer's own words whenever there are any", () => {
    assert.equal(
      normalizeInboundSmsPayload({
        ...base,
        Body: "Here's the leak under the sink",
        MediaContentType0: "image/jpeg",
        NumMedia: "1",
      })?.body,
      "Here's the leak under the sink",
    );
  });

  it("still drops a message that is genuinely empty", () => {
    // No words and no media is nothing, and must not raise an inquiry.
    assert.equal(normalizeInboundSmsPayload({ ...base, Body: "" }), null);
    assert.equal(
      normalizeInboundSmsPayload({ ...base, Body: "", NumMedia: "0" }),
      null,
    );
  });
});
