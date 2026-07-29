import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * A generation that gave up spent tokens and billed nothing.
 *
 * generateCustomerMessage retries once when the model drops a required literal,
 * then throws if it drops it again. Metering sat below that throw, so two paid
 * calls left no usage_events row, no ai_run, and no cost against the workspace.
 *
 * That is a billing hole on its own. It also made the failure invisible: the
 * way the truncated inquiry alert was diagnosed was by finding no LLM call in
 * usage_events between triage and the SMS -- which looked like "the model was
 * never asked" when it had in fact been asked twice and rejected twice.
 *
 * The success path leaked too, more quietly: only the final attempt was
 * metered, so a corrective pass that worked still lost the first call.
 */
describe("every provider call is billed, including the ones we discard", () => {
  const source = readRepoFile(
    "apps/web/src/lib/ai/customer-message-generation.ts",
  );

  it("collects each attempt rather than only the last", () => {
    assert.match(source, /const attempts = \[attempt\];/);
    assert.match(source, /attempts\.push\(attempt\);/);
  });

  it("meters before throwing on unrecoverable missing literals", () => {
    const generate = source.slice(
      source.indexOf("export async function generateCustomerMessage"),
    );
    const meterAt = generate.indexOf("await recordAttemptUsage({");
    const throwAt = generate.indexOf(
      "Kyro could not write this message with the required details",
    );

    assert.ok(meterAt > 0, "the failure path should record usage");
    assert.ok(throwAt > 0, "the failure path should still throw");
    assert.ok(
      meterAt < throwAt,
      "usage has to be recorded before the throw, or it never runs",
    );
  });

  it("bills every attempt, not just the surviving one", () => {
    const helper = source.slice(source.indexOf("async function recordAttemptUsage"));

    assert.match(helper, /attempts\.flatMap\(/);
    assert.match(helper, /providerUsageId: attempt\.usage\.providerUsageId/);
  });

  it("keeps each attempt's own provider usage id for reconciliation", () => {
    // One summed row could not be matched back against OpenAI's own record of
    // two separate calls.
    const helper = source.slice(source.indexOf("async function recordAttemptUsage"));

    assert.match(helper, /attempt: index \+ 1/);
  });

  it("records the failed run as failed, with the reason", () => {
    const helper = source.slice(source.indexOf("async function recordAttemptUsage"));

    assert.match(helper, /status: failed \? "failed" : "completed"/);
    assert.match(helper, /error: input\.failureReason/);
  });

  it("does not let a metering error replace the real failure", () => {
    // The operator needs "Kyro could not write this message", not a usage-write
    // error thrown on top of it from the catch handler.
    const generate = source.slice(
      source.indexOf("export async function generateCustomerMessage"),
    );
    const failurePath = generate.slice(
      generate.indexOf("const failureReason"),
      generate.indexOf(
        "Kyro could not write this message with the required details",
      ),
    );

    assert.match(failurePath, /\.catch\(\(usageError: unknown\) => \{/);
  });

  it("still returns the message on the success path", () => {
    assert.match(
      source,
      /return \{ body: attempt\.body, model, subject: attempt\.subject \};/,
    );
  });
});
