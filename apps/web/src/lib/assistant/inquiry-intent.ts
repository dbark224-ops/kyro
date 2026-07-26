import type { ConversationListItem } from "../crm/queries";
import {
  conversationDisplayName,
  conversationJobLabel,
  recentWorkQueueConversationIds,
} from "./conversation-links";
import { normalized } from "./prompt-text";
import type { AssistantRecentMessage } from "./types";

/**
 * Working out which inquiry the user is talking about, and how to describe it.
 *
 * Lifted verbatim out of commands.ts. Resolving "reply to that one" against the
 * conversation the assistant last mentioned is the fiddly part, and it is pure
 * matching over recent messages with no database access. The commands that act
 * on the resolved inquiry stayed behind.
 */

export function looksLikeInquiryAvailabilityOfferRequest(prompt: string) {
  const text = normalized(prompt);

  return (
    /\b(offer|propose|suggest)\b.{0,60}\b(time|slot|availability)\b/.test(
      text,
    ) ||
    /\b(time|slot)\b.{0,50}\b(free|available)\b/.test(text) ||
    /\bcheck\b.{0,40}\bavailability\b/.test(text)
  );
}

export function looksLikeContextualInquiryReplyRequest(
  prompt: string,
  recentMessages: readonly AssistantRecentMessage[] = [],
) {
  if (
    recentWorkQueueConversationIds(recentMessages, {
      maxAgeMs: 30 * 60 * 1000,
    }).length === 0
  ) {
    return false;
  }

  const text = normalized(prompt);
  const asksForAdvice =
    /\b(what|how)\s+(?:should|would|could)\s+(?:i|we)\s+(?:reply|respond|say)\b/.test(
      text,
    );

  if (asksForAdvice || /\b(draft|prepare|suggest)\b/.test(text)) {
    return false;
  }

  return (
    /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:reply|respond|email|message|write back|tell)\b/.test(
      text,
    ) ||
    /^(?:please\s+)?(?:reply|respond|email|message|write back|tell)\b/.test(
      text,
    ) ||
    /\b(?:reply|respond)\s+for\s+(?:me|us)\b/.test(text)
  );
}

export function recentInquiryConversationForPrompt({
  conversationIds,
  conversations,
  prompt,
}: {
  conversationIds: string[];
  conversations: Array<Pick<ConversationListItem, "contactName" | "id">>;
  prompt: string;
}) {
  const order = new Map(
    conversationIds.map((conversationId, index) => [conversationId, index]),
  );
  const available = conversations
    .filter((conversation) => order.has(conversation.id))
    .sort(
      (left, right) =>
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  const promptText = normalized(prompt);
  const namedMatches = available.filter((conversation) => {
    const contactName = normalized(conversation.contactName ?? "");
    const emailLocalPart = conversation.contactName?.includes("@")
      ? normalized(conversation.contactName.split("@")[0] ?? "")
      : "";

    return (
      (contactName.length > 1 && promptText.includes(contactName)) ||
      (emailLocalPart.length > 2 && promptText.includes(emailLocalPart))
    );
  });

  if (namedMatches.length > 1) {
    return {
      ambiguous: true,
      conversationId: null,
      matches: namedMatches.map((conversation) => conversation.id),
    };
  }

  return {
    ambiguous: false,
    conversationId: namedMatches[0]?.id ?? available[0]?.id ?? null,
    matches: namedMatches.map((conversation) => conversation.id),
  };
}

export function replyStatusForConversation(conversation: ConversationListItem) {
  if (
    conversation.workflowBucket === "awaiting_customer" ||
    conversation.status === "replied" ||
    conversation.latestDirection === "outbound"
  ) {
    return "replied";
  }

  if (
    conversation.pendingApprovalCount > 0 ||
    conversation.status === "reply_drafted"
  ) {
    return "draft_waiting_approval";
  }

  if (conversation.latestDirection === "inbound") {
    return "needs_reply";
  }

  return "not_applicable";
}

export function assistantInquiryMessage(value: string | null) {
  const text = value?.trim();

  if (!text) {
    return null;
  }

  return text.length > 4_000 ? `${text.slice(0, 3_997)}...` : text;
}

export function inquiryRecordForAssistant(
  conversation: ConversationListItem,
) {
  return {
    customer: conversationDisplayName(conversation),
    inquiryMessage: assistantInquiryMessage(conversation.originalInquiryBody),
    job: conversationJobLabel(conversation),
    latestMessage: assistantInquiryMessage(conversation.latestBody),
    latestMessageDirection: conversation.latestDirection,
    nextAction: conversation.nextActionLabel,
    operatorSummary: inquiryStatusSummary(conversation),
    replyStatus: replyStatusForConversation(conversation),
    senderAddress: conversation.senderAddress,
    status: conversation.status,
    subject: conversation.latestSubject,
    workflowBucket: conversation.workflowBucket,
  };
}

export function inquiryLookupFallbackAnswerForAssistant(
  conversation: ConversationListItem,
) {
  const message = assistantInquiryMessage(
    conversation.originalInquiryBody ?? conversation.latestBody,
  );

  if (!message) {
    return `${inquiryStatusSummary(conversation)} Open the inquiry below if you want to review or action it.`;
  }

  const compactMessage = message.replace(/\s+/g, " ").trim();
  const displayedMessage =
    compactMessage.length > 700
      ? `${compactMessage.slice(0, 697)}...`
      : compactMessage;

  return `The inquiry says: "${displayedMessage}" ${inquiryStatusSummary(conversation)}`;
}

export function inquiryStatusSummary(conversation: ConversationListItem) {
  const customer = conversationDisplayName(conversation);
  const job = conversationJobLabel(conversation);

  if (conversation.workflowBucket === "awaiting_customer") {
    return `The ${customer} inquiry is waiting on the customer. A reply has already been recorded, so the next move is to wait for their response or follow up later.`;
  }

  if (conversation.workflowBucket === "follow_up_due") {
    return `The ${customer} inquiry is due for an internal follow-up. A reply was recorded earlier and the configured follow-up delay has passed.`;
  }

  if (conversation.workflowBucket === "resolved") {
    return `The ${customer} inquiry is marked resolved. The recorded job is ${job}.`;
  }

  if (
    conversation.pendingApprovalCount > 0 ||
    conversation.status === "reply_drafted"
  ) {
    return `The ${customer} inquiry is waiting on you. A draft reply is ready, but it has not been approved or sent yet.`;
  }

  if (conversation.workflowBucket === "missing_info") {
    const missingInfo = conversation.inquiryFacts?.missingInfo.join(", ");

    return `The ${customer} inquiry needs a reply asking for missing details${missingInfo ? `: ${missingInfo}` : ""}.`;
  }

  if (conversation.workflowBucket === "ready_to_quote") {
    return `The ${customer} inquiry is ready for quote work. The recorded job is ${job}.`;
  }

  if (conversation.workflowBucket === "site_visit_needed") {
    return `The ${customer} inquiry looks like it needs a site visit or booking plan. The recorded job is ${job}.`;
  }

  if (conversation.workflowBucket === "needs_review") {
    return `The ${customer} inquiry needs review before Kyro treats it as ready to action. The recorded job is ${job}.`;
  }

  if (conversation.latestDirection === "inbound") {
    return `The ${customer} inquiry has an inbound message and still needs a reply.`;
  }

  return `The ${customer} inquiry is currently ${conversation.nextActionLabel.toLowerCase()}. The recorded job is ${job}.`;
}
