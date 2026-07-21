import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import {
  assistantThreadScope,
  extractSuggestedMemory,
  fieldAssistantThreadMatches,
} from "./persistence";

describe("assistant memory suggestions", () => {
  it("does not suggest one-off action requests as lasting memory", () => {
    const prompts = [
      "can you send the primary workplace contact an sms, i want to test if that functionality is working",
      "can you send the primary workplace escalation contact an sms, i want to test if that functionality is working",
    ];

    for (const prompt of prompts) {
      assert.equal(extractSuggestedMemory(prompt), null, prompt);
    }
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

test("treats legacy and explicit app threads as in-app conversations", () => {
  assert.equal(assistantThreadScope({}), "app");
  assert.equal(assistantThreadScope({ source: "assistant.page" }), "app");
  assert.equal(assistantThreadScope({ threadScope: "app" }), "app");
});

test("recognizes field threads without mixing different internal senders", () => {
  const metadata = {
    channelGroup: "internal_messaging",
    senderPhone: "+15755712705",
    threadScope: "field",
  };

  assert.equal(assistantThreadScope(metadata), "field");
  assert.equal(fieldAssistantThreadMatches(metadata, "+15755712705"), true);
  assert.equal(fieldAssistantThreadMatches(metadata, "+15855221939"), false);
});

test("does not classify arbitrary legacy metadata as a field thread", () => {
  assert.equal(
    fieldAssistantThreadMatches(
      { lastTouchedBy: "assistant.page", senderPhone: "+15755712705" },
      "+15755712705",
    ),
    false,
  );
});
