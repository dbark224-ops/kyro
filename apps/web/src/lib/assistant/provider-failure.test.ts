import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSISTANT_PROVIDER_UNAVAILABLE_MESSAGE,
  assistantContentAfterModel,
} from "./provider-failure";

describe("assistantContentAfterModel", () => {
  it("returns the model response when the provider succeeds", () => {
    assert.equal(
      assistantContentAfterModel({
        modelText: "I can send that reply for you.",
      }),
      "I can send that reply for you.",
    );
  });

  it("does not expose a semantic command fallback after provider failure", () => {
    assert.equal(
      assistantContentAfterModel({
        fallbackReason: "You exceeded your current quota.",
        modelText: "I'm here. Ask me anything, serious or stupid.",
      }),
      ASSISTANT_PROVIDER_UNAVAILABLE_MESSAGE,
    );
  });

  it("keeps a confirmed exact action result when response prose fails", () => {
    assert.equal(
      assistantContentAfterModel({
        exactAnswer: "Done. I sent the reply to Mikel.",
        fallbackReason: "OpenAI assistant request failed.",
        modelText: "Fallback text",
      }),
      "Done. I sent the reply to Mikel.",
    );
  });
});
