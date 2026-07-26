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
    assert.ok(
      prompt.rules.some(
        (rule) =>
          rule.includes("answer first") &&
          rule.includes("what service or help they need"),
      ),
    );
    assert.ok(
      prompt.rules.some((rule) => rule.includes("fixed stock wording")),
    );
  });

  it("treats a new customer message as a complete but non-scripted reply", () => {
    const prompt = JSON.parse(
      buildReplyDraftPrompt({
        prompt: null,
        source: "conversation",
        thread: [
          {
            body: "Hi, where are you based?",
            direction: "inbound",
            subject: null,
          },
        ],
      }),
    ) as {
      rules: string[];
    };

    assert.ok(
      prompt.rules.some(
        (rule) =>
          rule.includes("first customer turn") &&
          rule.includes("briefly greet or acknowledge") &&
          rule.includes("invitation to continue"),
      ),
    );
  });

  it("keeps a first-contact SMS compact while asking for a natural sign-off", () => {
    const prompt = JSON.parse(
      buildReplyDraftPrompt({
        channelType: "sms",
        prompt: null,
        source: "conversation",
        thread: [
          {
            body: "Hi, where are you based?",
            channelType: "sms",
            direction: "inbound",
            subject: null,
          },
        ],
      }),
    ) as {
      rules: string[];
    };

    const rules = prompt.rules.join("\n");

    // An SMS carries its own greeting and sign-off, because nothing is
    // appended to it after the model writes.
    assert.match(rules, /addressing the customer/);
    assert.match(rules, /signing off as the business/);
    assert.match(rules, /nothing is appended to an SMS/i);

    // And it is never told to lean on the email signature, which is what
    // produced a signed SMS with a logo attached on 2026-07-25.
    assert.doesNotMatch(rules, /saved email signature/);
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

  it("uses a verified calendar slot instead of asking the customer for a time", () => {
    const prompt = JSON.parse(
      buildReplyDraftPrompt({
        channelType: "sms",
        inquiryFacts: {
          address: null,
          missingInfo: ["Job address", "Preferred time", "Email address"],
          preferredTime: null,
          responseMode: "service_inquiry",
        },
        prompt: "Offer a free time next week.",
        source: "conversation",
        verifiedAvailability: {
          endsAt: "2026-07-28T17:00:00.000Z",
          label: "Tuesday, July 28 at 10:00 AM MDT",
          startsAt: "2026-07-28T16:00:00.000Z",
          timeZone: "America/Denver",
        },
      }),
    ) as {
      rules: string[];
    };

    assert.ok(
      prompt.rules.some(
        (rule) =>
          rule.includes("Tuesday, July 28 at 10:00 AM MDT") &&
          rule.includes("Offer that specific time"),
      ),
    );
    assert.equal(
      prompt.rules.some((rule) =>
        rule.includes("Required missing detail: preferred day or time"),
      ),
      false,
    );
  });
});
