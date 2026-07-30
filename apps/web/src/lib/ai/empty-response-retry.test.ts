import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * One blank response should not put a template in front of the owner.
 *
 * Caught in a live run, and only because generatedBy had just been recorded on
 * the outbound message. Two near-identical French inquiries minutes apart: the
 * first came back generatedBy=model, the second generatedBy=fallback with
 * generationError "OpenAI returned a customer message without a subject or
 * body". Same input, different luck.
 *
 * A missing required literal already got a corrective pass. A blank body or
 * subject got none -- it threw on the first attempt and the caller fell
 * straight through to buildInboundInquiryNotificationBody. So the cheapest and
 * most transient failure was the one with no recovery.
 *
 * Deliberately narrow: only the empty case retries. A provider outage, a
 * refusal or a timeout should surface rather than be asked twice.
 */
const source = readRepoFile(
  "apps/web/src/lib/ai/customer-message-generation.ts",
);

describe("an empty model response is asked once more", () => {
  it("retries on the empty case", () => {
    assert.match(source, /if \(!isEmptyMessageError\(error\)\) \{\s*throw error;/);
    assert.match(source, /return runCustomerMessage\(\{ apiKey, model, prompt \}\);/);
  });

  it("does not retry anything else", () => {
    // The guard rethrows first, so only the empty case reaches the second call.
    const retry = source.slice(
      source.indexOf("let attempt = await runCustomerMessage"),
      source.indexOf("const attempts = [attempt]"),
    );

    assert.match(retry, /throw error;/);
    assert.doesNotMatch(retry, /catch \(\) =>/);
  });

  it("shares one constant per throw between the throw and the check", () => {
    // Matching on a message is fragile; matching on two copies of a message is
    // worse, and this is the kind of string that gets reworded.
    assert.match(source, /const EMPTY_MESSAGE_ERROR =/);
    assert.match(source, /const NO_OUTPUT_ERROR =/);
    assert.match(source, /throw new Error\(EMPTY_MESSAGE_ERROR\);/);
    assert.match(source, /throw new Error\(NO_OUTPUT_ERROR\);/);
  });

  it("covers both ways the provider returns nothing usable", () => {
    // The retry originally caught only the parsed-but-blank case. A live run
    // hit the other one -- no output text at all -- and went straight to the
    // template. Two doors, one of them left open.
    assert.match(
      source,
      /error\.message === EMPTY_MESSAGE_ERROR \|\| error\.message === NO_OUTPUT_ERROR/,
    );
  });

  it("says so in the logs when it happens", () => {
    // Otherwise a model that has started returning blanks looks like a model
    // that is simply slow.
    assert.match(source, /Empty \$\{input\.taskType\} from the model, asking once more/);
  });

  it("builds the prompt once and reuses it", () => {
    // The retry must ask the same question; rebuilding risks it drifting.
    assert.match(source, /const prompt = buildPrompt\(\{/);
    assert.match(source, /runCustomerMessage\(\{ apiKey, model, prompt \}\)/);
  });

  it("still keeps the corrective pass for a missing literal", () => {
    assert.match(source, /Your previous draft left out these required strings/);
    assert.match(source, /attempts\.push\(attempt\);/);
  });
});
