import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vapiInboundBookingToolOverride } from "./vapi-inbound";

describe("Vapi inbound booking tool override", () => {
  it("does not expose calendar tooling in capture-and-notify mode", () => {
    assert.equal(
      vapiInboundBookingToolOverride({
        credentialId: "credential-1",
        mode: "capture_notify",
        toolUrl: "https://example.com/api/integrations/vapi/tool",
      }),
      null,
    );
  });

  it("appends an authenticated booking tool for higher-autonomy calls", () => {
    const tool = vapiInboundBookingToolOverride({
      credentialId: "credential-1",
      mode: "book_from_calendar",
      toolUrl: "https://example.com/api/integrations/vapi/tool",
    });

    assert.equal(tool?.type, "function");
    assert.equal(tool?.function.name, "kyro_request_booking");
    assert.equal(tool?.server.credentialId, "credential-1");
    assert.deepEqual(tool?.function.parameters.required, ["action"]);
  });
});
