import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * The urgent escalation alert has never been written by the model. Not once.
 *
 * `ai_runs` holds no `urgent_escalation_alert` row in the entire history of the
 * database, while the code has carried a writer and a prompt for it the whole
 * time. Three faults kept it unreachable, and any one of them alone was enough:
 *
 * 1. writeEscalationAlert returned early whenever the caller supplied a title
 *    and summary. The guard was written for "a human already said what this
 *    is", but presence is not authorship -- all three callers build those
 *    strings in code, so the guard fired every time.
 * 2. Even past that, the success path returned `explicitSummary ?? written.body`
 *    -- so the model would have been paid for and then discarded.
 * 3. And the call passed the string "system" as userId, which the generator
 *    documents as forbidden: usage_events.user_id is a uuid column.
 *
 * Between them the owner has only ever read `Gmail email from {name}:
 * {classifier summary}`, which is the wall of raw text the writer exists to
 * replace.
 */
const source = readRepoFile("apps/web/src/lib/escalation/urgent-escalation.ts");
const writer = source.slice(
  source.indexOf("async function writeEscalationAlert"),
  source.indexOf("async function sendEmailStep"),
);

describe("a code-built summary no longer suppresses the alert writer", () => {
  it("requires an explicit claim of authorship, not just text", () => {
    assert.match(writer, /input\.alertAuthoredByPerson && explicitTitle/);
  });

  it("still lets a person's own words win when they say so", () => {
    const shortCircuit = writer.slice(
      writer.indexOf("if (input.alertAuthoredByPerson"),
    );

    // The fields, not the formatting. This previously pinned the exact object
    // literal and broke when an authorship marker was added alongside them --
    // a change that strengthened the very thing the test guards.
    const returned = shortCircuit.slice(0, 260);

    assert.match(returned, /summary: explicitSummary/);
    assert.match(returned, /title: explicitTitle/);
  });

  it("declares the flag on the input type", () => {
    assert.match(source, /alertAuthoredByPerson\?: boolean;/);
  });

  it("is not set by any caller today, because none of them are people", () => {
    // If a caller ever does set it, that is a deliberate act and this test
    // should be updated with the reason. What must not come back is the flag
    // being set to restore the old behaviour wholesale.
    for (const path of [
      "apps/web/src/lib/integrations/inbound-email-sync.ts",
      "apps/web/src/lib/inbound/manual.ts",
      "apps/web/src/lib/voice/calls.ts",
    ]) {
      assert.doesNotMatch(
        readRepoFile(path),
        /alertAuthoredByPerson/,
        `${path} should let the model write the alert`,
      );
    }
  });
});

describe("the model's words are used, not paid for and dropped", () => {
  it("returns the generated body on the success path", () => {
    // Fields, not formatting -- see the note on the authorship test above.
    assert.match(writer, /summary: written\.body/);
    assert.match(writer, /title: written\.subject/);
  });

  it("no longer prefers the caller's string over what it just generated", () => {
    // This is the subtle one: removing the early return alone would have made
    // the LLM run and changed nothing about the message that arrived.
    const successPath = writer.slice(0, writer.indexOf("} catch (error)"));

    assert.doesNotMatch(successPath, /explicitSummary \?\? written\.body/);
    assert.doesNotMatch(successPath, /explicitTitle \?\? written\.subject/);
  });

  it("still falls back to the caller's text when generation fails", () => {
    // An urgent escalation must never be lost because the model was down.
    const catchPath = writer.slice(writer.indexOf("} catch (error)"));

    assert.match(catchPath, /summary: explicitSummary \?\? input\.content/);
    assert.match(catchPath, /title: explicitTitle \?\? "Urgent customer inquiry"/);
  });
});

describe("the alert is billed to something the schema can hold", () => {
  it("never passes the string system as a user id", () => {
    assert.doesNotMatch(writer, /userId:.*"system"/);
  });

  it("passes a uuid or null", () => {
    assert.match(writer, /userId: escalationAlertUserId\(input\)/);
    assert.match(source, /function escalationAlertUserId/);
    assert.match(source, /UUID_PATTERN\.test\(candidate\) \? candidate : null/);
  });
});

describe("nothing about trigger detection changed", () => {
  it("still detects triggers before writing, and bails when there are none", () => {
    // The caller's title and summary feed detectUrgentEscalationTriggers, so
    // they had to keep being passed. Ordering also means the model is only
    // called for a message that is genuinely escalating -- not for every email.
    const create = source.slice(
      source.indexOf("export async function createUrgentEscalationIncident"),
    );
    const detectAt = create.indexOf("detectUrgentEscalationTriggers(input");
    const bailAt = create.indexOf('reason: "no_enabled_trigger"');
    const writeAt = create.indexOf("await writeEscalationAlert(");

    assert.ok(detectAt > 0 && bailAt > 0 && writeAt > 0);
    assert.ok(detectAt < bailAt, "triggers are detected before the early exit");
    assert.ok(
      bailAt < writeAt,
      "a non-escalating message must not reach the model",
    );
  });

  it("detects from the customer's words alone", () => {
    // This once asserted the opposite -- that the caller's title and summary
    // were still fed to detection, guarding against the authorship refactor
    // dropping them. They are now deliberately excluded: both are Kyro's own
    // prose, and matching keywords against them let the classifier's paraphrase
    // escalate words the customer never wrote. See paraphrased-triggers.test.ts.
    const detector = source.slice(
      source.indexOf("function detectUrgentEscalationTriggers"),
      source.indexOf("const triggers = new Set"),
    );

    assert.doesNotMatch(detector, /input\.summary/);
    assert.doesNotMatch(detector, /input\.title/);
    // input.content is the only field read. It is now narrowed further, to the
    // part the customer just wrote rather than the thread quoted beneath it --
    // the same principle applied twice. See paraphrased-triggers.test.ts.
    assert.match(
      detector,
      /const content = withoutQuotedReply\(input\.content\)\.toLowerCase\(\)/,
    );
  });
});
