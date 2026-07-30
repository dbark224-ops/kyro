import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInboundInquiryNotificationBody,
  inboundInquiryAlertRules,
} from "./inbound-inquiry-notifications";
import { readRepoFile } from "../testing/repo-files";

/**
 * An alert arrived reading "...a slowly worsening damp patc...".
 *
 * Two faults stacked. The generation was required to reproduce a 92-character
 * Kyro link verbatim, so one wrong character in two attempts threw the whole
 * thing away and dropped to the code-built fallback -- which is why an alert
 * that should never be templated was one. And that fallback cut the summary at
 * exactly 190 characters wherever that landed, mid-word.
 *
 * The fallback still exists, because losing the alert entirely is worse. It
 * just has to stop looking broken when it runs.
 */
const LONG_SUMMARY =
  "Warrick got in touch about a bathroom that has been leaking since the winter, " +
  "with water staining the ceiling of the room below and tiles lifting near the " +
  "shower tray. They also report a slowly worsening damp patch on the hallway wall " +
  "that they think is related, and they would like it looked at before the weekend.";

function summaryLineOf(body: string) {
  const line = body.split("\n").find((entry) => entry.startsWith("Summary: "));

  assert.ok(line, "the alert should carry a summary line");

  return line.slice("Summary: ".length);
}

/**
 * The exact failure was "damp patc...", a prefix of "patch". Whatever the last
 * word turns out to be, it has to be a word the customer actually wrote --
 * checking only that the string ends in "..." would have passed on the bug.
 */
function assertEndsOnAWholeWord(summary: string, source: string) {
  assert.ok(summary.endsWith("..."), "a shortened summary should say so");

  const lastWord = summary.slice(0, -3).trim().split(" ").at(-1);

  assert.ok(lastWord);
  assert.match(
    source,
    new RegExp(`\\b${lastWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
    `"${lastWord}" is not a whole word from the summary`,
  );
}

describe("the fallback alert never cuts a word in half", () => {
  it("ends on a whole word", () => {
    const body = buildInboundInquiryNotificationBody({
      channel: "email",
      contactName: "Warrick",
      conversationId: "11111111-2222-3333-4444-555555555555",
      summary: LONG_SUMMARY,
    });

    assertEndsOnAWholeWord(summaryLineOf(body), LONG_SUMMARY);
  });

  it("would have failed on the message that was actually sent", () => {
    // Guards the guard. If assertEndsOnAWholeWord ever stops catching a
    // mid-word cut, this notices before the next alert does.
    assert.throws(() =>
      assertEndsOnAWholeWord(
        "They also report a slowly worsening damp patc...",
        LONG_SUMMARY,
      ),
    );
  });

  it("does not shorten a summary that already fits", () => {
    const summary = "Warrick wants a quote for a leaking shower.";
    const body = buildInboundInquiryNotificationBody({
      channel: "email",
      contactName: "Warrick",
      summary,
    });

    assert.ok(body.includes(summary));
    assert.ok(!body.includes("..."));
  });

  it("shortens the owner-question variant on a word boundary too", () => {
    // Two call sites, one shortener. This is the branch a missing-fact inquiry
    // takes, and it was cutting the same way.
    const body = buildInboundInquiryNotificationBody({
      channel: "email",
      contactName: "Warrick",
      ownerQuestion: "Do we cover that postcode?",
      summary: LONG_SUMMARY,
    });

    assertEndsOnAWholeWord(summaryLineOf(body), LONG_SUMMARY);
  });
});

describe("the Kyro link is appended, not demanded of the model", () => {
  const notifications = readRepoFile(
    "apps/web/src/lib/voice/inbound-inquiry-notifications.ts",
  );

  it("does not require the link verbatim", () => {
    // mustInclude throws the entire generation away when the model fumbles a
    // character. For a URL ending in a UUID that is a coin flip, and losing it
    // means the owner reads a template.
    assert.match(notifications, /mustInclude: \[\],/);
  });

  it("appends the link after the model has written", () => {
    // It is no longer concatenated onto the body: doing that let the splitter
    // break at the space after "Open in Kyro:" and send the URL as its own
    // bare text. The footer is carried separately and attached past the split.
    assert.match(notifications, /const linkFooter = `\\nOpen in Kyro: \$\{kyroLink\}`/);
    assert.match(notifications, /footer: linkFooter,/);
    assert.match(notifications, /withLinkFooter\(/);
  });

  it("never leaves a part that is only a link", () => {
    assert.match(notifications, /function withLinkFooter\(/);
    assert.match(notifications, /return \[\.\.\.parts\.slice\(0, -1\), combined\]/);
  });

  it("keeps the link out of the facts the model writes from", () => {
    const contextFacts = notifications.slice(
      notifications.indexOf("contextFacts: {"),
      notifications.indexOf("mustInclude: [],"),
    );

    assert.doesNotMatch(contextFacts, /kyroLink/);
  });

  it("tells the model a link is coming so it writes no URL of its own", () => {
    const rules = inboundInquiryAlertRules().join("\n");

    assert.match(rules, /A link to open the inquiry in Kyro is appended/);
    assert.match(rules, /do not write a URL yourself/);
  });

  it("no longer tells the model to end with the link it cannot see", () => {
    const rules = inboundInquiryAlertRules().join("\n");

    assert.doesNotMatch(rules, /End with the Kyro link/);
  });

  it("charges the footer against the model's character budget", () => {
    // Otherwise the model writes to the full two segments and the appended
    // link pushes every alert into a third.
    const withoutFooter = inboundInquiryAlertRules().join("\n");
    const withFooter = inboundInquiryAlertRules(106).join("\n");

    assert.match(withoutFooter, /Keep it under 306 characters/);
    assert.match(withFooter, /Keep it under 200 characters/);
  });
});
