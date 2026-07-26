import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// Resolved from this file, not the working directory, so the scan works the
// same whether the suite runs from the repo root or from apps/web.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath: string) {
  return readFileSync(join(SRC, relativePath), "utf8");
}

/**
 * A source scan rather than a unit test, because the thing worth guarding is
 * the *absence* of something: no code path may compose the words a customer
 * reads. A unit test on the generator cannot catch a fourth call site quietly
 * reintroducing its own template.
 */
describe("quote send message stays LLM-written", () => {
  const callSites = [
    "lib/assistant/commands.ts",
    "app/documents/actions.ts",
    "app/api/mobile/documents/[quoteDraftId]/route.ts",
  ];

  it("has no hardcoded quote prose anywhere in the app", () => {
    // The exact sentences the three duplicated composers used to emit.
    const banned = [
      "Thanks for the opportunity",
      "Your quote: ",
      "Your revised quote",
      "If the link gives you any trouble",
      "You can approve the quote or request changes here",
    ];

    for (const relativePath of callSites) {
      const source = read(relativePath);

      for (const phrase of banned) {
        assert.ok(
          !source.includes(phrase),
          `${relativePath} should not compose customer prose, found: ${phrase}`,
        );
      }
    }
  });

  it("routes every quote send through the one generator", () => {
    for (const relativePath of callSites) {
      assert.match(
        read(relativePath),
        /generateQuoteSendMessage\(/,
        `${relativePath} should send quotes via generateQuoteSendMessage`,
      );
    }
  });

  it("keeps the approval link a hard requirement of the generated message", () => {
    const source = read("lib/documents/quote-send-message.ts");

    assert.match(source, /mustInclude/);
    assert.match(source, /approvalUrl/);
  });

  it("never falls back to code-written text when the model is unavailable", () => {
    const source = read("lib/ai/customer-message-generation.ts");

    // The failure path throws so the operator sees it, rather than a customer
    // receiving template text signed by an assistant that did not write it.
    assert.match(source, /throw new Error/);
    assert.doesNotMatch(source, /Thanks for the opportunity/);
  });
});
