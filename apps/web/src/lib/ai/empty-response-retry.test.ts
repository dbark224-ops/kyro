import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * A blank response should be retried, recorded, and explainable.
 *
 * Three faults, found one after another as each fix exposed the next.
 *
 * A missing required literal always got a corrective pass; a blank body or
 * subject got none, so one flaky empty response dropped the whole alert to the
 * code template. Two near-identical inquiries minutes apart came back
 * generatedBy=model and generatedBy=fallback.
 *
 * Then the retry turned out to cover only one of the two ways the provider
 * returns nothing usable -- a live run hit "OpenAI returned an empty customer
 * message", which was a different throw, and went straight to the template.
 *
 * Then a scenario fell back after two consecutive blanks, and there was
 * nothing to diagnose it with: runCustomerMessage threw before returning its
 * usage, so a blank attempt was neither billed to the workspace nor recorded.
 * "Why did this fail twice" had no answer anywhere in the data.
 *
 * An attempt now carries its own failure reason and its usage, so any unusable
 * response is retried once, every attempt is billed, and the reason survives.
 */
const source = readRepoFile(
  "apps/web/src/lib/ai/customer-message-generation.ts",
);

describe("an unusable response is reported rather than thrown", () => {
  it("returns usage even when the content is unusable", () => {
    // Measured before the content is inspected: OpenAI served the call and
    // will bill for it whatever came back.
    assert.match(source, /const failed = \(failure: string/);
    assert.match(source, /return failed\(NO_OUTPUT_ERROR\)/);
    assert.match(source, /return failed\(EMPTY_MESSAGE_ERROR, body, subject\)/);
  });

  it("no longer throws on either empty case", () => {
    const runner = source.slice(
      source.indexOf("async function runCustomerMessage"),
      source.indexOf("type CustomerMessageAttempt"),
    );

    assert.doesNotMatch(runner, /throw new Error\(NO_OUTPUT_ERROR\)/);
    assert.doesNotMatch(runner, /throw new Error\(EMPTY_MESSAGE_ERROR\)/);
  });

  it("catches malformed JSON instead of letting it throw", () => {
    // Previously unguarded, so a truncated response was indistinguishable from
    // a provider outage.
    assert.match(source, /parsed = JSON\.parse\(outputText\)/);
    assert.match(source, /was not valid JSON/);
  });

  it("still surfaces a genuine provider failure", () => {
    // A non-ok response has no usage to report and should keep throwing.
    assert.match(source, /throw new Error\(providerErrorMessage\(payload\)\)/);
  });
});

describe("every attempt is kept and billed", () => {
  const generate = source.slice(
    source.indexOf("export async function generateCustomerMessage"),
  );

  it("retries once on any unusable response", () => {
    assert.match(generate, /if \(attempt\.failure\) \{/);
    assert.match(generate, /asking once more/);
    assert.match(generate, /attempts\.push\(attempt\);/);
  });

  it("no longer matches on the wording of an error", () => {
    // The retry used to decide from a message string which failures were worth
    // asking again about, which is fragile for something so easily reworded.
    assert.doesNotMatch(source, /function isEmptyMessageError/);
  });

  it("records the spend before giving up", () => {
    const meterAt = generate.indexOf("await recordAttemptUsage({");
    const throwAt = generate.indexOf("throw new Error(failureReason)");

    assert.ok(meterAt > 0 && throwAt > 0);
    assert.ok(meterAt < throwAt, "usage must be recorded before the throw");
  });

  it("does not let a metering error replace the real failure", () => {
    assert.match(generate, /\.catch\(\(usageError: unknown\) => \{/);
  });

  it("still keeps the corrective pass for a missing literal", () => {
    assert.match(source, /Your previous draft left out these required strings/);
  });
});

/**
 * A blank subject was throwing away a perfectly good alert.
 *
 * The retry above exists because these alerts sometimes came back unusable.
 * Reading the recorded attempts showed what "unusable" actually meant: the
 * body was complete and sensible every time, and only the subject was empty.
 *
 * Measured over twelve hours of runs -- inbound_inquiry_notification failed 5
 * of 10 times on prompts above 2000 input tokens and 0 of 46 below it. Not
 * truncation: reasoningTokens was 0 and output ran to ~120 tokens against a
 * 700 cap. A longer prompt simply makes the model likelier to skip a field it
 * has no reason to fill.
 *
 * These alerts go to the owner by SMS or WhatsApp, which have no subject line,
 * and the alert builder never reads one -- it returns body, footer and
 * provenance. So the requirement was for a field that is neither produced nor
 * used, and the cost was the template arriving instead of a written alert,
 * most often on the long threads where the alert matters most.
 */
describe("a subject is only required where one is delivered", () => {
  it("does not require one on a channel that has no subject line", () => {
    assert.match(source, /function subjectIsRequired\(channelType: string\)/);
    assert.match(source, /sms\|whatsapp\|text\|voice\|call/);
  });

  it("rejects a blank body on every channel", () => {
    // The body is the message. Losing it is always a failure.
    assert.match(
      source,
      /if \(!body \|\| \(input\.subjectRequired && !subject\)\)/,
    );
  });

  it("reads a channel name however it is punctuated", () => {
    // A word boundary does not fire around an underscore, so the first version
    // read "twilio_sms", "voice_call" and "sms_whatsapp" as needing a subject
    // -- quietly restoring the fault through a different door. No caller passes
    // those today; all three are real channel names used elsewhere here.
    assert.match(source, /replace\(\/\[\^a-z\]\+\/g, " "\)/);
  });

  it("decides from the channel, not per attempt", () => {
    // Computed once and passed to all three calls, so the retry and the
    // corrective pass cannot apply a different rule from the first attempt.
    assert.match(source, /const subjectRequired = subjectIsRequired\(/);
  });
});
