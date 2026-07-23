import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReplyDraftPrompt } from "./reply-draft-generation";

describe("buildReplyDraftPrompt", () => {
  it("answers a simple business message without adding job-intake requirements", () => {
    const prompt = JSON.parse(
      buildReplyDraftPrompt({
        inquiryFacts: {
          address: null,
          missingInfo: ["Job address", "Preferred time", "Phone number"],
          preferredTime: null,
          responseMode: "simple_business_message",
        },
        prompt: null,
        source: "conversation",
      }),
    ) as {
      rules: string[];
    };

    assert.ok(
      prompt.rules.some((rule) =>
        rule.includes("Answer or acknowledge that message naturally"),
      ),
    );
    assert.equal(
      prompt.rules.some((rule) => rule.startsWith("Required missing detail:")),
      false,
    );
  });

  it("keeps intake requirements for a genuine service inquiry", () => {
    const prompt = JSON.parse(
      buildReplyDraftPrompt({
        inquiryFacts: {
          address: null,
          missingInfo: ["Job address", "Phone number"],
          preferredTime: "Tuesday morning",
          responseMode: "service_inquiry",
        },
        prompt: null,
        source: "conversation",
      }),
    ) as {
      rules: string[];
    };

    assert.ok(prompt.rules.includes("Required missing detail: job address."));
    assert.ok(
      prompt.rules.includes(
        "Required missing detail for email-originated inquiry: phone number.",
      ),
    );
  });

  it("treats legacy missing-info labels as conditional rather than mandatory", () => {
    const prompt = JSON.parse(
      buildReplyDraftPrompt({
        inquiryFacts: {
          address: null,
          missingInfo: ["Job address"],
          preferredTime: null,
          responseMode: null,
        },
        prompt: null,
        source: "conversation",
      }),
    ) as {
      rules: string[];
    };

    assert.ok(
      prompt.rules.some((rule) =>
        rule.includes("predates response-mode classification"),
      ),
    );
    assert.ok(
      prompt.rules.some((rule) =>
        rule.includes("only if the latest customer message is genuinely"),
      ),
    );
  });

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
