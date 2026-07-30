import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * A trigger that was switched on and could never fire.
 *
 * "Repeat contact pressure" is default-enabled and described to the owner as
 * "the same person tries multiple channels or contacts repeatedly within a
 * short window". detectUrgentEscalationTriggers reads
 * metadata.repeatContact to decide it -- and a search of the entire repository
 * found that flag being read in exactly one place and written in none.
 *
 * So every workspace has had it enabled, and no inquiry has ever escalated on
 * it. Found while checking why repeat_contact_short_window had no rows: the
 * same "has this ever run" shape as the escalation alert that went its whole
 * life without executing.
 */
const helper = readRepoFile("apps/web/src/lib/crm/repeat-contact.ts");

describe("repeat contact is actually detected", () => {
  it("counts inbound messages from the contact, not the thread", () => {
    // Someone who emailed, heard nothing and has now texted is the case the
    // trigger describes, so it cannot be scoped to one conversation.
    assert.match(helper, /\.eq\("contact_id", input\.contactId\)/);
    assert.match(helper, /\.eq\("direction", "inbound"\)/);
    assert.doesNotMatch(helper, /conversation_id/);
  });

  it("bounds the window", () => {
    assert.match(helper, /REPEAT_CONTACT_WINDOW_MINUTES = 30/);
    assert.match(helper, /\.gte\("created_at", since\)/);
  });

  it("only counts messages the business has not answered", () => {
    // Caught by the harness on the scenario where a customer accepts a
    // proposed time: the reply escalated as repeat contact pressure because
    // any two inbound messages in the window counted, conversation included.
    // Pressure means going unanswered.
    assert.match(helper, /\.eq\("direction", "outbound"\)/);
    assert.match(helper, /const unansweredSince = lastOutbound\?\.created_at/);
    assert.match(helper, /\.gt\("created_at", unansweredSince\)/);
  });

  it("needs a second message, not just this one", () => {
    // The triggering message is saved before escalation is evaluated, so one
    // inbound message is the first contact counting itself.
    assert.match(helper, />= 2/);
  });

  it("does not count an unidentified sender as a repeat", () => {
    assert.match(helper, /if \(!input\.contactId\) \{\s*return false;/);
  });

  it("degrades to false rather than failing the inbound message", () => {
    // A missed trigger is worse than a slow one; an inbound message lost
    // because a supporting count failed would be worse than both.
    assert.match(helper, /console\.warn\("Repeat-contact lookup failed"/);
  });
});

describe("both inbound paths set the flag", () => {
  for (const [label, path] of [
    ["email", "apps/web/src/lib/integrations/inbound-email-sync.ts"],
    ["sms and manual", "apps/web/src/lib/inbound/manual.ts"],
  ] as const) {
    it(`${label} passes repeatContact into the escalation`, () => {
      const source = readRepoFile(path);

      assert.match(source, /repeatContact: await hasRepeatContactPressure\(/);
      assert.match(source, /from "\.\.\/crm\/repeat-contact"/);
    });
  }

  it("is still the flag the detector reads", () => {
    const escalation = readRepoFile(
      "apps/web/src/lib/escalation/urgent-escalation.ts",
    );

    assert.match(escalation, /boolValue\(input\.metadata\?\.repeatContact\)/);
    assert.match(escalation, /triggers\.add\("repeat_contact_short_window"\)/);
  });
});
