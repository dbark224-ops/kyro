import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath: string) {
  return readFileSync(join(SRC, relativePath), "utf8");
}

/**
 * Kyro is an AI assistant: the model writes every word a customer reads, and
 * deterministic code only decides what has to be true. That is a property of
 * the whole reply path, not of any one function, so it is guarded by scanning
 * the source for sentences rather than by unit tests.
 */
describe("no code-written customer prose in the reply path", () => {
  const bannedSentences = [
    "Thanks for getting in touch",
    "Thanks for letting me know",
    "Thanks for the extra details",
    "A few details for your quote",
    "Thanks for the details",
    "Re: Your question",
    "To arrange the next step, could you please send through",
    "You can call us on",
    "Is there anything else we can help with",
    "Thanks for the opportunity",
  ];

  const files = [
    "lib/ai/triage.ts",
    "lib/ai/reply-draft-generation.ts",
    "lib/ai/customer-message-generation.ts",
    "lib/documents/quote-send-message.ts",
    "lib/assistant/commands.ts",
  ];

  it("composes no customer sentences anywhere in the reply path", () => {
    for (const relativePath of files) {
      const source = read(relativePath);

      for (const sentence of bannedSentences) {
        assert.ok(
          !source.includes(sentence),
          `${relativePath} must not compose customer prose, found: "${sentence}"`,
        );
      }
    }
  });

  it("keeps the missing-info check to detection, never rewriting", () => {
    const source = read("lib/ai/triage.ts");

    // The old pair spliced a template sentence over the model's own wording.
    assert.doesNotMatch(source, /mergeMissingInfoIntoReplyBody/);
    assert.doesNotMatch(source, /missingInfoQuestion/);
    assert.match(source, /replyDraftMissingInfoGaps/);
  });

  it("has no canned reply body builder left to fall back to", () => {
    const source = read("lib/ai/triage.ts");

    assert.doesNotMatch(source, /function buildReplyBody/);
    assert.doesNotMatch(source, /knownBusinessFactFallbackReply/);
  });
});
