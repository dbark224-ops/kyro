import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReplyDraftPrompt,
  type ReplyDraftContext,
} from "./route";

function parsePrompt(context: ReplyDraftContext) {
  return JSON.parse(buildReplyDraftPrompt(context)) as {
    context: ReplyDraftContext;
    rules: string[];
    task: string;
  };
}

describe("buildReplyDraftPrompt", () => {
  it("uses skipped-email context instead of treating filtered mail like a CRM lead", () => {
    const prompt = parsePrompt({
      prompt: "Tell them I want to cancel.",
      source: "skipped_email",
      skippedEmail: {
        category: "newsletter_or_automated",
        fromEmail: "billing@example.com",
        provider: "google",
        reason: "Automated account billing email.",
        receivedAt: "2026-05-21T01:00:00.000Z",
        subject: "Action required: payment failed",
        summary: "The account payment failed and may end the subscription.",
      },
    });

    assert.equal(prompt.context.source, "skipped_email");
    assert.equal(
      prompt.context.skippedEmail?.subject,
      "Action required: payment failed",
    );
    assert.ok(
      prompt.rules.some((rule) => rule.includes("filtered-out email")),
    );
    assert.ok(
      prompt.rules.some((rule) => rule.includes("Do not ask for job details")),
    );
    assert.ok(
      prompt.rules.some((rule) => rule.includes("cancellation-style reply")),
    );
    assert.equal(
      prompt.rules.some((rule) => rule.includes("This is a CRM conversation")),
      false,
    );
  });

  it("uses CRM conversation context for normal inbox replies", () => {
    const prompt = parsePrompt({
      contactName: "Mikel",
      latestSubject: "Bathroom quote",
      leadTitle: "Bathroom remodel",
      prompt: "Ask for photos.",
      source: "conversation",
      thread: [
        {
          body: "Could you quote my bathroom?",
          direction: "inbound",
          subject: "Bathroom quote",
        },
      ],
    });

    assert.equal(prompt.context.source, "conversation");
    assert.ok(
      prompt.rules.some((rule) => rule.includes("This is a CRM conversation")),
    );
    assert.equal(
      prompt.rules.some((rule) => rule.includes("filtered-out email")),
      false,
    );
  });

  it("includes saved outbound writing settings in the draft rules", () => {
    const prompt = parsePrompt({
      contactName: "Sarah",
      latestSubject: "Drain quote",
      prompt: null,
      replyWriting: {
        messageLength: "short",
        reusableInstructions: "Ask for photos before booking drain work.",
        signOff: "Use the saved signature only.",
        tone: "Warm but no nonsense",
        tradePhrasing: "Use plumbing language and mention site access.",
        wordingStyle: "Plain text with short sentences.",
      },
      source: "conversation",
      thread: [
        {
          body: "Can you look at my blocked drain?",
          direction: "inbound",
          subject: "Drain quote",
        },
      ],
    });

    assert.equal(prompt.context.replyWriting?.tone, "Warm but no nonsense");
    assert.ok(
      prompt.rules.some((rule) => rule.includes("Writing style - Tone")),
    );
    assert.ok(
      prompt.rules.some((rule) => rule.includes("Ask for photos")),
    );
  });
});
