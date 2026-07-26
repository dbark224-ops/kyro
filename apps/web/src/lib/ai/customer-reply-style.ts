export function isSmsLikeChannel(channel?: string | null) {
  const normalized = channel?.trim().toLowerCase();

  return normalized === "sms" || normalized === "whatsapp";
}

export function customerReplyConversationRules({
  channel,
  isFirstCustomerTurn,
}: {
  channel?: string | null;
  isFirstCustomerTurn?: boolean;
} = {}) {
  const isSms = isSmsLikeChannel(channel);

  // An SMS arrives with no subject line, no sender name and no signature block
  // appended by the delivery system, so the message body is the only thing
  // carrying that context. Email is the opposite: the configured signature is
  // appended after the model writes, and a sign-off in the body duplicates it.
  const conversationRule = isSms
    ? "Write every SMS so it stands on its own: open by addressing the customer, and close by signing off as the business. Keep both to a few words -- a text has no subject line and no signature block to carry that for you."
    : isFirstCustomerTurn === true
      ? "This is the first customer turn in the conversation. Write a complete customer-facing message: briefly greet or acknowledge them, answer the actual question directly, and finish with one short context-appropriate invitation to continue when useful."
      : isFirstCustomerTurn === false
        ? "This is an established conversation. Continue it naturally without restarting with a greeting or repeating a formal sign-off on every turn."
        : "Infer whether this is a first contact or an established exchange. Briefly greet or acknowledge a new customer, but continue an existing conversation without restarting it.";

  const channelRule = isSms
    ? "Nothing is appended to an SMS after you write it, so the greeting and sign-off must be in your text. Keep the whole message compact and vary the wording naturally. Write the sign-off as a short line naming the business -- never a full email signature, job title, phone number, address, or logo."
    : "Do not write your own sign-off. The delivery system appends the configured email signature after your text, so a sign-off here would duplicate it.";

  return [
    conversationRule,
    "For a direct business fact or other simple customer question, answer first, then naturally invite the customer to say what service or help they need when that would move the conversation forward.",
    "Do not force a sales question or generic invitation onto a complaint, emergency, refusal, completed exchange, or message where a different next step is clearly more appropriate.",
    "Choose the opening, invitation, and closing from the actual context. Do not use fixed stock wording or repeat the same canned lines across replies.",
    channelRule,
  ];
}
