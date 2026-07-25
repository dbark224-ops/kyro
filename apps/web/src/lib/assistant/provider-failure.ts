export const ASSISTANT_PROVIDER_UNAVAILABLE_MESSAGE =
  "I couldn't process that request right now, so nothing was actioned. Please try again shortly.";

export function assistantContentAfterModel({
  exactAnswer,
  fallbackReason,
  modelText,
}: {
  exactAnswer?: string | null;
  fallbackReason?: string | null;
  modelText: string;
}) {
  if (exactAnswer) {
    return exactAnswer;
  }

  if (fallbackReason) {
    return ASSISTANT_PROVIDER_UNAVAILABLE_MESSAGE;
  }

  return modelText;
}
