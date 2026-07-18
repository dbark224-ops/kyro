import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveVapiToolAuthorization,
  VAPI_EXTERNAL_CALLER_REFUSAL,
} from "./vapi-tool-authorization";

describe("Vapi voice tool authorization", () => {
  it("allows every tool for a caller recognized as an internal user", () => {
    const result = resolveVapiToolAuthorization({
      callerRole: "internal_user",
      purpose: "inbound_user",
      toolName: "kyro_assistant_command",
    });

    assert.deepEqual(result, { allowed: true, trustedInternal: true });
  });

  it("allows internal browser and mobile voice tools by trusted source", () => {
    const result = resolveVapiToolAuthorization({
      source: "kyro.vapi_internal_voice",
      toolName: "kyro_update_contact",
    });

    assert.deepEqual(result, { allowed: true, trustedInternal: true });
  });

  it("allows external callers to record a useful call outcome", () => {
    const result = resolveVapiToolAuthorization({
      callerRole: "external_caller",
      purpose: "voicemail_overflow",
      toolName: "kyro_record_call_note",
    });

    assert.deepEqual(result, { allowed: true, trustedInternal: false });
  });

  it("allows external callers to use the policy-gated booking tool", () => {
    const result = resolveVapiToolAuthorization({
      callerRole: "external_caller",
      purpose: "inbound_customer",
      toolName: "kyro_request_booking",
    });

    assert.deepEqual(result, { allowed: true, trustedInternal: false });
  });

  for (const toolName of [
    "kyro_assistant_command",
    "kyro_check_recent_email",
    "kyro_context_lookup",
    "kyro_lookup_contact",
    "kyro_send_sms",
    "kyro_start_outbound_call",
    "kyro_update_contact",
    "kyro_web_search",
  ]) {
    it(`denies ${toolName} to an external caller`, () => {
      const result = resolveVapiToolAuthorization({
        callerRole: "external_caller",
        purpose: "inbound_customer",
        toolName,
      });

      assert.deepEqual(result, { allowed: false, trustedInternal: false });
    });
  }

  it("defaults to denying tools when trust metadata is absent", () => {
    assert.deepEqual(resolveVapiToolAuthorization({}), {
      allowed: false,
      trustedInternal: false,
    });
  });

  it("uses a caller-safe refusal without exposing authorization internals", () => {
    assert.equal(
      VAPI_EXTERNAL_CALLER_REFUSAL,
      "I'm sorry, I can't help with that over this phone line. If you're part of the business, please use the Kyro app.",
    );
  });
});
