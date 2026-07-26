import { textValue } from "@kyro/core";

const CALL_MESSAGE_SOURCE = "vapi_post_call_automation";

export function voiceCallIdFromMessageMetadata(
  metadata: Record<string, unknown>,
) {
  return textValue(metadata.voiceCallId);
}

export function isVoiceCallMessage(metadata: Record<string, unknown>) {
  return Boolean(
    voiceCallIdFromMessageMetadata(metadata) ||
      textValue(metadata.providerCallId) ||
      textValue(metadata.source) === CALL_MESSAGE_SOURCE,
  );
}

export function voiceCallMessageBody(
  bodyText: string | null,
  metadata: Record<string, unknown>,
) {
  if (!bodyText || !isVoiceCallMessage(metadata)) {
    return bodyText;
  }

  const summaryOnly = bodyText
    .replace(/\s*\n+\s*Transcript:\s*[\s\S]*$/i, "")
    .trim();

  return summaryOnly || "Call completed. Open the call record for full details.";
}

export function buildVoiceCallInboxBody(note: string, summary: string | null) {
  return [note, summary ? `Summary: ${summary}` : null]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}
