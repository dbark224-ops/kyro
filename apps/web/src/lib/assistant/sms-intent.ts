import { normalized } from "./prompt-text";

/**
 * Reading a direct-SMS request out of a prompt.
 *
 * Lifted verbatim out of commands.ts: recognising "text Dave that I'm running
 * late" and pulling the message out of it. The command that resolves the
 * recipient and sends stayed behind.
 */

/**
 * Talking about a text is not asking for one to be sent.
 *
 * "Text" is both the verb and the noun, so every clause naming a text and a
 * team member satisfied all four conditions below. Eight of ten ordinary
 * sentences routed here, including "did the team member text back yet", "no
 * text from any team member today" and "don't text the team member yet".
 *
 * Nothing was sent -- no body can be extracted from any of them, so the
 * command asks what the message should say. But this runs BEFORE the planner,
 * so the owner's actual question never reaches the model: they ask whether
 * somebody replied and are asked what they would like to send.
 */
// The interrogatives are anchored to the start on purpose. A first attempt
// matched them anywhere and broke a real instruction -- "can you send the
// workplace contact an sms, i want to test if that functionality IS working"
// -- because "is" turns up in plenty of sentences that are still commands.
// A question about a text opens with the question word; a command does not.
const NOT_A_SEND_INSTRUCTION =
  /\b(?:text|sms|message)s?\s+(?:from|back)\b|\btexted\b|^(?:did|does|has|have|had|why|when|who|whose|was|were|should|is|are)\b|\b(?:no|not|never|do\s?n\s?t|did\s?n\s?t|ca\s?n\s?t|wo\s?n\s?t)\s+(?:text|send|sms)\b/;

export function looksLikeDirectWorkplaceSmsRequest(prompt: string) {
  const text = normalized(prompt);

  if (NOT_A_SEND_INSTRUCTION.test(text)) {
    return false;
  }

  const hasSendInstruction = /\b(send|text)\b/.test(text);
  const hasSmsChannel = /\b(sms|text|text message)\b/.test(text);
  const hasContactTarget =
    /\b(contact|team member|staff member|employee)\b/.test(text);
  const hasInternalQualifier =
    /\b(workplace|team|staff|internal|escalation)\b/.test(text);
  const hasWorkplaceTarget = hasContactTarget && hasInternalQualifier;

  return hasSendInstruction && hasSmsChannel && hasWorkplaceTarget;
}

export function cleanSmsBody(value: string) {
  return value
    .trim()
    .replace(/^[\s"'“”‘’:,;-]+/, "")
    .replace(/[\s"'“”‘’]+$/, "")
    .trim();
}

export function assistantSmsBodyFromPrompt(prompt: string) {
  const explicitBodyPatterns = [
    /\b(?:saying|that says|with (?:the )?(?:message|text))\s*[:,-]?\s*(.+)$/i,
    /\b(?:sms|text message)\s*[:-]\s*(.+)$/i,
  ];

  for (const pattern of explicitBodyPatterns) {
    const match = prompt.match(pattern);
    const body = match?.[1] ? cleanSmsBody(match[1]) : "";

    if (body) {
      return body;
    }
  }

  if (/\btest(?:ing)?\b/i.test(prompt)) {
    return "This is a test SMS from Kyro.";
  }

  return null;
}
