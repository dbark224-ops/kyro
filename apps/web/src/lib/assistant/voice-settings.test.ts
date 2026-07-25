import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PHONE_AGENT_INBOUND_INQUIRY_MODE,
  normalizeVoiceSettings,
} from "./voice-settings";

describe("voice settings", () => {
  it("defaults existing workspaces to capture and notify", () => {
    assert.equal(
      normalizeVoiceSettings({}).phoneAgentInboundInquiryMode,
      DEFAULT_PHONE_AGENT_INBOUND_INQUIRY_MODE,
    );
  });

  it("preserves a valid inbound inquiry autonomy mode", () => {
    assert.equal(
      normalizeVoiceSettings({
        phoneAgentInboundInquiryMode: "book_from_calendar",
      }).phoneAgentInboundInquiryMode,
      "book_from_calendar",
    );
  });

  it("falls back when the stored autonomy mode is unknown", () => {
    assert.equal(
      normalizeVoiceSettings({
        phoneAgentInboundInquiryMode: "do_everything",
      }).phoneAgentInboundInquiryMode,
      "capture_notify",
    );
  });
});
