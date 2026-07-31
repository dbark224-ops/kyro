import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeQuoteSendRequest } from "./quote-intent";

/**
 * The router that looks like it has the refusal gap the others had, and does
 * not.
 *
 * Measured it expecting the same fault: "don't send the quote yet" routes
 * here, as do "hold off on sending the quote" and "never send a quote without
 * checking with me". On the reply-execution router that shape was the worst
 * fault of the night, because that path calls approveAction and executeAction
 * and a refusal really did send.
 *
 * Here it is correct. This path prepares a quote and creates a
 * pending_approval action; it emails nobody. "Draft it but do not send"
 * produces precisely what was asked -- a draft waiting for the owner -- and an
 * existing test in commands.test.ts asserts exactly that sentence should route
 * here. Adding a refusal guard broke it, which is how the intent was found.
 *
 * The lesson kept here: two routers can take the same sentence and want
 * opposite answers, because what sits behind them differs. A refusal is only
 * dangerous where the command sends.
 */
describe("preparing a quote to send", () => {
  it("acts on a real instruction", () => {
    for (const prompt of [
      "send the quote to the customer",
      "email the quote over",
      "send that invoice out",
      "forward the quote to them",
      "mail the pdf to the customer",
      // Past participle, and still an instruction. Safe to read as one only
      // because the question guard runs first.
      "get the quote sent please",
    ]) {
      assert.equal(looksLikeQuoteSendRequest(prompt), true, prompt);
    }
  });

  it("prepares a held draft when told to draft but not send", () => {
    // Not a bug. The command holds it for approval, so this is the request
    // being honoured rather than ignored.
    for (const prompt of [
      "draft an email for this quote but do not send it",
      "don't send the quote yet, just get it ready",
    ]) {
      assert.equal(looksLikeQuoteSendRequest(prompt), true, prompt);
    }
  });

  it("keeps treating a question as a question", () => {
    // Adding "sent" as an instruction verb could have broken these. The
    // question guard runs first, and this is what proves it still does.
    for (const prompt of [
      "did you send the quote",
      "has the quote gone out",
      "was the quote sent yesterday",
      "has the quote been sent",
      "when was the invoice sent",
    ]) {
      assert.equal(looksLikeQuoteSendRequest(prompt), false, prompt);
    }
  });
});
