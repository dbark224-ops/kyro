export function isSmsLikeChannel(channel?: string | null) {
  const normalized = channel?.trim().toLowerCase();

  return normalized === "sms" || normalized === "whatsapp";
}

/**
 * Undefined rather than `true` when the count is unknown, so the prompt says
 * "work it out from the context" instead of confidently asserting a first
 * contact and re-introducing the business mid-thread.
 */
export function firstCustomerTurnFromCount(threadMessageCount?: number | null) {
  return typeof threadMessageCount === "number"
    ? threadMessageCount <= 1
    : undefined;
}

export function firstCustomerTurnFromThread(thread?: unknown) {
  return Array.isArray(thread) && thread.length > 0
    ? thread.length <= 1
    : undefined;
}

/**
 * What a text message has to carry, and when.
 *
 * An SMS has no subject line, no sender name and no signature block appended by
 * the delivery system, so a first message must identify the business itself.
 * That need does not survive the first exchange: once the customer has replied,
 * they know who they are texting, and re-greeting and re-signing every message
 * in a live back-and-forth reads like a robot, not a tradesperson.
 *
 * Email is the opposite case throughout -- the configured signature is appended
 * after the model writes, so a sign-off in the body duplicates it.
 */
export function smsSignOffRule(isFirstCustomerTurn?: boolean) {
  if (isFirstCustomerTurn === true) {
    return "Sign-off: this is the first text from an unknown number, so it must say who it is. Open by addressing the customer and close with a short sign-off naming the business. Nothing is appended to an SMS, so both have to be in your text.";
  }

  if (isFirstCustomerTurn === false) {
    return "Sign-off: this text thread is already underway and the customer knows who they are texting. Reply the way a person would mid-conversation -- no greeting, no repeated sign-off, just the answer.";
  }

  return "Sign-off: nothing is appended to an SMS. If this is a first contact, open by addressing the customer and close with a short sign-off naming the business; if the thread is already underway, reply naturally without repeating either.";
}

export function customerReplyConversationRules({
  channel,
  isFirstCustomerTurn,
}: {
  channel?: string | null;
  isFirstCustomerTurn?: boolean;
} = {}) {
  const isSms = isSmsLikeChannel(channel);

  const conversationRule = isSms
    ? isFirstCustomerTurn === true
      ? "This is the first text the customer has had from this number, so the message has to identify itself: briefly address them, answer directly, and close with a short sign-off naming the business. Keep all of it to a few words."
      : isFirstCustomerTurn === false
        ? "This is an established text thread. The customer already knows who they are talking to, so continue it like a normal conversation: no greeting, no sign-off, just the reply."
        : "Infer whether this is a first text or an established thread. Identify the business with a brief greeting and short sign-off on first contact, and continue an existing thread without repeating either."
    : isFirstCustomerTurn === true
      ? "This is the first customer turn in the conversation. Write a complete customer-facing message: briefly greet or acknowledge them, answer the actual question directly, and finish with one short context-appropriate invitation to continue when useful."
      : isFirstCustomerTurn === false
        ? "This is an established conversation. Continue it naturally without restarting with a greeting or repeating a formal sign-off on every turn."
        : "Infer whether this is a first contact or an established exchange. Briefly greet or acknowledge a new customer, but continue an existing conversation without restarting it.";

  const channelRule = isSms
    ? "Keep the whole text compact and vary the wording naturally. Where a sign-off belongs, write it as a short line naming the business -- never a full email signature, job title, phone number, address, or logo."
    : "Do not write your own sign-off. The delivery system appends the configured email signature after your text, so a sign-off here would duplicate it.";

  return [
    conversationRule,
    "For a direct business fact or other simple customer question, answer first, then naturally invite the customer to say what service or help they need when that would move the conversation forward.",
    "Do not force a sales question or generic invitation onto a complaint, emergency, refusal, completed exchange, or message where a different next step is clearly more appropriate.",
    "Choose the opening, invitation, and closing from the actual context. Do not use fixed stock wording or repeat the same canned lines across replies.",
    channelRule,
  ];
}
