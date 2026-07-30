import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * An alert the owner cannot read is worse than no alert.
 *
 * A customer emailed in French about a leak. Kyro replied to her in French,
 * which is right, and then wrote the owner's alert in French too:
 *
 *   "Email de Zoé Lefèvre : fuite urgente de douche à l'étage, eau au plafond,
 *    2210 Coal Ave SE, Albuquerque. Réponse prête : couper l'eau si possible et
 *    demander un créneau. Urgent : je relance jusqu'à réponse."
 *
 * The alert exists so the owner can act in seconds. One in a language they do
 * not read still interrupts them, still escalates, and tells them nothing --
 * and this one was about water coming through a ceiling.
 *
 * The customer's own words still matter though, so the rule is not "always
 * English": quote them as they wrote them, and put the owner's language around
 * the quote.
 */
const source = readRepoFile(
  "apps/web/src/lib/ai/customer-message-generation.ts",
);
const operatorRules = source.slice(
  source.indexOf("You are writing to the business owner"),
  source.indexOf("Never invent facts"),
);

describe("the operator alert is written in the owner's language", () => {
  it("ties the language to the business, not the customer", () => {
    assert.match(
      operatorRules,
      /Write in the language the business itself uses/,
    );
    assert.match(operatorRules, /context\.businessProfile/);
  });

  it("still lets the customer be quoted in their own words", () => {
    // Otherwise the fix would throw away the thing the quote rule exists for:
    // showing the owner exactly what was said.
    assert.match(operatorRules, /only inside a direct quotation/);
    assert.match(operatorRules, /quote their words as they wrote them/);
  });

  it("asks for a translation around the quote", () => {
    assert.match(
      operatorRules,
      /your own translation or summary around it/,
    );
  });

  it("applies to the operator audience only", () => {
    // The reply to the customer must still follow the customer's language and
    // the workspace tone, which is the other branch of audienceWritingRules.
    const customerBranch = source.slice(
      source.indexOf('if (input.audience === "customer")'),
      source.indexOf("You are writing to the business owner"),
    );

    assert.doesNotMatch(customerBranch, /language the business itself uses/);
    assert.match(customerBranch, /replyWritingPromptRules/);
  });
});
