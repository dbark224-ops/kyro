export function customerReplyConversationRules({
  channel,
  isFirstCustomerTurn,
}: {
  channel?: string | null;
  isFirstCustomerTurn?: boolean;
} = {}) {
  const conversationRule =
    isFirstCustomerTurn === true
      ? "This is the first customer turn in the conversation. Write a complete customer-facing message: briefly greet or acknowledge them, answer the actual question directly, and finish with one short context-appropriate invitation to continue when useful."
      : isFirstCustomerTurn === false
        ? "This is an established conversation. Continue it naturally without restarting with a greeting or repeating a formal sign-off on every turn."
        : "Infer whether this is a first contact or an established exchange. Briefly greet or acknowledge a new customer, but continue an existing conversation without restarting it.";
  const channelRule =
    channel?.toLowerCase() === "sms"
      ? "For SMS, keep the complete response compact. On first contact, include a short natural business sign-off unless the message context makes one inappropriate, but do not paste a full email signature."
      : "Follow the configured sign-off behavior and avoid duplicating a signature that the delivery system appends separately.";

  return [
    conversationRule,
    "For a direct business fact or other simple customer question, answer first, then naturally invite the customer to say what service or help they need when that would move the conversation forward.",
    "Do not force a sales question or generic invitation onto a complaint, emergency, refusal, completed exchange, or message where a different next step is clearly more appropriate.",
    "Choose the opening, invitation, and closing from the actual context. Do not use fixed stock wording or repeat the same canned lines across replies.",
    channelRule,
  ];
}
