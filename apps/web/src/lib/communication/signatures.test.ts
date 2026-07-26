import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSignedBodyForChannel } from "./signatures";
import type { EmailSignatureSettings } from "./settings";

const SIGNATURE: EmailSignatureSettings = {
  logoContentBase64: "aGVsbG8=",
  logoContentType: "image/png",
  logoFilename: "Copy of work.png",
  logoSizeBytes: 8,
  logoUrl: "",
  logoWidthPx: 96,
  text: "Kind Regards, Kyro.\nAI Assistant | WFA Contractors\n(575) 571 2705",
};

const BODY = "Hi, WFA Contractors does. What can we help you with?";

describe("buildSignedBodyForChannel", () => {
  it("signs an email with text, html and the inline logo", () => {
    const signed = buildSignedBodyForChannel({
      body: BODY,
      channelType: "email",
      signature: SIGNATURE,
    });

    assert.equal(signed.signatureApplied, true);
    assert.match(signed.bodyText, /Kind Regards, Kyro\./);
    assert.ok(signed.htmlBody);
    assert.equal(signed.inlineAttachments.length, 1);
    assert.equal(signed.inlineAttachments[0]?.source, "signature_logo");
  });

  it("leaves an SMS untouched -- the real 2026-07-25 case", () => {
    // An AI-drafted SMS reply went out carrying the email signature text, an
    // HTML body and "Copy of work.png" as an attachment, because the call site
    // never checked the channel.
    const signed = buildSignedBodyForChannel({
      body: BODY,
      channelType: "sms",
      signature: SIGNATURE,
    });

    assert.equal(signed.bodyText, BODY);
    assert.equal(signed.signatureApplied, false);
    assert.equal(signed.htmlBody, null);
    assert.deepEqual(signed.inlineAttachments, []);
  });

  it("stops the signature from costing a second SMS segment", () => {
    // 160 characters is one segment. This signature adds 69, so any reply
    // longer than about 91 characters -- most of them -- was billed as two
    // segments instead of one.
    const reply = "a".repeat(120);
    const asSms = buildSignedBodyForChannel({
      body: reply,
      channelType: "sms",
      signature: SIGNATURE,
    });
    const asEmail = buildSignedBodyForChannel({
      body: reply,
      channelType: "email",
      signature: SIGNATURE,
    });

    const segments = (value: string) => Math.ceil(value.length / 160);

    assert.equal(segments(asSms.bodyText), 1);
    assert.equal(segments(asEmail.bodyText), 2);
  });

  it("never signs phone or manual channels either", () => {
    for (const channelType of ["phone", "manual", "whatsapp"]) {
      const signed = buildSignedBodyForChannel({
        body: BODY,
        channelType,
        signature: SIGNATURE,
      });

      assert.equal(
        signed.signatureApplied,
        false,
        `${channelType} should not be signed`,
      );
      assert.deepEqual(signed.inlineAttachments, []);
    }
  });

  it("honours includeSignature even on email", () => {
    const signed = buildSignedBodyForChannel({
      body: BODY,
      channelType: "email",
      includeSignature: false,
      signature: SIGNATURE,
    });

    assert.equal(signed.signatureApplied, false);
    assert.equal(signed.bodyText, BODY);
  });

  it("reports no signature applied when none is configured", () => {
    const signed = buildSignedBodyForChannel({
      body: BODY,
      channelType: "email",
      signature: {
        ...SIGNATURE,
        logoContentBase64: "",
        logoUrl: "",
        text: "",
      },
    });

    assert.equal(signed.signatureApplied, false);
    assert.equal(signed.bodyText, BODY);
  });
});
