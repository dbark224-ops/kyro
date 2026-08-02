import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Everything that can put words in front of a customer, and why it is allowed.
 *
 * Three assistant commands were found sending to customers without the owner
 * approving that specific message, and two of them acted on a refusal: "don't
 * send those yet" fired the path that approves and sends every pending reply,
 * and "reply to him but let me see it first" sent it first. They were fixed,
 * but they were found by asking "what can act autonomously?" -- not by testing
 * phrases -- and nothing stopped the next one appearing.
 *
 * So this is the answer to that question, written down and enforced. Every
 * module below can cause a message to leave the building. A new one appearing
 * fails this test, and whoever adds it has to say here why it is allowed to.
 *
 * This checks the SHAPE of the system, not the wording of any rule. It cannot
 * tell whether a router reads "don't send" correctly -- the phrase tests do
 * that -- but it can tell when a new door has been cut into the wall.
 */

const SEND_ENTRY_POINTS = [
  // The two primitives that actually hand a message to a provider.
  "sendTwilioSmsMessage",
  "sendConnectedEmailMessage",
  // The queue in front of them. Everything customer-facing goes through here.
  "recordOutboundMessage",
  "recordOutboundEventEmail",
  "recordOutboundDirectSms",
];

/**
 * Each entry is a promise about who is asking for the send.
 *
 * "owner" means a person pressed something or told Kyro to do it in words.
 * "approval engine" means the owner approved that specific action earlier.
 * "owner-facing" means the recipient is the owner, not a customer -- those
 * cannot embarrass anyone in front of a customer, so they are held to a lower
 * bar. "gated" means it is reachable by someone who is not the owner, and the
 * gate is named so it can be checked.
 */
const ALLOWED: Record<string, string> = {
  "app/api/integrations/twilio/whatsapp/route.ts":
    "owner-facing: the sandbox bridge replying to the owner's own messages",
  "app/api/integrations/vapi/tool/route.ts":
    "gated: vapiToolCanSendOutboundSms for trusted internal calls, and " +
    "vapiContactMatchesCallerNumber limits an external caller to texting " +
    "their own number",
  "app/api/mobile/inbox/[conversationId]/route.ts":
    "owner: the mobile inbox, behind requireMobileWorkspaceContext",
  "app/assistant/actions.ts": "owner: the assistant, acting on what he asked",
  "app/inbox/actions.ts": "owner: pressing send in the inbox",
  "lib/assistant/commands.ts":
    "owner: assistant command routers, which must honour a refusal",
  "lib/assistant/delivery-feedback.ts":
    "owner-facing: telling the owner a message of his failed to send",
  "lib/assistant/internal-messaging.ts":
    "owner-facing: Kyro's replies to the owner over SMS and WhatsApp",
  "lib/communication/outbound.ts":
    "the queue itself, and the only place the providers are called",
  "lib/engine/event-action-audit.ts":
    "approval engine: executes what the owner approved, and is the gate",
  "lib/escalation/urgent-escalation.ts":
    "owner-facing: waking the owner about an emergency",
  "lib/notifications/calendar-sms.ts":
    "owner-facing: appointment reminders to the owner",
  "lib/voice/inbound-inquiry-notifications.ts":
    "owner-facing: telling the owner an inquiry came in",
};

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("who can reach a customer", () => {
  it("is only the modules that have said why", () => {
    const found = new Map<string, string[]>();

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const used = SEND_ENTRY_POINTS.filter(
        (name) =>
          // A call, not merely a mention in a comment or an import list.
          new RegExp(`\\b${name}\\s*\\(`).test(source) &&
          // The module that declares it is not one of its callers.
          !new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(
            source,
          ),
      );

      if (used.length === 0) {
        continue;
      }

      const key = relative(SRC, file).replace(/\\/g, "/");

      found.set(key, used);
    }

    const undeclared = [...found.keys()].filter((file) => !(file in ALLOWED));

    assert.deepEqual(
      undeclared,
      [],
      `A new way to reach a customer appeared. Add it to ALLOWED with the ` +
        `reason it is allowed to send, or route it through the approval ` +
        `engine instead:\n  ${undeclared.join("\n  ")}`,
    );
  });

  it("has not quietly lost one either", () => {
    // A path disappearing is usually a rename, and a renamed send path is one
    // this test has stopped watching.
    const files = new Set(
      sourceFiles(SRC).map((file) => relative(SRC, file).replace(/\\/g, "/")),
    );
    const missing = Object.keys(ALLOWED).filter((file) => !files.has(file));

    assert.deepEqual(
      missing,
      [],
      `These were allowed to send and no longer exist. If one was renamed, ` +
        `follow it -- the new name is not being watched:\n  ${missing.join("\n  ")}`,
    );
  });

  it("keeps the providers behind the queue", () => {
    // The point of a single chokepoint is that usage, compliance, retries and
    // the audit trail all happen in one place. Calling a provider directly
    // skips every one of them.
    const directCallers = sourceFiles(SRC)
      .filter((file) => {
        const source = readFileSync(file, "utf8");

        return (
          /\b(sendTwilioSmsMessage|sendConnectedEmailMessage)\s*\(/.test(
            source,
          ) &&
          // twilio.ts and mail.ts declare these; declaring is not calling.
          !/export\s+async\s+function\s+(sendTwilioSmsMessage|sendConnectedEmailMessage)\b/.test(
            source,
          )
        );
      })
      .map((file) => relative(SRC, file).replace(/\\/g, "/"));

    // Only these three may talk to a provider without going through the queue,
    // and all three are owner-facing: alerts and reminders to the owner, which
    // must go out even when the queue is backed up.
    assert.deepEqual(directCallers.sort(), [
      "lib/communication/outbound.ts",
      "lib/escalation/urgent-escalation.ts",
      "lib/notifications/calendar-sms.ts",
    ]);
  });
});
