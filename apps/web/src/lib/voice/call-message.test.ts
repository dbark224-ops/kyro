import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVoiceCallInboxBody,
  voiceCallIdFromMessageMetadata,
  voiceCallMessageBody,
} from "./call-message";

describe("voice call inbox messages", () => {
  it("keeps future call messages concise", () => {
    assert.equal(
      buildVoiceCallInboxBody("Caller requested a quote.", "Call went well."),
      "Caller requested a quote.\n\nSummary: Call went well.",
    );
  });

  it("removes copied transcripts from existing call messages", () => {
    assert.equal(
      voiceCallMessageBody(
        "Caller requested a quote.\n\nTranscript: Hello, this is a long transcript.",
        { voiceCallId: "call-1" },
      ),
      "Caller requested a quote.",
    );
  });

  it("does not alter ordinary messages containing the word transcript", () => {
    const body = "Please send me the transcript:\nThanks.";

    assert.equal(voiceCallMessageBody(body, {}), body);
  });

  it("reads the internal call id from message metadata", () => {
    assert.equal(
      voiceCallIdFromMessageMetadata({ voiceCallId: " call-1 " }),
      "call-1",
    );
  });
});
