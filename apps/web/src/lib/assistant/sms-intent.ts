import { normalized } from "./prompt-text";

/**
 * Reading a direct-SMS request out of a prompt.
 *
 * Lifted verbatim out of commands.ts: recognising "text Dave that I'm running
 * late" and pulling the message out of it. The command that resolves the
 * recipient and sends stayed behind.
 */

export function looksLikeDirectWorkplaceSmsRequest(prompt: string) {
  const text = normalized(prompt);
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
