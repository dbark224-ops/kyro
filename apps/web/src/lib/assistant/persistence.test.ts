import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSuggestedMemory } from "./persistence";

describe("assistant memory suggestions", () => {
  it("does not suggest one-off action requests as lasting memory", () => {
    assert.equal(
      extractSuggestedMemory(
        "can you send the primary workplace contact an sms, i want to test if that functionality is working",
      ),
      null,
    );
  });

  it("keeps high-confidence durable preferences eligible for approval", () => {
    assert.equal(
      extractSuggestedMemory("I prefer short, direct customer replies."),
      "I prefer short, direct customer replies.",
    );
    assert.equal(
      extractSuggestedMemory(
        "From now on, always keep customer SMS messages concise.",
      ),
      "From now on, always keep customer SMS messages concise.",
    );
  });
});
