import { fetchAiProvider } from "../http/fetch-with-timeout";
import type { AddressColumnUpdates } from "../addresses/types";
import { addressWorthLearning } from "../addresses/replace";
import {
  unverifiedAddressFields,
  verifyAddressText,
  type AddressVerificationCalls,
} from "../addresses/verify";
import { recordGoogleApiUsage } from "../usage/google";
import { selectModelRoute } from "@kyro/ai";
import { getInitialActionStatus } from "@kyro/api";
import type { ModelRouteRequest } from "@kyro/contracts";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { executeAction, insertAuditLog } from "../engine/event-action-audit";
import {
  DEFAULT_REPLY_WRITING_SETTINGS,
  getCommunicationSettings,
  replyWritingPromptRules,
  type ReplyWritingSettings,
} from "../communication/settings";
import {
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "../crm/identity";
import {
  calendarDateRangeFromPrompts,
  namesRuledOutDay,
  preferredTimeOfDayWindow,
  slotMatchesTimeOfDay,
} from "../assistant/calendar-intent";
import { getVoiceSettings } from "../assistant/voice-settings";
import {
  buildLlmUsageEvents,
  estimateTokens,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  openAiUsageFromTokenCounts,
  recordUsageEvents,
  usageEventTotals,
  type OpenAiTokenUsage,
} from "../usage/openai";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import { findWorkspaceAvailableSlots } from "../voice/inbound-booking";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import {
  applyInquiryFutureStepDecision,
  classifyFutureStepFallback,
  getActiveInquiryFutureStep,
  normalizeFutureStepDecision,
  upsertBusinessAnswerFutureStep,
  type ActiveFutureStepContext,
  type FutureStepDecision,
} from "../workflow/inquiry-future-steps";
import {
  customerReplyConversationRules,
  firstCustomerTurnFromCount,
} from "./customer-reply-style";
import { openAiLowCostModel, openAiReasoningRequest } from "./openai-models";
import { objectRecord, textValue } from "@kyro/core";

export type AiRunItem = {
  id: string;
  taskType: string;
  status: string;
  provider: string;
  model: string;
  actualCost: string | null;
  createdAt: string;
};

export type UsageLedgerItem = {
  id: string;
  service: string;
  usageType: string;
  quantity: string;
  costSnapshot: string;
  customerChargeSnapshot: string;
  currency: string;
  createdAt: string;
};

export type ModelRouteItem = {
  id: string;
  taskType: string;
  selectedProvider: string;
  selectedModel: string;
  decisionReason: string;
  createdAt: string;
};

export type StubAiTriageContext = {
  source?: string;
  sourceEventId?: string;
  contactId?: string;
  leadId?: string;
  conversationId?: string;
  messageId?: string;
  leadTitle?: string;
  serviceType?: string | null;
  contactAddress?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  defaultPhoneRegion?: PhoneRegion;
  inboundChannelType?: string | null;
  summary?: string;
  latestMessage?: string;
  threadMessageCount?: number;
  threadSummary?: string;
  futureStep?: ActiveFutureStepContext | null;
  inquiryFactsOverride?: InquiryFacts;
  publicBusinessFacts?: PublicBusinessFacts;
  replyWriting?: ReplyWritingSettings;
  /**
   * That this number is listed as somebody's second contact number.
   *
   * A contact can carry a partner's or an assistant's number. When they ring,
   * the voice agent is told whose number it is and may discuss that job. When
   * they TEXT, nothing looked it up -- measured: a PA texting from their saved
   * number became a new contact named "+15055550199", a complete stranger, and
   * Kyro had no basis to talk to them about the job they were calling about.
   *
   * Deliberately a context line and not an identity. The number is listed; the
   * person holding the handset is not verified, and the conversation stays
   * their own rather than being merged into the contact's history.
   */
  associatedContactContext?: string | null;
};

export const PUBLIC_BUSINESS_FACT_KEYS = [
  "businessName",
  "industry",
  "publicPhoneNumber",
  "publicEmail",
  "businessAddress",
  "serviceArea",
  "workingHours",
  "contactHours",
] as const;

export type PublicBusinessFactKey = (typeof PUBLIC_BUSINESS_FACT_KEYS)[number];

export type PublicBusinessFacts = Record<PublicBusinessFactKey, string>;

export type TriageResponseMode =
  | "known_business_fact"
  | "simple_business_message"
  | "tool_assisted_business_message"
  | "service_inquiry";

export type TriageResponsePolicy = {
  factKeys: PublicBusinessFactKey[];
  informationNeed: string | null;
  mode: TriageResponseMode;
  ownerQuestion: string | null;
  reason: string | null;
};

export type InquiryFacts = {
  jobType: string | null;
  address: string | null;
  preferredTime: string | null;
  urgency: "low" | "normal" | "urgent";
  budget: string | null;
  fit: "likely_fit" | "needs_review" | "not_fit";
  missingInfo: string[];
};

export type VerifiedInquiryAvailability = {
  endsAt: string;
  label: string;
  startsAt: string;
  timeZone: string;
};

function isPreferredTimeMissingInfo(value: string) {
  return value.trim().toLowerCase() === "preferred time";
}

export function shouldResolveAvailabilityForTriage(input: {
  inboundInquiryMode: string;
  preferredTime: string | null;
  responseMode: TriageResponseMode;
}) {
  return (
    input.responseMode === "service_inquiry" &&
    Boolean(input.preferredTime?.trim()) &&
    input.inboundInquiryMode !== "capture_notify"
  );
}

/**
 * A verified slot fills the timing gap. It does not become the customer's ask.
 *
 * preferredTime used to be overwritten with availability.label here, which made
 * one field mean two different things at different points in its life -- "what
 * the customer asked for" until the calendar was consulted, "what Kyro decided
 * to offer" afterwards -- and the second destroyed the first.
 *
 * That fed back on itself. The overwritten value is persisted to
 * inquiry_facts.preferred_time, handed back to triage as inquiryFactsOverride
 * when the owner regenerates, and parsed by calendarDateRangeFromPrompts as the
 * requested window: "Aug 3, 2026, 7:00 AM" resolves to a range covering only
 * 3 August. Kyro's answer became its next question and the window collapsed to
 * a single day, so an urgent leak was offered a slot five days out while the
 * next two working days sat empty.
 *
 * It also made every screen wrong -- the assistant console labels this field
 * "Preferred" -- and it erased the evidence of what was actually asked for.
 *
 * The slot lives in verifiedAvailability, which is structured and already
 * carried alongside these facts. Only the gap is closed here.
 */
export function inquiryFactsWithVerifiedAvailability(
  facts: InquiryFacts,
  availability: VerifiedInquiryAvailability,
): InquiryFacts {
  // A slot without a start is not a slot. Closing the timing gap on one would
  // tell the owner the question is answered when nothing was actually found.
  if (!availability.startsAt) {
    return facts;
  }

  return {
    ...facts,
    missingInfo: facts.missingInfo.filter(
      (item) => !isPreferredTimeMissingInfo(item),
    ),
  };
}

type ProposedActionInput = {
  type: string;
  targetType: string;
  targetId: string | null;
  input: Record<string, unknown>;
  policyReason: string;
};

type TriageDecision = {
  inquiryFacts: InquiryFacts;
  /**
   * The name the sender gave for themselves, or null.
   *
   * Deliberately NOT part of InquiryFacts. Those are the facts of the job, are
   * written to inquiry_facts, and are shown in the CRM's editable facts panel;
   * a name would appear there as a job detail, which it is not. This is about
   * the contact record instead, and only the ingest reads it.
   */
  customerName: string | null;
  futureStepDecision: FutureStepDecision;
  summary: string;
  replyDraft: {
    subject: string | null;
    body: string | null;
  };
  responsePolicy: TriageResponsePolicy;
  providerUsed: "stub" | "ollama" | "openai";
  fallbackReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  providerUsageId?: string;
  repairUsage?: ReplyRepairUsage[];
  tokenUsage?: OpenAiTokenUsage;
};

type ReplyRepairUsage = {
  inputTokens: number;
  model: string;
  outputTokens: number;
  providerUsageId?: string;
  source?: string;
  tokenUsage: OpenAiTokenUsage;
};

function normalizeResponsePolicy(value: unknown): TriageResponsePolicy {
  const policy = objectRecord(value);
  const factKeys = normalizeStringArray(policy.factKeys).filter(
    (key): key is PublicBusinessFactKey =>
      PUBLIC_BUSINESS_FACT_KEYS.includes(key as PublicBusinessFactKey),
  );

  return {
    factKeys: [...new Set(factKeys)],
    informationNeed: textValue(policy.informationNeed),
    mode:
      policy.mode === "known_business_fact"
        ? "known_business_fact"
        : policy.mode === "simple_business_message"
          ? "simple_business_message"
          : policy.mode === "tool_assisted_business_message"
            ? "tool_assisted_business_message"
            : "service_inquiry",
    ownerQuestion: textValue(policy.ownerQuestion),
    reason: textValue(policy.reason),
  };
}

const KNOWN_FACT_AUTO_REPLY_BLOCKED_PATTERN =
  /\b(?:price|pricing|cost|quote|estimate|discount|availability|available|appointment|book|booking|schedule|when can|come out|attend|accept|scope|can you do|complaint|refund|legal|regulat|licen[cs]|permit|emergency|urgent|asap|account|password|payment|invoice)\b/i;

const DIRECT_KNOWN_FACT_PATTERNS: Array<{
  key: PublicBusinessFactKey;
  patterns: RegExp[];
}> = [
  {
    key: "publicPhoneNumber",
    patterns: [
      /\b(?:give|send|provide|share|have|what(?:'s| is))\b.{0,40}\b(?:phone|telephone|contact)\s*(?:number)?\b/i,
      /\b(?:phone|telephone|contact)\s+number\b.{0,40}\b(?:call|reach|contact)\b/i,
      /\bnumber\s+(?:to|i can)\s+call\b/i,
      /\bhow (?:can|do) i (?:call|phone|reach|contact|ring) (?:you|the business|your team)\b/i,
      // Swept with the escalation triggers, same fault and same fix. "can I
      // have your number", "what number can I call you on", "is there a phone
      // number for you" and "how do I ring you" all missed.
      /\b(?:can|could) i (?:have|get)\b.{0,20}\bnumber\b/i,
      /\bwhat number\b.{0,20}\b(?:call|reach|ring)\b/i,
      /\bis there an?\b.{0,20}\bnumber\b/i,
      // Re-measured against phrasings these patterns were NOT written from,
      // which is the only honest version of this test. Ten of twenty missed,
      // the same shape as every other keyword rule here.
      /\bbest number\b/i,
      /\bnumber to (?:get hold of|reach|contact)\b/i,
      /\b(?:do|have)\s+you\s+(?:have|got)\s+a\s+(?:mobile|cell)\b/i,
      /\bwho (?:do|should) i (?:ring|call|phone)\b/i,
      // A third measurement, on words neither of the passes above was written
      // from. "What's your number?" -- the plainest form the question takes --
      // missed, because every pattern here wanted the word "phone" next to
      // "number", and nobody says "what's your phone number" when "what's your
      // number" will do.
      /\bwhat(?:'s| is)\s+your\s+(?:best\s+)?number\b/i,
      /\b(?:is there|have you got|do you have|got)\s+an?\s+(?:landline|mobile|cell)\b/i,
      /\b(?:landline|mobile|cell)\s+(?:number\s+)?(?:i|we)\s+can\b/i,
    ],
  },
  {
    key: "publicEmail",
    patterns: [
      /\b(?:give|send|provide|share|have|what(?:'s| is))\b.{0,40}\b(?:email|e-mail)(?:\s+address)?\b/i,
      /\bhow (?:can|do) i email (?:you|the business|your team)\b/i,
      /\b(?:can|could|should) i email\b/i,
      /\bwhat email\b/i,
      /\bis there an? (?:email|e-mail)\b/i,
      /\b(?:email|e-mail)(?:\s+address)? (?:i|to) (?:can |should )?(?:use|send)\b/i,
      /\bwhere (?:do|should|can) i send\b/i,
    ],
  },
  {
    key: "businessAddress",
    patterns: [
      /\b(?:what(?:'s| is)|give|send|provide|share)\b.{0,40}\b(?:business|office|shop|store)\s+address\b/i,
      /\bwhere (?:are you|is (?:the business|your office|your shop|your store)) located\b/i,
      // "what's your address" -- the commonest form of all -- needed the word
      // "business" in front of "address" and so never matched.
      /\bwhat(?:'s| is) your address\b/i,
      /\bwhere(?:'s| is) your (?:shop|store|office|yard|unit|workshop|premises)\b/i,
      /\bwhereabouts are you\b/i,
      /\bwhere are you based\b/i,
      // "you" is load-bearing. A customer writing "I've got a shop that needs
      // rewiring" is describing their own premises, not asking about yours.
      /\b(?:do|have)\s+you\s+(?:have|got)\s+an?\s+(?:shop|store|showroom|premises|yard|workshop|unit)\b/i,
    ],
  },
  {
    key: "serviceArea",
    patterns: [
      /\b(?:what|which|where)\b.{0,30}\b(?:areas?|suburbs?|cities|towns|locations?)\b.{0,30}\b(?:service|cover|work in|travel to)\b/i,
      /\b(?:service|coverage)\s+area\b/i,
      // Asked about a specific place rather than in the abstract, which is how
      // almost everyone asks. Only the two patterns above existed, so "do you
      // cover Albuquerque?" surfaced nothing -- and with no service area in
      // front of it the model answered "yes, we cover Albuquerque" for a
      // business whose area is Las Cruces, 225 miles away. A false statement
      // about the business, made to a customer, in the one path that exists to
      // prevent exactly that.
      //
      // Same failure as `can't` versus `cannot`: a pattern that matched one
      // phrasing and missed the ones people write.
      /\bdo(?:es)?\s+(?:you|your business|the business|they)\b.{0,20}\b(?:cover|service|serve|work in|come out to|travel to|get (?:out |over )?to|operate in)\b/i,
      /\b(?:are|do)\s+you\b.{0,20}\b(?:in|near|around|local to)\b.{0,20}\b(?:my|the|this)\b.{0,12}\b(?:area|region|part|town|city|suburb)\b/i,
      /\b(?:can|could|would)\s+(?:you|someone|anyone)\b.{0,24}\b(?:come out to|travel to|get (?:out |over )?to|reach)\b/i,
      /\b(?:in|within|inside)\s+your\s+(?:patch|area|range|radius|zone|region)\b/i,
      /\bhow far\b.{0,20}\b(?:do|will|can)\s+you\b.{0,12}\b(?:travel|go|come|drive)\b/i,
    ],
  },
  {
    key: "workingHours",
    patterns: [
      /\b(?:what(?:'s| are)|give|send|provide|share)\b.{0,30}\b(?:business|working|opening|open)\s+hours\b/i,
      /\bwhat time (?:do you|does the business) (?:open|close)\b/i,
      /\bwhat (?:hours|time)s? do you (?:work|open|start|finish)\b/i,
      /\bwhat are your hours\b/i,
      /\bwhen are you open\b/i,
      /\bare you open\b/i,
      /\bdo you (?:work|open)\b.{0,15}\b(?:weekends?|saturdays?|sundays?|evenings?|mornings?|bank holidays?)\b/i,
    ],
  },
  {
    key: "contactHours",
    patterns: [
      /\b(?:what(?:'s| are)|give|send|provide|share)\b.{0,30}\bcontact\s+hours\b/i,
      /\bwhen (?:can|should) i (?:call|contact|reach) (?:you|the business|your team)\b/i,
      /\b(?:good|best) time to (?:call|ring|reach|contact|phone)\b/i,
      /\bwhat time (?:can|should) i (?:call|ring|reach|contact|phone)\b/i,
    ],
  },
];

export function directKnownBusinessFactKeys(latestMessage: string) {
  const message = latestMessage.trim();

  if (!message || KNOWN_FACT_AUTO_REPLY_BLOCKED_PATTERN.test(message)) {
    return [] as PublicBusinessFactKey[];
  }

  return DIRECT_KNOWN_FACT_PATTERNS.filter(({ patterns }) =>
    patterns.some((pattern) => pattern.test(message)),
  ).map(({ key }) => key);
}

function normalizedFactText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function replyContainsBusinessFact(
  replyBody: string,
  key: PublicBusinessFactKey,
  value: string,
) {
  if (key === "publicPhoneNumber") {
    const factDigits = value.replace(/\D/g, "");
    const replyDigits = replyBody.replace(/\D/g, "");

    return factDigits.length >= 7 && replyDigits.includes(factDigits);
  }

  if (key === "publicEmail") {
    return replyBody.toLowerCase().includes(value.trim().toLowerCase());
  }

  const normalizedValue = normalizedFactText(value);

  return (
    normalizedValue.length >= 3 &&
    normalizedFactText(replyBody).includes(normalizedValue)
  );
}

export function canAnswerWithKnownBusinessFacts(input: {
  publicBusinessFacts: PublicBusinessFacts;
  replyBody: string | null;
  responsePolicy: TriageResponsePolicy;
}) {
  const replyBody = textValue(input.replyBody);

  if (
    input.responsePolicy.mode !== "known_business_fact" ||
    !replyBody ||
    input.responsePolicy.factKeys.length === 0
  ) {
    return false;
  }

  return input.responsePolicy.factKeys.every((key) => {
    const fact = textValue(input.publicBusinessFacts[key]);

    return Boolean(fact && replyContainsBusinessFact(replyBody, key, fact));
  });
}

export function canAutoReplyWithKnownBusinessFacts(input: {
  enabled: boolean;
  fallbackReason?: string;
  latestMessage: string;
  providerUsed: TriageDecision["providerUsed"];
  publicBusinessFacts: PublicBusinessFacts;
  replyBody: string | null;
  responsePolicy: TriageResponsePolicy;
}) {
  if (
    !input.enabled ||
    input.providerUsed === "stub" ||
    input.fallbackReason ||
    KNOWN_FACT_AUTO_REPLY_BLOCKED_PATTERN.test(input.latestMessage)
  ) {
    return false;
  }

  return canAnswerWithKnownBusinessFacts(input);
}

function publicBusinessFactsFromProfile(
  profile: Awaited<
    ReturnType<typeof getWorkspaceGeneralSettings>
  >["businessProfile"],
): PublicBusinessFacts {
  return {
    businessAddress: profile.businessAddress.trim(),
    businessName: profile.businessName.trim(),
    contactHours: profile.contactHours.trim(),
    industry: profile.industry.trim(),
    publicEmail: profile.publicEmail.trim(),
    publicPhoneNumber: profile.publicPhoneNumber.trim(),
    serviceArea: profile.serviceArea.trim(),
    workingHours: profile.workingHours.trim(),
  };
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function titleCaseJobType(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[a-zA-Z][a-zA-Z'/-]*/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) {
      return word;
    }

    return word
      .split(/([/-])/)
      .map((part) =>
        part === "/" || part === "-"
          ? part
          : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
      )
      .join("");
  });
}

function stripLeadTitleSuffix(value: string) {
  return value
    .replace(/\s+(?:enquiry|inquiry|request)\s+from\s+.+$/i, "")
    .replace(/\s+from\s+.+$/i, "")
    .trim();
}

function isGenericJobType(value: string | null) {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();

  return [
    /^(?:new\s+)?(?:enquiry|inquiry|lead|message|request)(?:\s+from\s+.+)?$/,
    /^(?:quote\s+)?(?:enquiry|inquiry|request)(?:\s+from\s+.+)?$/,
    /^(?:manual\s+)?inbound(?:\s+(?:enquiry|inquiry))?(?:\s+from\s+.+)?$/,
    /^new\s+(?:enquiry|inquiry)\s+from\s+.+$/,
  ].some((pattern) => pattern.test(normalized));
}

function normalizeJobTypeCandidate(value: string | null) {
  const titled = titleCaseJobType(value);

  if (!titled) {
    return null;
  }

  const stripped = titleCaseJobType(stripLeadTitleSuffix(titled));

  if (!stripped || isGenericJobType(stripped)) {
    return null;
  }

  return stripped;
}

function quoteAwareLabel(base: string, text: string) {
  return /\b(quote|estimate|price|pricing)\b/i.test(text) &&
    !/\bquote\b/i.test(base)
    ? `${base} Quote`
    : base;
}

function inferSpecificTradeJobType(text: string) {
  if (/\b(room|home|house)\s+(?:add(?:ition|-?on)?|extension)\b/i.test(text)) {
    return quoteAwareLabel("Room Addition", text);
  }

  if (/\bbathroom\b/i.test(text)) {
    const base = /\b(renovat|reno|remodel|redo|upgrade)\w*\b/i.test(text)
      ? "Bathroom Renovation"
      : "Bathroom";

    return quoteAwareLabel(base, text);
  }

  if (/\bkitchen\b/i.test(text)) {
    const base = /\b(renovat|reno|remodel|redo|upgrade)\w*\b/i.test(text)
      ? "Kitchen Renovation"
      : "Kitchen";

    return quoteAwareLabel(base, text);
  }

  if (/\blaundry\b/i.test(text)) {
    return quoteAwareLabel("Laundry Renovation", text);
  }

  if (/\bhot water\b/i.test(text)) {
    return quoteAwareLabel("Hot Water Service", text);
  }

  if (/\b(blocked|blockage)\b/i.test(text) || /\bdrain\b/i.test(text)) {
    return quoteAwareLabel("Blocked Drain", text);
  }

  if (/\b(leak|leaking|burst|flood)\b/i.test(text)) {
    return quoteAwareLabel("Leak Repair", text);
  }

  if (/\btoilet\b/i.test(text)) {
    const base = /\b(replace|replacement|install|installation)\w*\b/i.test(text)
      ? "Toilet Replacement"
      : "Toilet Repair";

    return quoteAwareLabel(base, text);
  }

  if (/\b(shower|screen)\b/i.test(text)) {
    return quoteAwareLabel("Shower Repair", text);
  }

  if (/\b(tap|mixer|faucet)\b/i.test(text)) {
    return quoteAwareLabel("Tap Repair", text);
  }

  if (/\b(tile|tiling|tiles)\b/i.test(text)) {
    return quoteAwareLabel("Tiling", text);
  }

  if (/\b(paint|painting)\b/i.test(text)) {
    return quoteAwareLabel("Painting", text);
  }

  if (/\b(plaster|plastering|drywall)\b/i.test(text)) {
    return quoteAwareLabel("Plastering", text);
  }

  if (/\b(electrical|electrician|power point|lights?|lighting)\b/i.test(text)) {
    return quoteAwareLabel("Electrical", text);
  }

  if (/\b(air con|air conditioning|ac unit)\b/i.test(text)) {
    return quoteAwareLabel("Air Conditioning", text);
  }

  if (/\b(deck|decking)\b/i.test(text)) {
    return quoteAwareLabel("Decking", text);
  }

  if (/\b(fence|fencing|gate)\b/i.test(text)) {
    return quoteAwareLabel("Fencing", text);
  }

  if (/\b(renovat|reno|remodel)\w*\b/i.test(text)) {
    return quoteAwareLabel("Renovation", text);
  }

  if (/\bquote\b/i.test(text)) {
    return "Quote Request";
  }

  return null;
}

function inferJobType(text: string, context: StubAiTriageContext) {
  const serviceType = normalizeJobTypeCandidate(context.serviceType ?? null);

  if (serviceType) {
    return serviceType;
  }

  const specificJobType = inferSpecificTradeJobType(text);

  if (specificJobType) {
    return specificJobType;
  }

  const leadTitle = normalizeJobTypeCandidate(context.leadTitle ?? null);

  if (leadTitle) {
    return leadTitle;
  }

  const lowered = text.toLowerCase();

  if (lowered.includes("hot water")) {
    return "Hot water service";
  }

  if (lowered.includes("leak") || lowered.includes("burst")) {
    return "Leak repair";
  }

  if (lowered.includes("blocked") || lowered.includes("drain")) {
    return "Blocked drain";
  }

  if (lowered.includes("quote")) {
    return "Quote request";
  }

  return null;
}

function inferAddress(text: string, context: StubAiTriageContext) {
  if (context.contactAddress?.trim()) {
    return context.contactAddress.trim();
  }

  return firstMatch(text, [
    /\b(?:at|address is|job is at|located at)\s+([0-9][a-z0-9\s,'/-]+(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|lane|ln|place|pl|terrace|tce|way)\b[^\n.]*)/i,
    /\b([0-9]{1,5}\s+[a-z0-9\s,'/-]+(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|lane|ln|place|pl|terrace|tce|way)\b[^\n.]*)/i,
  ]);
}

function inferPreferredTime(text: string) {
  return firstMatch(text, [
    /\b((?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening|night))?)\b/i,
    /\b((?:next week|this week|as soon as possible|asap|morning|afternoon|evening))\b/i,
  ]);
}

function inferUrgency(text: string): InquiryFacts["urgency"] {
  return /\b(urgent|emergency|asap|burst|flood|no hot water|leaking badly)\b/i.test(
    text,
  )
    ? "urgent"
    : "normal";
}

function inferBudget(text: string) {
  return firstMatch(text, [/\b(\$[0-9][0-9,]*(?:\.\d{2})?)\b/i]);
}

function triageSourceText(context: StubAiTriageContext) {
  return [
    context.leadTitle,
    context.serviceType,
    context.summary,
    context.latestMessage,
    context.threadSummary,
  ]
    .filter(Boolean)
    .join("\n");
}

function inferEmail(text: string) {
  return normalizeContactEmail(
    firstMatch(text, [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i]),
  );
}

function inferPhone(text: string, defaultPhoneRegion?: PhoneRegion) {
  const candidate = firstMatch(text, [
    /\b(?:phone|mobile|mob|cell|call me on|number is|my number is)[:\s-]*(\+?\d[\d\s().-]{6,}\d)\b/i,
    /\b(\+?\d[\d\s().-]{7,}\d)\b/,
  ]);

  if (!candidate) {
    return null;
  }

  return normalizeContactPhoneForRegion(candidate, defaultPhoneRegion);
}

function hasEmailSignal(context: StubAiTriageContext, text: string) {
  return Boolean(
    normalizeContactEmail(context.contactEmail) ?? inferEmail(text),
  );
}

function hasPhoneSignal(context: StubAiTriageContext, text: string) {
  return Boolean(
    normalizeContactPhoneForRegion(
      context.contactPhone,
      context.defaultPhoneRegion,
    ) ?? inferPhone(text, context.defaultPhoneRegion),
  );
}

function hasMissingInfo(value: string[], label: string) {
  const normalizedLabel = label.toLowerCase();

  return value.some((item) => item.trim().toLowerCase() === normalizedLabel);
}

function withMissingInfo(value: string[], label: string) {
  return hasMissingInfo(value, label) ? value : [...value, label];
}

function channelKind(context: StubAiTriageContext) {
  return [context.inboundChannelType, context.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * The one `missingInfo` entry the customer cannot answer.
 *
 * `missingInfo` does double duty: most of it is genuinely missing customer
 * detail -- job address, preferred time, a phone number -- and the reply
 * writer is handed the list so it knows what to ask for. This entry is not
 * that. It means "the owner should look at whether this lead is worth
 * servicing", and handing it to the writer produced an email asking the
 * customer to "confirm this is a serviceable inquiry".
 *
 * Kept in the list because the owner's inbox reads it, and filtered out of
 * anything that writes to a customer -- see `customerAnswerableMissingInfo`.
 */
export const OWNER_REVIEW_MISSING_INFO =
  "Confirm this is a serviceable inquiry";

/**
 * The subset of `missingInfo` a customer could actually supply.
 *
 * Anything reaching outbound prose goes through here. A blocklist rather than
 * an allowlist because the customer-answerable entries are open-ended -- the
 * model adds its own -- while the owner-facing ones are a closed set we
 * define.
 */
export function customerAnswerableMissingInfo(missingInfo: string[]) {
  return missingInfo.filter((entry) => entry !== OWNER_REVIEW_MISSING_INFO);
}

export function outboundReplyChannelForInquiryContext(
  context: StubAiTriageContext,
) {
  const channel = channelKind(context);

  if (channel.includes("sms")) {
    return "sms" as const;
  }

  return "email" as const;
}

function applyRequiredInquiryInfo(
  facts: InquiryFacts,
  context: StubAiTriageContext,
): InquiryFacts {
  const text = triageSourceText(context);
  const channel = channelKind(context);
  let missingInfo = [...facts.missingInfo];

  // A day the customer ruled out is not a day they asked for.
  //
  // "I'm away Thursday and Friday this week so don't come then" came back from
  // the extractor as preferredTime "Thursday", and kept doing so after the
  // schema was told in as many words never to record an unavailability as a
  // preferred time. The same run also listed "Preferred time" as missing
  // information, so the model was asserting both at once.
  //
  // Downstream this was patched where it did the most damage -- the calendar
  // window refuses a summary that names only excluded days -- but the stored
  // fact stayed wrong, and it is shown to the owner as "Preferred" and handed
  // to the quote writer as "Preferred time: Thursday". Dropping it here, before
  // the gap check below, restores the honest answer: Kyro does not know when
  // she can be there, so it asks.
  const preferredTime =
    facts.preferredTime && namesRuledOutDay(text, facts.preferredTime)
      ? null
      : facts.preferredTime;

  if (!facts.jobType) {
    missingInfo = withMissingInfo(missingInfo, "Job type");
  }

  if (!facts.address) {
    missingInfo = withMissingInfo(missingInfo, "Job address");
  }

  if (!preferredTime) {
    missingInfo = withMissingInfo(missingInfo, "Preferred time");
  }

  if (facts.fit === "needs_review") {
    missingInfo = withMissingInfo(missingInfo, OWNER_REVIEW_MISSING_INFO);
  }

  const hasEmail = hasEmailSignal(context, text);
  const hasPhone = hasPhoneSignal(context, text);
  const cameByEmail = channel.includes("email");
  const cameBySms = channel.includes("sms");
  const cameByPhone =
    channel.includes("phone") ||
    channel.includes("voice") ||
    channel.includes("call");

  if (cameByEmail && !hasPhone) {
    missingInfo = withMissingInfo(missingInfo, "Phone number");
  } else if ((cameBySms || cameByPhone) && !hasEmail) {
    missingInfo = withMissingInfo(missingInfo, "Email address");
  } else if (!cameByEmail && !cameBySms && !cameByPhone) {
    if (hasEmail && !hasPhone) {
      missingInfo = withMissingInfo(missingInfo, "Phone number");
    } else if (hasPhone && !hasEmail) {
      missingInfo = withMissingInfo(missingInfo, "Email address");
    } else if (!hasEmail && !hasPhone) {
      missingInfo = withMissingInfo(
        missingInfo,
        "Email address or phone number",
      );
    }
  }

  return {
    ...facts,
    missingInfo,
    preferredTime,
  };
}

export function applyResponsePolicyToInquiryFacts(
  facts: InquiryFacts,
  context: StubAiTriageContext,
  responsePolicy: TriageResponsePolicy,
): InquiryFacts {
  if (responsePolicy.mode === "service_inquiry") {
    return applyRequiredInquiryInfo(facts, context);
  }

  return {
    address: null,
    budget: null,
    fit: "likely_fit",
    jobType: null,
    missingInfo: [],
    preferredTime: null,
    urgency: "normal",
  };
}

function inferFit(text: string, jobType: string | null): InquiryFacts["fit"] {
  if (
    /\b(not interested|wrong number|not needed|cancel|do not contact)\b/i.test(
      text,
    )
  ) {
    return "not_fit";
  }

  return jobType ? "likely_fit" : "needs_review";
}

export function extractInquiryFacts(
  context: StubAiTriageContext,
): InquiryFacts {
  const text = triageSourceText(context);
  const jobType = titleCaseJobType(inferJobType(text, context));
  const address = inferAddress(text, context);
  const preferredTime = inferPreferredTime(text);
  const budget = inferBudget(text);
  const fit = inferFit(text, jobType);
  const facts = {
    address,
    budget,
    fit,
    jobType,
    missingInfo: [],
    preferredTime,
    urgency: inferUrgency(text),
  };

  return applyRequiredInquiryInfo(facts, context);
}

function missingInfoPhrase(item: string) {
  switch (item.trim().toLowerCase()) {
    case "job address":
      return "the job address";
    case "preferred time":
      return "your preferred day or time";
    case "phone number":
      return "a phone number";
    case "email address":
      return "an email address";
    case "email address or phone number":
      return "an email address or phone number";
    case "job type":
      return "a quick description of the work";
    default:
      // Every known label has a customer-facing phrasing above. Anything else
      // is a label nobody wrote for a customer to read -- an owner note, or
      // something the model invented -- and echoing it lowercased is how
      // "Confirm this is a serviceable inquiry" ended up in an email asking a
      // customer to confirm they were a serviceable inquiry.
      return null;
  }
}

/**
 * The missing details the draft still does not ask about, in natural language
 * for the model to act on.
 *
 * This is deliberately detection only. It used to have a twin that wrote the
 * question itself and spliced it into the reply -- replacing the model's own
 * sentence with a template, even when the model had written a perfectly good
 * one. Code decides *what has to be covered*; the model decides how to say it.
 */
function missingInfoGapPhrases(items: string[]) {
  return items
    .map((item): string | null => missingInfoPhrase(item))
    .filter((phrase): phrase is string => Boolean(phrase));
}

function replyMentionsMissingInfo(body: string, item: string) {
  const text = body.toLowerCase();

  switch (item.trim().toLowerCase()) {
    case "job address":
      return /\b(address|site|property|location)\b/.test(text);
    case "preferred time":
      return /\b(time|date|day|availability|available|when)\b/.test(text);
    case "phone number":
      return /\b(phone|mobile|number|call)\b/.test(text);
    case "email address":
      return /\b(email|e-mail)\b/.test(text);
    case "email address or phone number":
      return /\b(email|e-mail|phone|mobile|number|call)\b/.test(text);
    case "job type":
      return /\b(work|job|service|issue|project|quote)\b/.test(text);
    default:
      return text.includes(item.trim().toLowerCase());
  }
}

function missingInfoNotAskedFor(body: string, facts: InquiryFacts) {
  return customerAnswerableMissingInfo(facts.missingInfo).filter(
    (item) => !replyMentionsMissingInfo(body, item),
  );
}

/**
 * Which required details a draft still does not ask for.
 *
 * The answer is reported, never repaired in place. A draft with gaps goes back
 * to the model with the gaps named; if the model still will not ask, the draft
 * keeps the model's wording and the gaps travel with it so the operator can see
 * them. An empty draft has every detail outstanding, because nothing asks.
 */
export function replyDraftMissingInfoGaps(
  replyDraft: TriageDecision["replyDraft"],
  facts: InquiryFacts,
): string[] {
  return replyDraft.body
    ? missingInfoNotAskedFor(replyDraft.body, facts)
    : customerAnswerableMissingInfo(facts.missingInfo);
}

function buildReplyRepairPrompt(input: {
  body: string;
  context: StubAiTriageContext;
  facts: InquiryFacts;
  missingInfo: string[];
  subject: string | null;
  verifiedAvailability?: VerifiedInquiryAvailability | null;
}) {
  const replyWriting =
    input.context.replyWriting ?? DEFAULT_REPLY_WRITING_SETTINGS;
  const hasVerifiedAvailability = Boolean(input.verifiedAvailability);

  return JSON.stringify(
    {
      task: hasVerifiedAvailability
        ? "Rewrite this customer reply so it naturally offers the verified available appointment and asks for every remaining required detail. Return a complete replacement draft, not notes."
        : "Rewrite this customer reply so it naturally asks for every required missing detail. Return a complete replacement draft, not notes.",
      outputContract: {
        subject: "string|null",
        body: "string",
      },
      rules: [
        "Return JSON only.",
        "Write as Kyro on behalf of the business owner, not as an AI assistant.",
        "Keep the reply concise, natural, and customer-facing.",
        "Do not append an extra afterthought line. Compose one coherent message.",
        hasVerifiedAvailability
          ? "The verifiedAvailability slot is authoritative. Offer that exact slot naturally and do not invent or substitute another time."
          : "Do not invent availability or promises not present in context.",
        hasVerifiedAvailability
          ? "Do not ask the customer for a preferred time. Ask whether the verified slot works for them."
          : "Only ask for timing when it is included in requiredMissingInfo.",
        hasVerifiedAvailability
          ? "The slot is a proposal awaiting customer acceptance, not a confirmed booking."
          : "Do not imply that an appointment is confirmed unless the context says it is.",
        "Do not invent prices, addresses, phone numbers, or email addresses.",
        "The replacement body must ask for every requiredMissingInfo item.",
        "If asking for several details, combine them naturally in one sentence where possible.",
        "Preserve the useful meaning of the original draft, but rewrite awkward wording if needed.",
        ...replyWritingPromptRules(
          replyWriting,
          input.context.inboundChannelType,
          firstCustomerTurnFromCount(input.context.threadMessageCount),
        ).map((rule) => `Writing style - ${rule}`),
      ],
      requiredMissingInfo: input.missingInfo,
      requiredMissingInfoPhrases: missingInfoGapPhrases(input.missingInfo),
      verifiedAvailability: input.verifiedAvailability ?? null,
      inquiryFacts: input.facts,
      originalDraft: {
        subject: input.subject,
        body: input.body,
      },
      replyWriting,
      context: {
        source: input.context.source ?? null,
        inboundChannelType: input.context.inboundChannelType ?? null,
        leadTitle: input.context.leadTitle ?? null,
        serviceType: input.context.serviceType ?? null,
        summary: input.context.summary ?? null,
        threadSummary: input.context.threadSummary ?? null,
      },
    },
    null,
    2,
  );
}

async function repairReplyDraftWithOpenAi(input: {
  context: StubAiTriageContext;
  facts: InquiryFacts;
  model: string;
  replyDraft: TriageDecision["replyDraft"];
  verifiedAvailability?: VerifiedInquiryAvailability | null;
}): Promise<{
  repairUsage?: ReplyRepairUsage;
  replyDraft: TriageDecision["replyDraft"];
}> {
  const body = input.replyDraft.body;

  // Nothing to repair without a draft to repair. An empty draft is reported as
  // empty rather than filled with text this module wrote.
  if (!body) {
    return { replyDraft: input.replyDraft };
  }

  const unasked = missingInfoNotAskedFor(body, input.facts);

  if (unasked.length === 0 && !input.verifiedAvailability) {
    return { replyDraft: input.replyDraft };
  }

  const apiKey = openAiApiKey();

  if (!apiKey) {
    return { replyDraft: input.replyDraft };
  }

  const prompt = buildReplyRepairPrompt({
    body,
    context: input.context,
    facts: input.facts,
    missingInfo: input.facts.missingInfo,
    subject: input.replyDraft.subject,
    verifiedAvailability: input.verifiedAvailability,
  });
  const model = openAiTriageModel();
  const response = await fetchAiProvider(
    "https://api.openai.com/v1/responses",
    {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You repair Kyro customer reply drafts. Return compact JSON matching the requested contract.",
        max_output_tokens: openAiReplyRepairMaxOutputTokens(),
        model,
        ...openAiReasoningRequest(
          model,
          "OPENAI_REPLY_REPAIR_REASONING_EFFORT",
          "low",
        ),
        text: {
          format: {
            name: "kyro_reply_repair",
            schema: {
              additionalProperties: false,
              properties: {
                body: { type: "string" },
                subject: { type: ["string", "null"] },
              },
              required: ["subject", "body"],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { replyDraft: input.replyDraft };
  }

  const content = responseOutputText(payload);

  if (!content) {
    return { replyDraft: input.replyDraft };
  }

  const usage = responseUsage(payload, prompt, content);
  const parsed = extractJsonObject(content);
  const repairedBody = textValue(parsed.body);
  // A repair that came back empty leaves the original draft alone. A repair
  // that came back still missing a detail is kept as written: the model's
  // phrasing survives, and the outstanding gaps are reported rather than
  // patched over with a sentence this file wrote.
  const validatedDraft = repairedBody
    ? {
        body: repairedBody,
        subject: textValue(parsed.subject) ?? input.replyDraft.subject,
      }
    : input.replyDraft;

  return {
    repairUsage: {
      inputTokens: usage.inputTokens,
      model,
      outputTokens: usage.outputTokens,
      providerUsageId: usage.providerUsageId,
      tokenUsage: usage.tokenUsage,
    },
    replyDraft: validatedDraft,
  };
}

async function ensureKnownBusinessFactReply(input: {
  context: StubAiTriageContext;
  factKeys: PublicBusinessFactKey[];
  publicBusinessFacts: PublicBusinessFacts;
  replyDraft: TriageDecision["replyDraft"];
}): Promise<{
  repairUsage?: ReplyRepairUsage;
  replyDraft: TriageDecision["replyDraft"];
}> {
  const responsePolicy: TriageResponsePolicy = {
    factKeys: input.factKeys,
    informationNeed: null,
    mode: "known_business_fact",
    ownerQuestion: null,
    reason: "The customer asked for a saved public business fact.",
  };

  if (
    canAnswerWithKnownBusinessFacts({
      publicBusinessFacts: input.publicBusinessFacts,
      replyBody: input.replyDraft.body,
      responsePolicy,
    })
  ) {
    return { replyDraft: input.replyDraft };
  }

  const apiKey = openAiApiKey();

  if (!apiKey) {
    return { replyDraft: input.replyDraft };
  }

  const requestedFacts = Object.fromEntries(
    input.factKeys.map((key) => [key, input.publicBusinessFacts[key]]),
  );
  const replyWriting =
    input.context.replyWriting ?? DEFAULT_REPLY_WRITING_SETTINGS;
  const prompt = JSON.stringify(
    {
      task: "Write a direct customer reply that answers only the simple business-fact question using the authoritative saved facts.",
      outputContract: {
        subject: "string|null",
        body: "string",
      },
      rules: [
        "Return JSON only.",
        "Use every authoritativeFact value exactly and do not invent or alter business details.",
        "Answer the customer's question immediately.",
        "Do not treat this as a quote or service inquiry.",
        "Do not ask for a job address, job description, preferred time, phone number, email address, confirmation, or serviceability.",
        "A short offer to help with anything else is acceptable.",
        "Keep the complete reply concise and natural.",
        ...replyWritingPromptRules(
          replyWriting,
          input.context.inboundChannelType,
          firstCustomerTurnFromCount(input.context.threadMessageCount),
        ).map((rule) => `Writing style - ${rule}`),
      ],
      authoritativeFacts: requestedFacts,
      customerMessage: input.context.latestMessage ?? "",
      originalDraft: input.replyDraft,
      replyWriting,
    },
    null,
    2,
  );
  const model = openAiTriageModel();
  const response = await fetchAiProvider(
    "https://api.openai.com/v1/responses",
    {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You write grounded Kyro business-fact replies. Return compact JSON matching the requested contract.",
        max_output_tokens: openAiReplyRepairMaxOutputTokens(),
        model,
        ...openAiReasoningRequest(
          model,
          "OPENAI_REPLY_REPAIR_REASONING_EFFORT",
          "low",
        ),
        text: {
          format: {
            name: "kyro_known_business_fact_reply",
            schema: {
              additionalProperties: false,
              properties: {
                body: { type: "string" },
                subject: { type: ["string", "null"] },
              },
              required: ["subject", "body"],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { replyDraft: input.replyDraft };
  }

  const content = responseOutputText(payload);

  if (!content) {
    return { replyDraft: input.replyDraft };
  }

  const parsed = extractJsonObject(content);
  const body = textValue(parsed.body);
  const candidate = {
    body: body ?? input.replyDraft.body,
    subject: textValue(parsed.subject) ?? input.replyDraft.subject,
  };
  const grounded = canAnswerWithKnownBusinessFacts({
    publicBusinessFacts: input.publicBusinessFacts,
    replyBody: candidate.body,
    responsePolicy,
  });

  if (!grounded) {
    return { replyDraft: input.replyDraft };
  }

  const usage = responseUsage(payload, prompt, content);

  return {
    repairUsage: {
      inputTokens: usage.inputTokens,
      model,
      outputTokens: usage.outputTokens,
      providerUsageId: usage.providerUsageId,
      tokenUsage: usage.tokenUsage,
    },
    replyDraft: candidate,
  };
}

function aiProviderMode() {
  // Empty counts as unset. `?? "stub"` only catches undefined, so AI_PROVIDER=""
  // returned "" -- a mode matching no branch, which fell through to the stub
  // without ever naming itself.
  return process.env.AI_PROVIDER?.trim().toLowerCase() || "stub";
}

function ollamaBaseUrl() {
  return (
    process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
}

function ollamaModel() {
  return process.env.OLLAMA_MODEL?.trim() || "qwen3:8b";
}

function ollamaTimeoutMs() {
  const parsed = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function ollamaNumPredict() {
  const parsed = Number(process.env.OLLAMA_NUM_PREDICT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 320;
}

function ollamaThinkEnabled() {
  const value = process.env.OLLAMA_THINK?.trim().toLowerCase() ?? "";
  return ["1", "true", "yes", "on"].includes(value);
}

function openAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function openAiTriageModel() {
  return process.env.OPENAI_TRIAGE_MODEL?.trim() || openAiLowCostModel();
}

/**
 * Room for the whole JSON object, not just the reply inside it.
 *
 * This ceiling was 700, which a long inquiry could exceed: the response was
 * cut off mid-object, `JSON.parse` failed at character 1793, and triage fell
 * back to the stub -- which produces no reply body, so nothing was proposed
 * and the caller reported "Unable to create AI proposed action: unknown
 * error". A truncated model response should not read like a database failure.
 *
 * A ceiling is not a target: the model still writes what the reply needs, and
 * output is billed on what it actually generates, so the headroom costs
 * nothing on a short inquiry and saves a whole failed turn on a long one.
 */
function openAiTriageMaxOutputTokens() {
  const parsed = Number(process.env.OPENAI_TRIAGE_MAX_OUTPUT_TOKENS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1600;
}

function openAiReplyRepairMaxOutputTokens() {
  const parsed = Number(process.env.OPENAI_REPLY_REPAIR_MAX_OUTPUT_TOKENS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200;
}

function describeOllamaError(error: unknown, timeoutMs: number) {
  if (error instanceof Error && error.name === "AbortError") {
    return `Local Ollama triage timed out after ${timeoutMs}ms.`;
  }

  return error instanceof Error ? error.message : "Local Ollama triage failed.";
}

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);
  return textValue(error.message) ?? "OpenAI triage request failed.";
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Local model response did not contain a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function responseOutputText(payload: unknown) {
  const root = objectRecord(payload);
  const direct = textValue(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];

  for (const item of output) {
    const content = objectRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const text = textValue(objectRecord(part).text);

      if (text) {
        return text;
      }
    }
  }

  return null;
}

function responseUsage(payload: unknown, prompt: string, text: string) {
  const usage = openAiUsageFromResponse(payload, { prompt, text });

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    providerUsageId: openAiProviderUsageId(payload) ?? undefined,
    tokenUsage: usage,
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : null))
        .filter((item): item is string => Boolean(item))
    : [];
}

function normalizeUrgency(value: unknown): InquiryFacts["urgency"] {
  return value === "low" || value === "urgent" ? value : "normal";
}

function normalizeFit(value: unknown): InquiryFacts["fit"] {
  return value === "likely_fit" || value === "not_fit" ? value : "needs_review";
}

/**
 * The name the sender gave for themselves, from the model's extraction.
 *
 * Kept out of normalizeLocalFacts on purpose: this is not a fact about the
 * job, it is about the contact record, and InquiryFacts is written to
 * inquiry_facts and shown in the CRM's editable facts panel.
 *
 * A name that is only a phone number is discarded here rather than downstream,
 * since some senders "introduce" themselves with the number they are texting
 * from and that is what the contact already has.
 */
function extractedCustomerName(value: unknown) {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const name = textValue(raw.customerName);

  if (!name || /^[+\d][\d\s()+-]*$/.test(name)) {
    return null;
  }

  return name;
}

function normalizeLocalFacts(
  value: unknown,
  fallback: InquiryFacts,
  context: StubAiTriageContext,
  responsePolicy: TriageResponsePolicy,
): InquiryFacts {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const modelJobType = normalizeJobTypeCandidate(textValue(raw.jobType));
  const facts = {
    address: textValue(raw.address) ?? fallback.address,
    budget: textValue(raw.budget) ?? fallback.budget,
    fit: normalizeFit(raw.fit ?? fallback.fit),
    jobType: modelJobType ?? fallback.jobType,
    missingInfo: normalizeStringArray(raw.missingInfo),
    preferredTime: textValue(raw.preferredTime) ?? fallback.preferredTime,
    urgency: normalizeUrgency(raw.urgency ?? fallback.urgency),
  };

  return applyResponsePolicyToInquiryFacts(facts, context, responsePolicy);
}

function buildOllamaPrompt(context: StubAiTriageContext) {
  const replyWriting = context.replyWriting ?? DEFAULT_REPLY_WRITING_SETTINGS;
  const directFactKeys = directKnownBusinessFactKeys(
    context.latestMessage ?? "",
  ).filter((key) => Boolean(textValue(context.publicBusinessFacts?.[key])));

  return JSON.stringify(
    {
      task: context.inquiryFactsOverride
        ? "Draft a concise customer reply from authoritative corrected inquiry facts."
        : "First classify the latest customer message, then draft the most natural concise business reply. Extract trade inquiry facts only when the message is genuinely starting or progressing a service job.",
      outputContract: {
        summary: "string",
        responsePolicy: {
          mode: "known_business_fact|simple_business_message|tool_assisted_business_message|service_inquiry",
          factKeys: [
            "businessName|industry|publicPhoneNumber|publicEmail|businessAddress|serviceArea|workingHours|contactHours",
          ],
          informationNeed: "string|null",
          ownerQuestion: "string|null",
          reason: "string|null",
        },
        futureStepDecision: {
          outcome: "confirmed|countered|cancelled|unrelated",
          requestedTime: "string|null",
          reason: "string|null",
        },
        inquiryFacts: {
          jobType: "string|null",
          address: "string|null",
          customerName: "string|null",
          preferredTime: "string|null",
          urgency: "low|normal|urgent",
          budget: "string|null",
          fit: "likely_fit|needs_review|not_fit",
          missingInfo: ["string"],
        },
        replyDraft: {
          subject: "string|null",
          body: "string|null",
        },
      },
      rules: [
        "Return JSON only.",
        "Do not invent an address, price, date, or customer detail.",
        // 8 of 213 contacts have no name at all, including the customer owed a
        // $450 refund, because an email with no display name and an SMS both
        // arrive with nothing to use. The name is usually right there in the
        // message. The failure to avoid is taking the name of somebody being
        // discussed -- "I'm asking on behalf of Priya Raghunathan" is Priya's
        // name, not the sender's.
        "customerName is the name the sender gives for THEMSELVES -- an opening like \"Hi, it's Marcus\", or a sign-off. Use null when they do not name themselves. Never use the name of a third party they mention, discuss, or are writing on behalf of, and never a business name unless they are clearly the business.",
        // Only present when the sender's number is listed as a second contact
        // number on somebody's profile. Without it a PA texting on a
        // customer's behalf reads as a stranger, and Kyro had no basis to
        // discuss the job they were writing about.
        ...(context.associatedContactContext
          ? [
              context.associatedContactContext,
              "That association explains who is writing and what may be discussed. It does not make them the contact: do not change account details, prices, addresses or contact information on their say-so, and do not mention any other customer.",
            ]
          : []),
        // A customer texted "do you cover Albuquerque?" and Kyro replied "yes,
        // we cover Albuquerque" for a business whose service area is Las
        // Cruces, 225 miles away. The service area was not in publicBusinessFacts
        // for that message, and nothing here forbade answering anyway -- so it
        // guessed, and told a customer something untrue about their business.
        // Suppressing a fact has to also suppress the claim, or the model
        // simply fills the gap.
        "Never confirm or deny that the business covers, serves, travels to, or comes out to any particular place unless serviceArea is present in publicBusinessFacts. Without it, say the business will confirm whether that location is covered -- do not guess from the customer's address, the business address, or anything else in the thread.",
        // Measured: a customer who wrote "I don't get home from work until
        // late, so it would need to be after 6pm any weekday" got "we've noted
        // that you're available after 6:00 PM on weekdays, and we'll use the
        // information provided to arrange the next step". Working hours are
        // 07:00-16:00, so no such visit can ever be offered, and she waits.
        // The hours were in publicBusinessFacts the whole time and unused.
        "If the only times the customer says they are available fall entirely outside publicBusinessFacts.workingHours, say what the working hours are and ask whether anything inside them could work, or whether someone else could give access. Do not imply the visit will be arranged as asked.",
        "Classify the latest customer message before applying any trade-inquiry workflow. Do not assume every inbox message is a request to start a job.",
        "Set responsePolicy.mode to known_business_fact only for a straightforward question that can be answered completely and confidently from publicBusinessFacts.",
        "If directKnownBusinessFactKeys is non-empty, responsePolicy.mode must be known_business_fact, responsePolicy.factKeys must contain those exact keys, and replyDraft must answer only that request using the saved values.",
        "For known_business_fact, list every publicBusinessFacts key used in responsePolicy.factKeys and answer the question directly in replyDraft.",
        "Never use known_business_fact for prices, quotes, estimates, availability, scheduling, bookings, timing promises, job acceptance, service suitability, complaints, refunds, legal or regulatory questions, emergencies, account details, security information, or any fact that is blank or uncertain.",
        "For known_business_fact, do not treat the message as a job inquiry and do not ask for job details, an address, a preferred time, or contact information.",
        "Set responsePolicy.mode to simple_business_message for a standalone business question or simple request that can be answered, acknowledged, or clarified without starting or progressing a particular job. Examples include asking whether photos can be sent, how a process works, whether somebody can call back, or asking a general question about the business.",
        "For simple_business_message, answer or acknowledge the actual message directly. If a business-specific answer is not available in context, ask one focused clarification or say the team can confirm it. Do not append a quote-intake checklist or ask for unrelated job details.",
        "For simple_business_message, responsePolicy.factKeys must be empty and inquiryFacts must use null for jobType, address, preferredTime, and budget; normal for urgency; likely_fit for fit; and an empty missingInfo array.",
        "Set responsePolicy.mode to tool_assisted_business_message for a legitimate customer or business question that does not fit the other modes and needs scoped Kyro workspace information or knowledge from the business owner before it can be answered accurately.",
        "For tool_assisted_business_message, responsePolicy.factKeys must be empty and inquiryFacts must use null for jobType, address, preferredTime, and budget; normal for urgency; likely_fit for fit; and an empty missingInfo array.",
        "For tool_assisted_business_message, set informationNeed to the specific fact required. If the answer should be looked up from Kyro workspace context, set ownerQuestion to null. If only the business can supply the answer, ask exactly one focused question in ownerQuestion. Do not ask the customer for unrelated service-intake details.",
        "Set responsePolicy.mode to service_inquiry only when the customer is actually requesting or progressing specific trade work, a quote, an appointment, an active job, or a concrete attendance request. A question about the business is not automatically a service inquiry.",
        "For service_inquiry, apply the required job-information rules below. Those rules never apply to known_business_fact or simple_business_message.",
        "jobType must describe the trade work being requested, not the lead title or contact name.",
        // "I'm away Thursday and Friday" was recorded as a preferred time, the
        // date parser took the first weekday it saw, and the draft offered
        // Thursday. When a customer only says when they cannot be there, the
        // honest value is null.
        "preferredTime is when the customer says they CAN be there. If they only say when they cannot -- away Thursday, not weekends, no mornings -- leave preferredTime null and put the constraint in your summary instead. Never record an unavailability as a preferred time.",
        "Never use placeholder jobType values like 'New inquiry from John', 'Quote request from Sarah', or 'Manual inbound enquiry'.",
        "For example, 'renovating my bathroom' plus 'quote' should become 'Bathroom Renovation Quote'.",
        "If authoritativeInquiryFacts is present, echo it exactly in inquiryFacts and do not reinterpret it.",
        "Every service inquiry needs an attendable job address. If the address is not in the message thread and not in the contact profile, put Job address in missingInfo and ask for it in replyDraft.",
        "Every service inquiry needs a next timing preference. If the customer has not provided one, put Preferred time in missingInfo and ask for their preferred day or time. Do not claim calendar availability unless the context explicitly provides it.",
        "For email-originated inquiries, if the customer has no phone number in the thread or CRM profile, put Phone number in missingInfo and ask for it in replyDraft.",
        "For SMS or phone-originated inquiries, if the customer has no email address in the thread or CRM profile, put Email address in missingInfo and ask for it in replyDraft.",
        "If required info is missing, put it in missingInfo and make the replyDraft ask for those details clearly.",
        "If context.futureStep is present, classify only the latestMessage against that pending workflow. Use confirmed only when the customer accepts the offered appointment, countered when they reject it or propose a different time, cancelled when they abandon it, and unrelated when the reply does not resolve that workflow.",
        "Never use an older thread message to resolve a futureStep. If context.futureStep is absent, futureStepDecision.outcome must be unrelated.",
        "Apply replyWriting to the replyDraft tone, wording style, length, sign-off, trade phrasing, and reusable instructions.",
        ...customerReplyConversationRules({
          channel: context.inboundChannelType,
          isFirstCustomerTurn: firstCustomerTurnFromCount(
            context.threadMessageCount,
          ),
        }),
        ...replyWritingPromptRules(
          replyWriting,
          context.inboundChannelType,
          firstCustomerTurnFromCount(context.threadMessageCount),
        ).map((rule) => `Writing style - ${rule}`),
      ],
      authoritativeInquiryFacts: context.inquiryFactsOverride ?? null,
      directKnownBusinessFactKeys: directFactKeys,
      publicBusinessFacts: context.publicBusinessFacts ?? null,
      replyWriting,
      context,
    },
    null,
    2,
  );
}

function buildStubDecision(
  context: StubAiTriageContext,
  fallbackReason?: string,
): TriageDecision {
  const latestMessage = context.latestMessage ?? "";
  const directFactKeys = directKnownBusinessFactKeys(latestMessage).filter(
    (key) => Boolean(textValue(context.publicBusinessFacts?.[key])),
  );
  const fallbackFacts = context.inquiryFactsOverride
    ? context.inquiryFactsOverride
    : extractInquiryFacts(context);
  const serviceInquirySignal =
    Boolean(context.inquiryFactsOverride) ||
    /\b(?:quote|estimate|repair|replace|install|renovat|remodel|service|job|work|book|appointment|site visit|come out|attend|leak|blocked|broken|damage|build)\b/i.test(
      latestMessage,
    );
  const responsePolicy: TriageResponsePolicy =
    directFactKeys.length > 0
      ? {
          factKeys: directFactKeys,
          informationNeed: null,
          mode: "known_business_fact",
          ownerQuestion: null,
          reason: "A saved public business fact was requested.",
        }
      : serviceInquirySignal
        ? {
            factKeys: [],
            informationNeed: null,
            mode: "service_inquiry",
            ownerQuestion: null,
            reason: fallbackReason ?? null,
          }
        : {
            factKeys: [],
            informationNeed: null,
            mode: "simple_business_message",
            ownerQuestion: null,
            reason:
              "The primary model was unavailable and no clear service-job request was detected.",
          };
  const inquiryFacts = applyResponsePolicyToInquiryFacts(
    fallbackFacts,
    context,
    responsePolicy,
  );

  return {
    // No model ran, so there is no extracted name.
    customerName: null,
    fallbackReason,
    futureStepDecision: context.futureStep
      ? classifyFutureStepFallback(context.latestMessage ?? "")
      : normalizeFutureStepDecision(null),
    inquiryFacts,
    inputTokens: 900,
    outputTokens: 180,
    providerUsed: "stub",
    responsePolicy,
    // This decision is reached when no AI provider is configured or the
    // provider threw. Triage can still classify the inquiry from local rules,
    // but it cannot write to a customer, so it does not pretend to: the draft
    // is empty and `fallbackReason` says why. An empty draft proposes no
    // reply action, leaving the inquiry visibly awaiting a human.
    replyDraft: {
      body: null,
      subject: null,
    },
    summary:
      context.summary ??
      context.threadSummary ??
      "Stub triage identified a likely inbound lead and prepared a reply draft.",
  };
}

async function runOllamaTriage(
  context: StubAiTriageContext,
): Promise<TriageDecision> {
  const fallbackFacts = context.inquiryFactsOverride
    ? applyRequiredInquiryInfo(context.inquiryFactsOverride, context)
    : extractInquiryFacts(context);
  const prompt = buildOllamaPrompt(context);
  const controller = new AbortController();
  const timeoutMs = ollamaTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      body: JSON.stringify({
        format: "json",
        messages: [
          {
            role: "system",
            content:
              "You are Kyro's trades CRM triage engine. Return compact JSON matching the requested contract.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        model: ollamaModel(),
        options: {
          num_predict: ollamaNumPredict(),
          temperature: 0.1,
        },
        stream: false,
        think: ollamaThinkEnabled(),
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const message =
      payload.message && typeof payload.message === "object"
        ? (payload.message as Record<string, unknown>)
        : {};
    const content = textValue(message.content);

    if (!content) {
      throw new Error("Ollama returned an empty message.");
    }

    const parsed = extractJsonObject(content);
    const replyDraft = objectRecord(parsed.replyDraft);
    const responsePolicy = context.inquiryFactsOverride
      ? {
          factKeys: [],
          informationNeed: null,
          mode: "service_inquiry" as const,
          ownerQuestion: null,
          reason: "Corrected service-inquiry facts were supplied.",
        }
      : normalizeResponsePolicy(parsed.responsePolicy);
    const facts = context.inquiryFactsOverride
      ? applyRequiredInquiryInfo(context.inquiryFactsOverride, context)
      : normalizeLocalFacts(
          parsed.inquiryFacts,
          fallbackFacts,
          context,
          responsePolicy,
        );

    return {
      customerName: extractedCustomerName(parsed.inquiryFacts),
      futureStepDecision: normalizeFutureStepDecision(
        parsed.futureStepDecision,
      ),
      inquiryFacts: facts,
      inputTokens:
        typeof payload.prompt_eval_count === "number"
          ? payload.prompt_eval_count
          : estimateTokens(prompt),
      outputTokens:
        typeof payload.eval_count === "number"
          ? payload.eval_count
          : estimateTokens(content),
      providerUsed: "ollama",
      responsePolicy,
      replyDraft: {
        body: textValue(replyDraft.body),
        subject: textValue(replyDraft.subject),
      },
      summary:
        textValue(parsed.summary) ??
        context.summary ??
        "Local Ollama triage extracted inquiry facts and prepared action proposals.",
    };
  } catch (error) {
    throw new Error(describeOllamaError(error, timeoutMs));
  } finally {
    clearTimeout(timeout);
  }
}

async function runOpenAiTriage(
  context: StubAiTriageContext,
): Promise<TriageDecision> {
  const apiKey = openAiApiKey();
  const fallbackFacts = context.inquiryFactsOverride
    ? applyRequiredInquiryInfo(context.inquiryFactsOverride, context)
    : extractInquiryFacts(context);
  const prompt = buildOllamaPrompt(context);
  const model = openAiTriageModel();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for inbound triage.");
  }

  const response = await fetchAiProvider(
    "https://api.openai.com/v1/responses",
    {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You are Kyro's business-message triage and reply engine. Understand the customer's latest message before choosing a workflow. Return compact JSON matching the requested contract.",
        max_output_tokens: openAiTriageMaxOutputTokens(),
        model,
        ...openAiReasoningRequest(
          model,
          "OPENAI_TRIAGE_REASONING_EFFORT",
          "low",
        ),
        text: {
          format: {
            name: "kyro_inbound_triage",
            schema: {
              additionalProperties: false,
              properties: {
                inquiryFacts: {
                  additionalProperties: false,
                  properties: {
                    address: { type: ["string", "null"] },
                    budget: { type: ["string", "null"] },
                    // The name the customer gives for themselves, so a contact
                    // is not left as "+1505..." or blank. Strict schema: this
                    // must appear in `required` below as well as here, or every
                    // triage call fails.
                    customerName: { type: ["string", "null"] },
                    fit: {
                      enum: ["likely_fit", "needs_review", "not_fit"],
                      type: "string",
                    },
                    jobType: { type: ["string", "null"] },
                    missingInfo: {
                      items: { type: "string" },
                      type: "array",
                    },
                    preferredTime: { type: ["string", "null"] },
                    urgency: {
                      enum: ["low", "normal", "urgent"],
                      type: "string",
                    },
                  },
                  required: [
                    "jobType",
                    "address",
                    "customerName",
                    "preferredTime",
                    "urgency",
                    "budget",
                    "fit",
                    "missingInfo",
                  ],
                  type: "object",
                },
                responsePolicy: {
                  additionalProperties: false,
                  properties: {
                    factKeys: {
                      items: {
                        enum: [...PUBLIC_BUSINESS_FACT_KEYS],
                        type: "string",
                      },
                      type: "array",
                    },
                    mode: {
                      enum: [
                        "known_business_fact",
                        "simple_business_message",
                        "tool_assisted_business_message",
                        "service_inquiry",
                      ],
                      type: "string",
                    },
                    informationNeed: { type: ["string", "null"] },
                    ownerQuestion: { type: ["string", "null"] },
                    reason: { type: ["string", "null"] },
                  },
                  required: [
                    "mode",
                    "factKeys",
                    "reason",
                    "informationNeed",
                    "ownerQuestion",
                  ],
                  type: "object",
                },
                futureStepDecision: {
                  additionalProperties: false,
                  properties: {
                    outcome: {
                      enum: [
                        "confirmed",
                        "countered",
                        "cancelled",
                        "unrelated",
                      ],
                      type: "string",
                    },
                    reason: { type: ["string", "null"] },
                    requestedTime: { type: ["string", "null"] },
                  },
                  required: ["outcome", "requestedTime", "reason"],
                  type: "object",
                },
                replyDraft: {
                  additionalProperties: false,
                  properties: {
                    body: { type: ["string", "null"] },
                    subject: { type: ["string", "null"] },
                  },
                  required: ["subject", "body"],
                  type: "object",
                },
                summary: { type: "string" },
              },
              required: [
                "summary",
                "inquiryFacts",
                "replyDraft",
                "futureStepDecision",
                "responsePolicy",
              ],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload));
  }

  const content = responseOutputText(payload);

  if (!content) {
    throw new Error("OpenAI returned an empty triage response.");
  }

  const parsed = extractJsonObject(content);
  const replyDraft = objectRecord(parsed.replyDraft);
  const responsePolicy = context.inquiryFactsOverride
    ? {
        factKeys: [],
        informationNeed: null,
        mode: "service_inquiry" as const,
        ownerQuestion: null,
        reason: "Corrected service-inquiry facts were supplied.",
      }
    : normalizeResponsePolicy(parsed.responsePolicy);
  const facts = context.inquiryFactsOverride
    ? applyRequiredInquiryInfo(context.inquiryFactsOverride, context)
    : normalizeLocalFacts(
        parsed.inquiryFacts,
        fallbackFacts,
        context,
        responsePolicy,
      );

  return {
    customerName: extractedCustomerName(parsed.inquiryFacts),
    ...responseUsage(payload, prompt, content),
    futureStepDecision: normalizeFutureStepDecision(parsed.futureStepDecision),
    inquiryFacts: facts,
    providerUsed: "openai",
    responsePolicy,
    replyDraft: {
      body: textValue(replyDraft.body),
      subject: textValue(replyDraft.subject),
    },
    summary:
      textValue(parsed.summary) ??
      context.summary ??
      "OpenAI triage extracted inquiry facts and prepared action proposals.",
  };
}

async function loadScopedReplyLookupContext(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string | null | undefined,
) {
  if (!conversationId) {
    return { appointments: [], messages: [] };
  }

  const [messagesResult, appointmentsResult] = await Promise.all([
    supabase
      .from("messages")
      // `messages` has channel_id (uuid FK), not channel_type. Selecting a
      // non-existent column made this query throw, which broke every
      // owner-assisted reply. The per-message channel is not used here -- the
      // outbound reply channel is resolved separately.
      .select("direction,subject,body_text,created_at")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("conversation_appointments")
      .select("title,starts_at,ends_at,status,location")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .order("starts_at", { ascending: false })
      .limit(10),
  ]);

  if (messagesResult.error) {
    throw new Error(
      `Unable to load conversation context: ${messagesResult.error.message}`,
    );
  }

  if (appointmentsResult.error) {
    throw new Error(
      `Unable to load appointment context: ${appointmentsResult.error.message}`,
    );
  }

  return {
    appointments: appointmentsResult.data ?? [],
    messages: [...(messagesResult.data ?? [])].reverse(),
  };
}

async function resolveToolAssistedBusinessMessage(input: {
  context: StubAiTriageContext;
  decision: TriageDecision;
  publicBusinessFacts: PublicBusinessFacts;
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<{
  policy: TriageResponsePolicy;
  replyDraft: TriageDecision["replyDraft"];
  usage?: ReplyRepairUsage;
}> {
  if (input.decision.responsePolicy.mode !== "tool_assisted_business_message") {
    return {
      policy: input.decision.responsePolicy,
      replyDraft: input.decision.replyDraft,
    };
  }

  const fallbackOwnerQuestion =
    input.decision.responsePolicy.ownerQuestion ??
    (input.decision.responsePolicy.informationNeed
      ? `Can you confirm ${input.decision.responsePolicy.informationNeed}?`
      : "What should I tell the customer about this?");
  const pendingResolution = {
    policy: {
      ...input.decision.responsePolicy,
      ownerQuestion: fallbackOwnerQuestion,
    },
    replyDraft: input.decision.replyDraft,
  };
  const apiKey = openAiApiKey();
  if (!apiKey) {
    return pendingResolution;
  }

  const scopedContext = await loadScopedReplyLookupContext(
    input.supabase,
    input.workspaceId,
    input.context.conversationId,
  );
  const replyWriting =
    input.context.replyWriting ?? DEFAULT_REPLY_WRITING_SETTINGS;
  const prompt = JSON.stringify(
    {
      task: "Answer a legitimate customer question using only the safe scoped Kyro context. If the answer is not available, ask the business owner one focused question so Kyro can finish the customer reply later.",
      rules: [
        "Return JSON only.",
        "Use only the supplied public business facts and this conversation's messages and appointments.",
        "Do not expose internal notes, private contact data, secrets, identifiers, or unrelated workspace records.",
        "Do not invent a fact, promise, price, availability, booking, or policy.",
        "If the answer is available, set answerAvailable true, ownerQuestion null, and write a concise complete customer reply.",
        "If the answer is unavailable, set answerAvailable false and ask exactly one focused ownerQuestion that would unlock the reply.",
        "When asking the owner, keep the customer draft pending. The draft may politely acknowledge the message but must not pretend the missing answer is known.",
        "Do not turn this into a service-intake checklist and do not ask for unrelated job details.",
        ...replyWritingPromptRules(
          replyWriting,
          input.context.inboundChannelType,
          firstCustomerTurnFromCount(input.context.threadMessageCount),
        ).map((rule) => `Writing style - ${rule}`),
      ],
      informationNeed: input.decision.responsePolicy.informationNeed ?? null,
      initialOwnerQuestion: input.decision.responsePolicy.ownerQuestion ?? null,
      latestCustomerMessage: input.context.latestMessage ?? null,
      initialDraft: input.decision.replyDraft,
      publicBusinessFacts: input.publicBusinessFacts,
      scopedContext,
    },
    null,
    2,
  );
  const model = openAiTriageModel();
  const response = await fetchAiProvider(
    "https://api.openai.com/v1/responses",
    {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You are Kyro's scoped business-answer resolver. Return compact JSON matching the requested contract.",
        max_output_tokens: openAiReplyRepairMaxOutputTokens(),
        model,
        ...openAiReasoningRequest(
          model,
          "OPENAI_REPLY_REPAIR_REASONING_EFFORT",
          "low",
        ),
        text: {
          format: {
            name: "kyro_scoped_business_answer",
            schema: {
              additionalProperties: false,
              properties: {
                answerAvailable: { type: "boolean" },
                informationNeed: { type: ["string", "null"] },
                ownerQuestion: { type: ["string", "null"] },
                reason: { type: ["string", "null"] },
                replyDraft: {
                  additionalProperties: false,
                  properties: {
                    body: { type: ["string", "null"] },
                    subject: { type: ["string", "null"] },
                  },
                  required: ["subject", "body"],
                  type: "object",
                },
              },
              required: [
                "answerAvailable",
                "informationNeed",
                "ownerQuestion",
                "reason",
                "replyDraft",
              ],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return pendingResolution;
  }

  const content = responseOutputText(payload);
  if (!content) {
    return pendingResolution;
  }

  const parsed = extractJsonObject(content);
  const replyDraft = objectRecord(parsed.replyDraft);
  const answerAvailable = parsed.answerAvailable === true;
  const ownerQuestion = answerAvailable
    ? null
    : (textValue(parsed.ownerQuestion) ?? fallbackOwnerQuestion);
  const usage = responseUsage(payload, prompt, content);

  return {
    policy: {
      ...input.decision.responsePolicy,
      informationNeed:
        textValue(parsed.informationNeed) ??
        input.decision.responsePolicy.informationNeed,
      ownerQuestion,
      reason: textValue(parsed.reason) ?? input.decision.responsePolicy.reason,
    },
    replyDraft: {
      body: textValue(replyDraft.body) ?? input.decision.replyDraft.body,
      subject:
        textValue(replyDraft.subject) ?? input.decision.replyDraft.subject,
    },
    usage: {
      inputTokens: usage.inputTokens,
      model,
      outputTokens: usage.outputTokens,
      providerUsageId: usage.providerUsageId,
      source: "inbound_triage_tool_assisted_lookup",
      tokenUsage: usage.tokenUsage,
    },
  };
}

async function resolveTriageDecision(context: StubAiTriageContext) {
  if (["local", "ollama"].includes(aiProviderMode())) {
    try {
      return await runOllamaTriage(context);
    } catch (error) {
      return buildStubDecision(
        context,
        error instanceof Error ? error.message : "Local Ollama triage failed.",
      );
    }
  }

  if (aiProviderMode() === "openai") {
    try {
      return await runOpenAiTriage(context);
    } catch (error) {
      return buildStubDecision(
        context,
        error instanceof Error
          ? error.message
          : "OpenAI triage request failed.",
      );
    }
  }

  // No provider that can write. Every inquiry taking this path gets classified
  // by local rules and no drafted reply at all, so it must say so out loud.
  //
  // It used to pass no reason, leaving fallbackReason null on the one path
  // where nothing had thrown to explain itself -- the two branches above both
  // report their error and only this one stayed quiet. Until recently the
  // resulting zero-proposal run crashed, and that crash was the only signal
  // anyone got. With the crash fixed, silence here would mean Kyro quietly
  // stops answering inquiries and nothing anywhere says why.
  const reason = `No AI provider is configured for triage (AI_PROVIDER=${aiProviderMode()}), so no reply was drafted.`;

  console.error(`Triage fell back to the stub: ${reason}`);

  return buildStubDecision(context, reason);
}

function buildActionProposals(
  aiRunId: string,
  eventId: string,
  context: StubAiTriageContext,
  facts: InquiryFacts,
  replyDraft: TriageDecision["replyDraft"],
  verifiedAvailability: VerifiedInquiryAvailability | null = null,
) {
  const baseInput = {
    sourceAiRunId: aiRunId,
    sourceEventId: context.sourceEventId ?? eventId,
    leadId: context.leadId ?? null,
    contactId: context.contactId ?? null,
    conversationId: context.conversationId ?? null,
    messageId: context.messageId ?? null,
    inquiryFacts: facts,
    verifiedAvailability,
    threadMessageCount: context.threadMessageCount ?? null,
    threadSummary: context.threadSummary ?? null,
    dryRun: true,
    channelType: outboundReplyChannelForInquiryContext(context),
  };
  // No draft, no reply action. Proposing one with an empty body would only
  // fail later at send time, and filling it here would mean this file writing
  // to a customer.
  const proposals: ProposedActionInput[] = replyDraft.body
    ? [
        {
          input: {
            ...baseInput,
            subject: replyDraft.subject,
            body: replyDraft.body,
          },
          policyReason:
            "Stub AI triage drafts outbound replies but never sends them.",
          targetId: context.conversationId ?? null,
          targetType: "conversation",
          type: "draft_reply",
        },
      ]
    : [];

  if (facts.fit === "not_fit") {
    proposals.push({
      input: {
        ...baseInput,
        reason: "The conversation indicates the inquiry should be closed.",
      },
      policyReason: "Lead closure proposals require user approval.",
      targetId: context.leadId ?? null,
      targetType: "lead",
      type: "mark_not_fit",
    });

    return proposals;
  }

  return proposals;
}

/**
 * How long triage will wait on Google before giving up on an address.
 *
 * Verification is two chained HTTP calls, each with the 30s provider ceiling,
 * so a bad day could add a minute to a turn that exists to answer a customer.
 * The address is worth having but never worth stalling the reply for, so this
 * caps the pair well under either call's own timeout.
 */
const ADDRESS_VERIFICATION_TIMEOUT_MS = 12_000;

/**
 * Verify an address the model pulled out of an inbound message.
 *
 * Triage is autonomous: there is no one to ask when the text is ambiguous, so
 * anything short of a Google match is stored as the customer's own words with
 * an `unverified` status. That status is what the CRM badge reads, which is the
 * whole reason this runs -- an address nobody confirmed should look different
 * from one Google stands behind.
 *
 * Returns null when there is nothing to store, and never rejects: a failed
 * lookup must not take down a turn that has a reply to send.
 */
async function resolveInquiryFactsAddress({
  address,
  conversationId,
  region,
  supabase,
  userId,
  workspaceId,
}: {
  address: string | null;
  conversationId: string | null;
  region: PhoneRegion | null;
  supabase: SupabaseClient;
  userId: string | null;
  workspaceId: string;
}): Promise<AddressColumnUpdates | null> {
  const text = textValue(address);

  if (!text) {
    return null;
  }

  try {
    // A thread where the customer repeats the address would otherwise pay for
    // the same lookup on every message.
    if (conversationId) {
      const { data: stored } = await supabase
        .from("inquiry_facts")
        .select(
          "address,address_administrative_area,address_country_code,address_latitude,address_line1,address_line2,address_locality,address_longitude,address_place_id,address_postal_code,address_source,address_structured,address_validated_at,address_validation_status",
        )
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", conversationId)
        .maybeSingle();

      if (
        stored &&
        textValue(stored.address) === text &&
        textValue(stored.address_validation_status) !== "unverified"
      ) {
        return {
          address: textValue(stored.address),
          address_administrative_area: textValue(
            stored.address_administrative_area,
          ),
          address_country_code: textValue(stored.address_country_code),
          address_latitude: textValue(stored.address_latitude),
          address_line1: textValue(stored.address_line1),
          address_line2: textValue(stored.address_line2),
          address_locality: textValue(stored.address_locality),
          address_longitude: textValue(stored.address_longitude),
          address_place_id: textValue(stored.address_place_id),
          address_postal_code: textValue(stored.address_postal_code),
          address_source: textValue(stored.address_source) ?? "triage",
          address_structured: objectRecord(stored.address_structured),
          address_validated_at: textValue(stored.address_validated_at),
          address_validation_status: (textValue(
            stored.address_validation_status,
          ) ??
            "unverified") as AddressColumnUpdates["address_validation_status"],
        };
      }
    }

    const verification = await Promise.race([
      verifyAddressText({ address: text, region, source: "triage" }),
      new Promise<null>((resolve) => {
        setTimeout(
          () => resolve(null),
          ADDRESS_VERIFICATION_TIMEOUT_MS,
        ).unref?.();
      }),
    ]);

    if (!verification) {
      console.error(
        `Address verification timed out after ${ADDRESS_VERIFICATION_TIMEOUT_MS}ms; storing the address unverified.`,
      );

      return unverifiedAddressFields(text, "triage");
    }

    if (verification.updates.address_validation_status !== "validated") {
      console.warn(
        `Inquiry address stored as ${verification.updates.address_validation_status}${
          verification.verificationNote
            ? `: ${verification.verificationNote}`
            : "."
        }`,
      );
    }

    void meterAddressVerification({
      calls: verification.calls,
      status: verification.updates.address_validation_status,
      supabase,
      userId,
      workspaceId,
    });

    return verification.updates;
  } catch (error) {
    console.error(
      error instanceof Error
        ? `Unable to verify inquiry address: ${error.message}`
        : "Unable to verify inquiry address.",
    );

    return unverifiedAddressFields(text, "triage");
  }
}

/**
 * Bill the lookups the same way the interactive address routes do, so an
 * address Kyro verified on its own is not invisible on the usage bill.
 *
 * Charges only the endpoints that were actually reached. A workspace with no
 * Google key, or an address too vague to look up, costs nothing and must not
 * appear on the bill as though it did.
 */
function meterAddressVerification({
  calls,
  status,
  supabase,
  userId,
  workspaceId,
}: {
  calls: AddressVerificationCalls;
  status: string;
  supabase: SupabaseClient;
  userId: string | null;
  workspaceId: string;
}) {
  const metadata = { sourceRoute: "ai.triage.inquiry_facts", status };
  const billed: Array<Promise<unknown>> = [];

  if (calls.autocomplete) {
    billed.push(
      recordGoogleApiUsage(supabase, {
        kind: "places_autocomplete",
        metadata,
        userId,
        workspaceId,
      }),
    );
  }

  if (calls.placeDetails) {
    billed.push(
      recordGoogleApiUsage(supabase, {
        kind: "places_details",
        metadata,
        userId,
        workspaceId,
      }),
    );
  }

  if (calls.validation) {
    billed.push(
      recordGoogleApiUsage(supabase, {
        kind: "address_validation",
        metadata,
        userId,
        workspaceId,
      }),
    );
  }

  return Promise.all(billed).catch((usageError) => {
    console.error(
      usageError instanceof Error
        ? usageError.message
        : "Unable to record Google address verification usage.",
    );
  });
}

async function patchContactFromExtractedInquiryFacts({
  addressColumns,
  aiRunId,
  facts,
  supabase,
  triageContext,
  workspaceId,
}: {
  addressColumns: AddressColumnUpdates | null;
  aiRunId: string;
  facts: InquiryFacts;
  supabase: SupabaseClient;
  triageContext: StubAiTriageContext;
  workspaceId: string;
}) {
  if (!triageContext.contactId) {
    return;
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id,email,phone,address,address_validation_status")
    .eq("workspace_id", workspaceId)
    .eq("id", triageContext.contactId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load contact for fact update: ${error.message}`);
  }

  if (!contact) {
    return;
  }

  const generalSettings = await getWorkspaceGeneralSettings(
    supabase,
    workspaceId,
  );
  const defaultPhoneRegion =
    triageContext.defaultPhoneRegion ?? generalSettings.defaultPhoneRegion;
  const text = triageSourceText(triageContext);
  const email = inferEmail(text);
  const phone = inferPhone(text, defaultPhoneRegion);
  const updates: Record<string, unknown> = {};

  // The same rule lives in inbound/manual.ts, which is how the two drifted:
  // the fix for a corrected address went in there first and had no effect,
  // because an email inquiry updates the contact from here instead.
  if (
    addressWorthLearning(
      {
        address: textValue(contact.address),
        addressValidationStatus: textValue(contact.address_validation_status),
      },
      facts.address,
    )
  ) {
    // Carry the structured columns across too. Writing `address` alone left the
    // contact holding a bare line of text with a default `unverified` status,
    // even when Google had just confirmed the very same address for the
    // conversation it came from.
    Object.assign(
      updates,
      addressColumns ?? unverifiedAddressFields(facts.address, "triage"),
    );
  }

  if (!textValue(contact.email) && email) {
    updates.email = email;
    updates.normalized_email = email;
  }

  if (!textValue(contact.phone) && phone) {
    updates.phone = phone;
    updates.normalized_phone = phone;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  const { error: updateError } = await supabase
    .from("contacts")
    .update(updates)
    .eq("workspace_id", workspaceId)
    .eq("id", triageContext.contactId);

  if (updateError) {
    throw new Error(
      `Unable to update contact from inquiry facts: ${updateError.message}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "ai",
    actorId: aiRunId,
    action: "contact.facts_extracted_from_inquiry",
    entityType: "contact",
    entityId: triageContext.contactId,
    after: updates,
    metadata: {
      conversationId: triageContext.conversationId ?? null,
      messageId: triageContext.messageId ?? null,
      source: triageContext.source ?? null,
      aiRunId,
    },
  });
}

export async function loadLatestInboundMessageBody(
  supabase: SupabaseClient,
  workspaceId: string,
  messageId?: string | null,
) {
  if (!messageId) {
    return null;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("body_text")
    .eq("workspace_id", workspaceId)
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load the latest inbound message: ${error.message}`,
    );
  }

  return textValue(data?.body_text);
}

export async function runStubAiTriage(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  context: StubAiTriageContext = {},
) {
  const routeRequest: ModelRouteRequest = {
    workspaceId,
    userId: user.id,
    taskType: "inbound_triage",
    riskLevel: "low",
    requiredCapabilities: [
      "classification",
      "lead_extraction",
      "action_proposal",
    ],
    latencyTargetMs: 1500,
    estimatedInputTokens: 900,
  };
  const route = selectModelRoute(routeRequest);
  const idempotencyKey = `ai.triage.stub.${crypto.randomUUID()}`;

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      type: "ai.triage.requested",
      source: context.source ?? "web.dashboard",
      idempotency_key: idempotencyKey,
      payload: {
        requestedByUserId: user.id,
        routeRequest,
        sourceEventId: context.sourceEventId ?? null,
        contactId: context.contactId ?? null,
        leadId: context.leadId ?? null,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        threadMessageCount: context.threadMessageCount ?? null,
      },
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .select("id,type,status")
    .single();

  if (eventError || !event) {
    throw new Error(
      `Unable to record AI triage event: ${eventError?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "ai_triage.requested",
    entityType: "event",
    entityId: String(event.id),
    after: {
      type: event.type,
      status: event.status,
    },
  });

  const { data: aiRun, error: aiRunError } = await supabase
    .from("ai_runs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      mode: "workflow",
      task_type: routeRequest.taskType,
      risk_level: routeRequest.riskLevel,
      provider: route.provider,
      model: route.model,
      status: "running",
      input_refs: {
        eventId: event.id,
        sourceEventId: context.sourceEventId ?? null,
        contactId: context.contactId ?? null,
        leadId: context.leadId ?? null,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        threadMessageCount: context.threadMessageCount ?? null,
        threadSummary: context.threadSummary ?? null,
        source: context.source ?? "dashboard_smoke_test",
      },
      output: {},
      tool_calls: [],
      usage: {},
      estimated_cost: "0.0003",
    })
    .select("id")
    .single();

  if (aiRunError || !aiRun) {
    throw new Error(
      `Unable to create AI run: ${aiRunError?.message ?? "unknown error"}`,
    );
  }

  const aiRunId = String(aiRun.id);

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "ai",
    actorId: aiRunId,
    action: "ai_run.started",
    entityType: "ai_run",
    entityId: aiRunId,
    after: {
      provider: route.provider,
      model: route.model,
      taskType: routeRequest.taskType,
    },
  });

  const [
    communicationSettings,
    futureStep,
    latestMessageBody,
    generalSettings,
    voiceSettings,
  ] = await Promise.all([
    getCommunicationSettings(supabase, workspaceId),
    context.conversationId
      ? getActiveInquiryFutureStep(
          supabase,
          workspaceId,
          context.conversationId,
          { kind: "calendar_confirmation" },
        )
      : Promise.resolve(null),
    loadLatestInboundMessageBody(supabase, workspaceId, context.messageId),
    getWorkspaceGeneralSettings(supabase, workspaceId),
    getVoiceSettings(supabase, workspaceId),
  ]);

  const triageContext: StubAiTriageContext = {
    ...context,
    futureStep,
    latestMessage: latestMessageBody ?? context.latestMessage,
    publicBusinessFacts:
      context.publicBusinessFacts ??
      publicBusinessFactsFromProfile(generalSettings.businessProfile),
    replyWriting: context.replyWriting ?? communicationSettings.replyWriting,
  };
  const rawTriageDecision = await resolveTriageDecision(triageContext);
  const publicBusinessFacts =
    triageContext.publicBusinessFacts ??
    publicBusinessFactsFromProfile(generalSettings.businessProfile);
  const directFactKeys = directKnownBusinessFactKeys(
    triageContext.latestMessage ?? "",
  ).filter((key) => Boolean(textValue(publicBusinessFacts[key])));
  const responsePolicy =
    directFactKeys.length > 0
      ? {
          factKeys: directFactKeys,
          informationNeed: null,
          mode: "known_business_fact" as const,
          ownerQuestion: null,
          reason:
            "The customer directly asked for a saved public business fact.",
        }
      : rawTriageDecision.responsePolicy;
  const knownFactCandidate =
    responsePolicy.mode === "known_business_fact" &&
    responsePolicy.factKeys.length > 0 &&
    responsePolicy.factKeys.every((key) =>
      Boolean(textValue(publicBusinessFacts[key])),
    );
  const knownFactDraft = knownFactCandidate
    ? await ensureKnownBusinessFactReply({
        context: triageContext,
        factKeys: responsePolicy.factKeys,
        publicBusinessFacts,
        replyDraft: rawTriageDecision.replyDraft,
      })
    : {
        repairUsage: undefined,
        replyDraft: rawTriageDecision.replyDraft,
      };
  let factAwareTriageDecision: TriageDecision = {
    ...rawTriageDecision,
    repairUsage: knownFactDraft.repairUsage
      ? [...(rawTriageDecision.repairUsage ?? []), knownFactDraft.repairUsage]
      : rawTriageDecision.repairUsage,
    replyDraft: knownFactDraft.replyDraft,
    responsePolicy,
  };
  const toolAssistedResolution = await resolveToolAssistedBusinessMessage({
    context: triageContext,
    decision: factAwareTriageDecision,
    publicBusinessFacts,
    supabase,
    workspaceId,
  });
  factAwareTriageDecision = {
    ...factAwareTriageDecision,
    repairUsage: toolAssistedResolution.usage
      ? [
          ...(factAwareTriageDecision.repairUsage ?? []),
          toolAssistedResolution.usage,
        ]
      : factAwareTriageDecision.repairUsage,
    replyDraft: toolAssistedResolution.replyDraft,
    responsePolicy: toolAssistedResolution.policy,
  };
  const knownFactResponse = canAnswerWithKnownBusinessFacts({
    publicBusinessFacts,
    replyBody: factAwareTriageDecision.replyDraft.body,
    responsePolicy: factAwareTriageDecision.responsePolicy,
  });
  const knownFactAutoReply = canAutoReplyWithKnownBusinessFacts({
    enabled: communicationSettings.autoReplyKnownBusinessFacts,
    fallbackReason: factAwareTriageDecision.fallbackReason,
    latestMessage: triageContext.latestMessage ?? "",
    providerUsed: factAwareTriageDecision.providerUsed,
    publicBusinessFacts,
    replyBody: factAwareTriageDecision.replyDraft.body,
    responsePolicy: factAwareTriageDecision.responsePolicy,
  });
  const responseMode = factAwareTriageDecision.responsePolicy.mode;
  const serviceInquiryResponse = responseMode === "service_inquiry";
  const inquiryFacts = applyResponsePolicyToInquiryFacts(
    factAwareTriageDecision.inquiryFacts,
    triageContext,
    factAwareTriageDecision.responsePolicy,
  );
  let effectiveInquiryFacts = inquiryFacts;
  let verifiedAvailability: VerifiedInquiryAvailability | null = null;
  // Started before the availability lookup so the two network waits overlap;
  // awaited below, before the reply is repaired, so the draft quotes the same
  // address that gets stored.
  const addressColumnsPromise = resolveInquiryFactsAddress({
    address: inquiryFacts.address,
    conversationId: context.conversationId ?? null,
    region:
      triageContext.defaultPhoneRegion ?? generalSettings.defaultPhoneRegion,
    supabase,
    userId: user?.id ?? null,
    workspaceId,
  });

  if (
    shouldResolveAvailabilityForTriage({
      inboundInquiryMode: voiceSettings.phoneAgentInboundInquiryMode,
      preferredTime: inquiryFacts.preferredTime,
      responseMode,
    })
  ) {
    const calendarRange = calendarDateRangeFromPrompts(
      inquiryFacts.preferredTime ?? "",
      triageContext.latestMessage,
      generalSettings.timeZone,
      new Date(),
    );

    if (calendarRange) {
      // The date parser answers "which day", never "which part of the day".
      // A customer who wrote that he was at work until four and asked for
      // Friday after two was offered Friday 7:00 AM: "Friday afternoon, any
      // time after two" resolves to midnight-to-midnight, and this took the
      // first slot in it. The day was honoured and the hour thrown away, which
      // is the same failure as offering a day someone ruled out.
      const timeOfDay =
        preferredTimeOfDayWindow(triageContext.latestMessage) ??
        preferredTimeOfDayWindow(inquiryFacts.preferredTime);
      const availability = await findWorkspaceAvailableSlots({
        from: calendarRange.from,
        // One slot is enough only when any slot will do. With a time of day to
        // honour, the first few may all fall outside it.
        limit: timeOfDay ? 24 : 1,
        supabase,
        to: calendarRange.to,
        workspaceId,
      });
      const firstAvailableSlot = availability.slots.find((slot) =>
        slotMatchesTimeOfDay(slot.startsAt, availability.timeZone, timeOfDay),
      );

      // Nothing inside the window means Kyro offers no time at all and asks
      // instead. Silence is recoverable; proposing the hour they already said
      // they cannot do is the thing that loses the job.
      if (firstAvailableSlot) {
        verifiedAvailability = {
          endsAt: firstAvailableSlot.endsAt,
          label: firstAvailableSlot.label,
          startsAt: firstAvailableSlot.startsAt,
          timeZone: availability.timeZone,
        };
        effectiveInquiryFacts = inquiryFactsWithVerifiedAvailability(
          inquiryFacts,
          verifiedAvailability,
        );
      }
    }
  }

  const addressColumns = await addressColumnsPromise;
  const resolvedAddress = addressColumns
    ? textValue(addressColumns.address)
    : null;

  if (resolvedAddress && resolvedAddress !== effectiveInquiryFacts.address) {
    // Google's formatting of an address it matched, so the reply, the proposed
    // actions and the stored fact all say the same thing.
    effectiveInquiryFacts = {
      ...effectiveInquiryFacts,
      address: resolvedAddress,
    };
  }

  const repairedDraft = !serviceInquiryResponse
    ? {
        repairUsage: undefined,
        replyDraft: factAwareTriageDecision.replyDraft,
      }
    : await repairReplyDraftWithOpenAi({
        context: triageContext,
        facts: effectiveInquiryFacts,
        model: route.model,
        replyDraft: factAwareTriageDecision.replyDraft,
        verifiedAvailability,
      });
  const triageDecision: TriageDecision = {
    ...factAwareTriageDecision,
    inquiryFacts: effectiveInquiryFacts,
    repairUsage: repairedDraft.repairUsage
      ? [
          ...(factAwareTriageDecision.repairUsage ?? []),
          repairedDraft.repairUsage,
        ]
      : factAwareTriageDecision.repairUsage,
    replyDraft: repairedDraft.replyDraft,
  };
  const { error: routeError } = await supabase
    .from("model_route_decisions")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      ai_run_id: aiRunId,
      task_type: routeRequest.taskType,
      risk_level: routeRequest.riskLevel,
      selected_provider: route.provider,
      selected_model: route.model,
      fallback_used:
        (route.provider === "ollama" &&
          triageDecision.providerUsed !== "ollama") ||
        (route.provider === "openai" &&
          triageDecision.providerUsed !== "openai"),
      decision_reason: route.reason,
      budget_snapshot: {
        fallbackReason: triageDecision.fallbackReason ?? null,
        knownFactAutoReply,
        knownFactResponse,
        responseMode,
        estimatedInputTokens: routeRequest.estimatedInputTokens,
        providerUsed: triageDecision.providerUsed,
        replyRepairLoops: triageDecision.repairUsage?.length ?? 0,
      },
    });

  if (routeError) {
    throw new Error(
      `Unable to record model route decision: ${routeError.message}`,
    );
  }

  const inputTokens = triageDecision.inputTokens ?? 900;
  const outputTokens = triageDecision.outputTokens ?? 180;
  const tokenUsage =
    triageDecision.tokenUsage ??
    openAiUsageFromTokenCounts({
      estimated: Boolean(triageDecision.fallbackReason),
      inputTokens,
      outputTokens,
    });
  const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
    supabase,
    workspaceId,
    "OPENAI_LLM_MARKUP_RATE",
  );
  const mainUsageEvents = buildLlmUsageEvents({
    context: {
      aiRunId,
      metadata: {
        providerUsed: triageDecision.providerUsed,
        source: "inbound_triage",
      },
      providerUsageId: triageDecision.providerUsageId,
      sourceId: aiRunId,
      sourceType: "ai_run",
      usageMarkupRate,
      userId: user.id,
      workspaceId,
    },
    model: route.model,
    provider:
      triageDecision.providerUsed === "openai"
        ? "openai"
        : triageDecision.providerUsed,
    service: "llm",
    usage: tokenUsage,
  });
  const repairUsageEvents = (triageDecision.repairUsage ?? []).flatMap(
    (repair, index) =>
      buildLlmUsageEvents({
        context: {
          aiRunId,
          metadata: {
            providerUsed: "openai",
            repairIndex: index + 1,
            source: repair.source ?? "inbound_triage_reply_repair",
          },
          providerUsageId: repair.providerUsageId,
          sourceId: aiRunId,
          sourceType: "ai_run",
          usageMarkupRate,
          userId: user.id,
          workspaceId,
        },
        model: repair.model,
        provider: "openai",
        service: "llm",
        usage: repair.tokenUsage,
      }),
  );
  const usageEvents = [...mainUsageEvents, ...repairUsageEvents];
  const usageTotals = usageEventTotals(usageEvents);

  // Unlike the message-generation callers, this runs in a background job where
  // the work is retried, so a failure here is worth stopping for.
  const { error: usageError } = await recordUsageEvents(supabase, {
    context: "triage",
    events: usageEvents,
    workspaceId,
  });

  if (usageError) {
    throw usageError;
  }

  await patchContactFromExtractedInquiryFacts({
    addressColumns,
    aiRunId,
    facts: effectiveInquiryFacts,
    supabase,
    triageContext,
    workspaceId,
  });

  const futureStepTransition =
    futureStep && triageContext.conversationId
      ? await applyInquiryFutureStepDecision({
          actorId: aiRunId,
          conversationId: triageContext.conversationId,
          decision: triageDecision.futureStepDecision,
          messageId: triageContext.messageId,
          step: futureStep,
          supabase,
          workspaceId,
        })
      : null;

  const actionProposals = buildActionProposals(
    aiRunId,
    String(event.id),
    triageContext,
    effectiveInquiryFacts,
    triageDecision.replyDraft,
    verifiedAvailability,
  ).filter(
    (proposal) => serviceInquiryResponse || proposal.type === "draft_reply",
  );
  const output = {
    classification:
      responseMode === "service_inquiry" ? "new_lead_follow_up" : responseMode,
    confidence: triageDecision.providerUsed === "ollama" ? 0.76 : 0.86,
    fallbackReason: triageDecision.fallbackReason ?? null,
    futureStepDecision: triageDecision.futureStepDecision,
    futureStepTransition,
    inquiryFacts: effectiveInquiryFacts,
    knownFactAutoReply,
    knownFactResponse,
    responseMode,
    responsePolicy: triageDecision.responsePolicy,
    ownerQuestion: triageDecision.responsePolicy.ownerQuestion,
    authoritativeFactsUsed: Boolean(triageContext.inquiryFactsOverride),
    providerUsed: triageDecision.providerUsed,
    replyRepairLoops: triageDecision.repairUsage?.length ?? 0,
    replyRepairUsed: Boolean(triageDecision.repairUsage?.length),
    summary: triageDecision.summary,
    threadMessageCount: triageContext.threadMessageCount ?? null,
    proposedActionTypes: actionProposals.map((proposal) => proposal.type),
  };

  const { error: completeError } = await supabase
    .from("ai_runs")
    .update({
      status: "completed",
      output,
      usage: {
        cachedInputTokens: tokenUsage.cachedInputTokens,
        customerCharge: usageTotals.customerChargeSnapshot,
        inputTokens,
        outputTokens,
        reasoningTokens: tokenUsage.reasoningTokens,
        totalTokens: tokenUsage.totalTokens,
      },
      actual_cost: String(usageTotals.costSnapshot),
      latency_ms: 320,
      completed_at: new Date().toISOString(),
    })
    .eq("id", aiRunId);

  if (completeError) {
    throw new Error(`Unable to complete AI run: ${completeError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "ai",
    actorId: aiRunId,
    action: "ai_run.completed",
    entityType: "ai_run",
    entityId: aiRunId,
    after: {
      status: "completed",
      output,
      actualCost: usageTotals.costSnapshot,
      customerCharge: usageTotals.customerChargeSnapshot,
    },
  });

  if (context.conversationId) {
    const factsSource = context.inquiryFactsOverride
      ? "user_corrected_regeneration"
      : triageDecision.providerUsed === "ollama"
        ? "ai_ollama"
        : triageDecision.providerUsed === "openai"
          ? "ai_openai"
          : "ai_stub";
    const factsMetadata = {
      authoritativeFactsUsed: Boolean(context.inquiryFactsOverride),
      fallbackReason: triageDecision.fallbackReason ?? null,
      providerUsed: triageDecision.providerUsed,
      quoteRequested: /\b(?:quote|estimate|pricing)\b/i.test(
        triageSourceText(triageContext),
      ),
      responseMode,
    };
    let factsRecord: { id: string } | null = null;
    let factsError: { message: string } | null = null;

    if (!serviceInquiryResponse) {
      const { data: existingFacts, error: existingFactsError } = await supabase
        .from("inquiry_facts")
        .select("id,metadata")
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", context.conversationId)
        .maybeSingle();

      if (existingFactsError) {
        factsError = existingFactsError;
      } else if (existingFacts) {
        const updateResult = await supabase
          .from("inquiry_facts")
          .update({
            source_ai_run_id: aiRunId,
            source: factsSource,
            metadata: {
              ...objectRecord(existingFacts.metadata),
              ...factsMetadata,
            },
          })
          .eq("id", existingFacts.id)
          .select("id")
          .single();

        factsRecord = updateResult.data;
        factsError = updateResult.error;
      }
    }

    if (!factsRecord && !factsError) {
      const upsertResult = await supabase
        .from("inquiry_facts")
        .upsert(
          {
            workspace_id: workspaceId,
            conversation_id: context.conversationId,
            contact_id: context.contactId ?? null,
            lead_id: context.leadId ?? null,
            source_ai_run_id: aiRunId,
            job_type: effectiveInquiryFacts.jobType,
            ...(addressColumns ?? { address: effectiveInquiryFacts.address }),
            preferred_time: effectiveInquiryFacts.preferredTime,
            urgency: effectiveInquiryFacts.urgency,
            budget: effectiveInquiryFacts.budget,
            fit: effectiveInquiryFacts.fit,
            missing_info: effectiveInquiryFacts.missingInfo,
            source: factsSource,
            edited_by_user_id: context.inquiryFactsOverride ? user.id : null,
            metadata: factsMetadata,
          },
          {
            onConflict: "workspace_id,conversation_id",
          },
        )
        .select("id")
        .single();

      factsRecord = upsertResult.data;
      factsError = upsertResult.error;
    }

    if (factsError || !factsRecord) {
      throw new Error(
        `Unable to save inquiry facts: ${factsError?.message ?? "unknown error"}`,
      );
    }

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "ai",
      actorId: aiRunId,
      action: "inquiry_facts.extracted",
      entityType: "inquiry_facts",
      entityId: String(factsRecord.id),
      after: {
        conversationId: context.conversationId,
        inquiryFacts: effectiveInquiryFacts,
        source: triageDecision.providerUsed,
      },
      metadata: {
        aiRunId,
      },
    });
  }

  const approvalRequired = !knownFactAutoReply;
  const actionStatus = getInitialActionStatus(approvalRequired);
  const { data: actions, error: actionError } = await supabase
    .from("actions")
    .insert(
      actionProposals.map((proposal) => ({
        workspace_id: workspaceId,
        type: proposal.type,
        status: actionStatus,
        requested_by: "ai",
        requested_by_ai_run_id: aiRunId,
        approval_required: approvalRequired,
        target_type: proposal.targetType,
        target_id: proposal.targetId,
        input: proposal.input,
        result: {},
        policy_snapshot: {
          mode: knownFactAutoReply
            ? "auto_known_business_fact"
            : "require_approval",
          reason: knownFactAutoReply
            ? "The reply answers only a basic public business fact saved in the workspace profile."
            : proposal.policyReason,
        },
      })),
    )
    .select("id,type,status");

  if (actionError) {
    throw new Error(
      `Unable to create AI proposed action: ${actionError.message}`,
    );
  }

  // Having nothing to propose is a real outcome, not a database failure. A
  // classification that needs no reply legitimately proposes nothing, and a
  // model whose response arrived truncated leaves no draft body to propose.
  // Both used to surface as "unknown error", which named the wrong layer and
  // sent the last hour looking at the actions table.
  //
  // Loud rather than silent: the reason is already on the ai_run, and this
  // says where to find it.
  if (actionProposals.length === 0) {
    console.warn(
      `Triage proposed no actions for event ${String(event.id)} (run ${aiRunId}). Response mode ${responseMode}, provider ${triageDecision.providerUsed}. If a reply was expected, the draft body was empty -- check the ai_runs row for a truncated or unparsed model response.`,
    );
  }

  for (const action of actions ?? []) {
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "ai",
      actorId: aiRunId,
      action: "action.proposed",
      entityType: "action",
      entityId: String(action.id),
      after: {
        type: action.type,
        status: action.status,
      },
      metadata: {
        aiRunId,
        route,
      },
    });
  }

  // Undefined when nothing was proposed. Everything below needs a real action
  // to hang off -- a future step points at one, the auto-reply executes one,
  // and the return value names one -- so every read of it is guarded.
  //
  // This comment used to claim that and only two of the four sites were. The
  // audit log and the returned actionId both dereferenced it, so a triage that
  // proposed nothing threw on `.id` of undefined after all its work had already
  // been persisted.
  const primaryAction =
    actions?.find((action) => String(action.type) === "draft_reply") ??
    actions?.[0];

  if (
    primaryAction &&
    triageDecision.responsePolicy.ownerQuestion &&
    triageContext.conversationId
  ) {
    await upsertBusinessAnswerFutureStep({
      actionId: String(primaryAction.id),
      contactId: triageContext.contactId,
      conversationId: triageContext.conversationId,
      informationNeed: triageDecision.responsePolicy.informationNeed,
      leadId: triageContext.leadId,
      messageId: triageContext.messageId,
      ownerQuestion: triageDecision.responsePolicy.ownerQuestion,
      supabase,
      workspaceId,
    });
  }
  let autoReplyError: string | null = null;
  let autoReplySent = false;

  if (knownFactAutoReply && primaryAction) {
    try {
      await executeAction(supabase, user, String(primaryAction.id));
      autoReplySent = true;

      await insertAuditLog(supabase, {
        workspaceId,
        actorType: "ai",
        actorId: aiRunId,
        action: "action.auto_executed_known_business_fact",
        entityType: "action",
        entityId: String(primaryAction.id),
        after: {
          status: "completed",
          type: primaryAction.type,
        },
        metadata: {
          aiRunId,
          responsePolicy: triageDecision.responsePolicy,
        },
      });
    } catch (error) {
      autoReplyError =
        error instanceof Error
          ? error.message
          : "Automatic business-fact reply failed.";

      await insertAuditLog(supabase, {
        workspaceId,
        actorType: "ai",
        actorId: aiRunId,
        action: "action.auto_execution_failed_known_business_fact",
        entityType: "action",
        entityId: String(primaryAction.id),
        after: {
          error: autoReplyError,
          status: "failed",
          type: primaryAction.type,
        },
        metadata: {
          aiRunId,
          responsePolicy: triageDecision.responsePolicy,
        },
      });
    }
  }

  if (context.conversationId && !knownFactAutoReply) {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({
        status: "reply_drafted",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", context.conversationId);

    if (conversationError) {
      throw new Error(
        `Unable to mark conversation reply drafted: ${conversationError.message}`,
      );
    }

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "ai",
      actorId: aiRunId,
      action: "conversation.reply_drafted",
      entityType: "conversation",
      entityId: context.conversationId,
      after: {
        status: "reply_drafted",
        actionId: primaryAction ? String(primaryAction.id) : null,
        proposedActionCount: actions?.length ?? 0,
      },
      metadata: {
        aiRunId,
      },
    });
  }

  return {
    aiRunId,
    // Null when nothing was proposed. This read was unguarded and threw
    // "Cannot read properties of undefined (reading 'id')" on every triage that
    // produced no action -- which is exactly the path a truncated or stubbed
    // model response takes, so the failure most likely to happen was also the
    // one that crashed instead of reporting itself.
    actionId: primaryAction ? String(primaryAction.id) : null,
    actionIds: (actions ?? []).map((action) => String(action.id)),
    actualCost: usageTotals.costSnapshot,
    customerCharge: usageTotals.customerChargeSnapshot,
    autoReplyError,
    autoReplySent,
    // For the contact record, not the job. Kept off inquiryFacts deliberately
    // -- see the comment on TriageDecision.customerName.
    customerName: triageDecision.customerName,
    inquiryFacts: effectiveInquiryFacts,
    ownerQuestion: triageDecision.responsePolicy.ownerQuestion,
    replyDraft: triageDecision.replyDraft,
    responseMode,
    summary: triageDecision.summary,
    // The slot Kyro checked and is proposing, kept separate from what the
    // customer asked for. Callers that tell the owner about the inquiry need
    // the offer; overwriting preferredTime with it is what caused the drift.
    verifiedAvailability,
  };
}

export async function getAiLedger(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 5,
) {
  const normalizedLimit = Math.max(1, Math.min(250, Math.trunc(limit)));

  const [aiRuns, usageEvents, routeDecisions] = await Promise.all([
    supabase
      .from("ai_runs")
      .select("id,task_type,status,provider,model,actual_cost,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(normalizedLimit),
    supabase
      .from("usage_events")
      .select(
        "id,service,usage_type,quantity,cost_snapshot,customer_charge_snapshot,currency,created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(normalizedLimit),
    supabase
      .from("model_route_decisions")
      .select(
        "id,task_type,selected_provider,selected_model,decision_reason,created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(normalizedLimit),
  ]);

  if (aiRuns.error) {
    throw new Error(`Unable to load AI runs: ${aiRuns.error.message}`);
  }

  if (usageEvents.error) {
    throw new Error(
      `Unable to load usage events: ${usageEvents.error.message}`,
    );
  }

  if (routeDecisions.error) {
    throw new Error(
      `Unable to load route decisions: ${routeDecisions.error.message}`,
    );
  }

  return {
    aiRuns: (aiRuns.data ?? []).map((run) => ({
      id: String(run.id),
      taskType: String(run.task_type),
      status: String(run.status),
      provider: String(run.provider),
      model: String(run.model),
      actualCost:
        run.actual_cost === null || run.actual_cost === undefined
          ? null
          : String(run.actual_cost),
      createdAt: String(run.created_at),
    })) satisfies AiRunItem[],
    usageEvents: (usageEvents.data ?? []).map((usage) => ({
      id: String(usage.id),
      service: String(usage.service),
      usageType: String(usage.usage_type),
      quantity: String(usage.quantity),
      costSnapshot: String(usage.cost_snapshot),
      customerChargeSnapshot: String(usage.customer_charge_snapshot),
      currency: String(usage.currency),
      createdAt: String(usage.created_at),
    })) satisfies UsageLedgerItem[],
    routeDecisions: (routeDecisions.data ?? []).map((decision) => ({
      id: String(decision.id),
      taskType: String(decision.task_type),
      selectedProvider: String(decision.selected_provider),
      selectedModel: String(decision.selected_model),
      decisionReason: String(decision.decision_reason),
      createdAt: String(decision.created_at),
    })) satisfies ModelRouteItem[],
  };
}
