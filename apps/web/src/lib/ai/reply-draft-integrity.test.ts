import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OWNER_REVIEW_MISSING_INFO,
  customerAnswerableMissingInfo,
  replyDraftMissingInfoGaps,
} from "./triage";
import { replyWritingPromptRules } from "../communication/settings";
import { DEFAULT_REPLY_WRITING_SETTINGS } from "../communication/settings";
import { readRepoFile } from "../testing/repo-files";

function facts(missingInfo: string[]) {
  return {
    address: null,
    budget: null,
    fit: "needs_review" as const,
    jobType: null,
    missingInfo,
    preferredTime: null,
    urgency: "normal" as const,
  };
}

/**
 * A live inquiry came back with an email asking the customer to "confirm this
 * is a serviceable inquiry" -- an internal qualification note, addressed to a
 * paying stranger.
 *
 * `missingInfo` does double duty. Most entries are genuinely missing customer
 * detail and the reply writer is handed the list so it knows what to ask for.
 * This one means "the owner should decide whether this lead is worth
 * servicing", and it travelled the same path.
 */
describe("owner notes do not reach the customer", () => {
  it("keeps the owner entry out of anything a customer reads", () => {
    const list = [OWNER_REVIEW_MISSING_INFO, "Job address", "Preferred time"];

    assert.deepEqual(customerAnswerableMissingInfo(list), [
      "Job address",
      "Preferred time",
    ]);
  });

  it("leaves the owner's own checklist intact", () => {
    // The inbox shows this to the owner, which is the one place it belongs.
    const list = [OWNER_REVIEW_MISSING_INFO, "Job address"];

    assert.equal(list.includes(OWNER_REVIEW_MISSING_INFO), true);
  });

  it("does not report it as a gap the draft failed to ask about", () => {
    // This is what drove it into the prose: the repair loop saw an unasked
    // "gap", handed it back to the model, and the only way to satisfy the
    // check was to write the phrase verbatim.
    const gaps = replyDraftMissingInfoGaps(
      {
        body: "Thanks for getting in touch. Could you send the job address?",
        subject: null,
      },
      facts([OWNER_REVIEW_MISSING_INFO, "Preferred time"]),
    );

    assert.equal(gaps.includes(OWNER_REVIEW_MISSING_INFO), false);
    assert.deepEqual(gaps, ["Preferred time"]);
  });

  it("still reports it as no gap when the draft is empty", () => {
    const gaps = replyDraftMissingInfoGaps(
      { body: "", subject: null },
      facts([OWNER_REVIEW_MISSING_INFO, "Job address"]),
    );

    assert.deepEqual(gaps, ["Job address"]);
  });

  it("does not echo an unrecognised label into customer wording", () => {
    // The phrase builder used to lowercase anything it did not recognise and
    // hand it over as something to ask for, so any label the model invented
    // became a literal demand on a customer.
    const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");
    const phraseFn = triage.slice(
      triage.indexOf("function missingInfoPhrase("),
      triage.indexOf("function missingInfoGapPhrases("),
    );

    assert.doesNotMatch(phraseFn, /return item\.toLowerCase\(\);/);
    assert.match(phraseFn, /return null;/);
  });
});

describe("a truncated model response does not read as a database failure", () => {
  const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");

  it("only blames the insert when the insert actually failed", () => {
    // A long inquiry overran the output ceiling, the JSON arrived cut off,
    // triage fell back to the stub, the stub wrote no reply body, nothing was
    // proposed -- and the operator was told "Unable to create AI proposed
    // action: unknown error". Every word of that pointed at the wrong layer.
    assert.match(
      triage,
      /if \(actionError\) \{\s*throw new Error\(\s*`Unable to create AI proposed action: \$\{actionError\.message\}`/,
    );
    assert.doesNotMatch(triage, /actionError\?\.message \?\? "unknown error"/);
  });

  it("says so plainly when there was nothing to propose", () => {
    assert.match(triage, /Triage proposed no actions for event/);
    assert.match(triage, /truncated or unparsed model response/);
  });

  it("survives having proposed nothing", () => {
    // Making it non-fatal moved the crash downstream: primaryAction would be
    // undefined and the next line read .id off it.
    assert.match(triage, /for \(const action of actions \?\? \[\]\)/);
    assert.match(triage, /actions\?\.find\(/);
    assert.match(triage, /if \(knownFactAutoReply && primaryAction\)/);
  });

  it("leaves the ceiling high enough for a long inquiry", () => {
    // The reply body travels inside the JSON, so the ceiling has to cover the
    // whole object. A ceiling is not a target -- output is billed on what is
    // generated, so headroom is free on a short inquiry.
    const cap = triage.match(
      /OPENAI_TRIAGE_MAX_OUTPUT_TOKENS[\s\S]{0,140}?: (\d+);/,
    );

    assert.ok(cap, "the triage output ceiling should be findable");
    assert.ok(
      Number(cap[1]) >= 1200,
      `700 truncated a real inquiry; found ${cap[1]}`,
    );
  });
});

describe("the writer is told which medium it is composing", () => {
  const settings = DEFAULT_REPLY_WRITING_SETTINGS;

  it("says email when the channel is email", () => {
    const rules = replyWritingPromptRules(settings, "email").join("\n");

    assert.match(rules, /You are composing an email/);
    assert.match(rules, /subject line/);
  });

  it("says text message when the channel is SMS or WhatsApp", () => {
    for (const channel of ["sms", "whatsapp"]) {
      const rules = replyWritingPromptRules(settings, channel).join("\n");

      assert.match(rules, /You are composing a text message/, channel);
      assert.match(rules, /no subject line/, channel);
    }
  });

  it("states the medium rather than leaving it to a sign-off rule", () => {
    // The channel already reached this function, but only to choose between
    // two sign-off lines. A draft came back promising to "reply by email" --
    // written by a model that did not know it was already writing one.
    const emailRules = replyWritingPromptRules(settings, "email");
    const smsRules = replyWritingPromptRules(settings, "sms");

    assert.ok(
      emailRules.some((rule) => rule.startsWith("You are composing")),
      "the medium must be stated outright",
    );
    assert.ok(smsRules.some((rule) => rule.startsWith("You are composing")));
  });
});

describe("a draft asked for by name is quoted, not summarised", () => {
  const providers = readRepoFile("apps/web/src/lib/assistant/providers.ts");

  it("requires word-for-word quoting", () => {
    // Asked over SMS what a draft said, Kyro returned a paraphrase that
    // differed from what was actually sent -- and the wording it dropped was
    // the line the owner would have rejected. A summary at the moment of
    // approval defeats the approval.
    assert.match(providers, /quote it word for word/);
    assert.match(providers, /Do not paraphrase, tidy, shorten or improve it/);
  });

  it("lets the quote outrank the length budget", () => {
    assert.match(providers, /even to fit the length budget above/);
    assert.match(providers, /may use all three texts/);
  });

  it("says so out loud when it truly cannot fit", () => {
    assert.match(providers, /rather than silently condensing it/);
  });

  it("still keeps the surrounding prose short", () => {
    assert.match(providers, /budget still applies to everything else/);
  });
});
