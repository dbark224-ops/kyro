import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VAPI_INTERNAL_CALENDAR_GUIDANCE,
  VAPI_INTERNAL_COMMAND_TOOL,
} from "./vapi-tool-guidance";

describe("Vapi internal tool guidance", () => {
  it("routes calendar reads and mutations through the installed command tool", () => {
    const guidance = VAPI_INTERNAL_CALENDAR_GUIDANCE.join("\n");

    assert.equal(VAPI_INTERNAL_COMMAND_TOOL, "kyro_context_lookup");
    assert.match(guidance, /create, update, move, reschedule/);
    assert.match(guidance, /cannot reschedule or edit calendar events/);
    assert.doesNotMatch(guidance, /kyro_assistant_command/);
  });
});
