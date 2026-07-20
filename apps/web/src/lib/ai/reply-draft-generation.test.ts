import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReplyDraftPrompt } from "./reply-draft-generation";

describe("buildReplyDraftPrompt", () => {
  it("asks the reply model to distinguish commitments from availability questions", () => {
    const prompt = JSON.parse(
      buildReplyDraftPrompt({
        prompt: "Tell them we can come Tuesday at 10am.",
        source: "conversation",
      }),
    ) as {
      outputContract: Record<string, string>;
      rules: string[];
    };

    assert.ok(prompt.outputContract.calendarCommitment);
    assert.ok(
      prompt.rules.some(
        (rule) =>
          rule.includes("concrete commitment") &&
          rule.includes("specific date and time"),
      ),
    );
    assert.ok(
      prompt.rules.some(
        (rule) =>
          rule.includes("asks what time suits") &&
          rule.includes("calendarCommitment to false"),
      ),
    );
  });
});
