import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPlaceholderVoiceContactName,
  voiceCallProfileFacts,
} from "./call-note-profile";

describe("voice call CRM profile facts", () => {
  it("promotes labeled caller details from a compact call note", () => {
    const facts = voiceCallProfileFacts({
      args: {},
      note: "Bathroom renovation quote request. Caller: David. Callback: 585-522-1939. Location: 100 Vista Del Monte, Las Cruces. Team to arrange inspection.",
    });

    assert.deepEqual(facts, {
      address: "100 Vista Del Monte, Las Cruces",
      email: null,
      name: "David",
    });
  });

  it("prefers structured tool arguments over note labels", () => {
    const facts = voiceCallProfileFacts({
      args: {
        callerName: "David Barker",
        customerEmail: "david@example.com",
        jobAddress: "200 Main Street, Denver",
      },
      note: "Caller: Dave. Address: 100 Old Road.",
    });

    assert.deepEqual(facts, {
      address: "200 Main Street, Denver",
      email: "david@example.com",
      name: "David Barker",
    });
  });

  it("rejects placeholder identity values", () => {
    const facts = voiceCallProfileFacts({
      args: {},
      note: "Caller: Unknown. Address: Not provided.",
    });

    assert.deepEqual(facts, {
      address: null,
      email: null,
      name: null,
    });
    assert.equal(isPlaceholderVoiceContactName("Unknown phone caller"), true);
    assert.equal(isPlaceholderVoiceContactName("David Barker"), false);
  });
});
