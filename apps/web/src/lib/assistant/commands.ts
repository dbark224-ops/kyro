import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  getContactList,
  getContactProfile,
  getConversationList,
  getQuoteDraftList,
  getQuoteDraftProfile,
  getSkippedEmailSummaries,
  type ContactListItem,
  type ConversationListItem,
  type QuoteDraftListItem,
} from "../crm/queries";
import {
  DOCUMENT_TEMPLATE_POLICY_TYPE,
  type CustomDocumentTemplate,
  documentTemplateDesignSettingsForQuote,
  getDocumentTemplateSettings,
  normalizeDocumentTemplateDesignSettings,
  normalizeDocumentTemplateSettings,
} from "../documents/settings";
import {
  buildQuotePdfArtifactForDraft,
  quotePdfMetadata,
} from "../documents/pdf";
import { createQuoteApprovalLinkForDraft } from "../documents/approval";
import {
  appendQuoteDocumentHistory,
  quoteDocumentChangedSinceLastEvent,
  quoteDocumentContentHash,
  quoteDocumentHistory,
} from "../documents/history";
import {
  markQuotePreparedForCustomer,
  quoteRevisionState,
  quoteVersionedDocumentMetadata,
} from "../documents/revisions";
import {
  blankDocumentTemplateRevisionPayload,
  documentTemplateRevisionPayload,
  runDocumentTemplateRevision,
  type DocumentTemplateRevisionPayload,
} from "../documents/template-revision";
import {
  draftTitleFromTemplate,
  normalizeQuoteLineItems,
  quoteTemplateCatalog,
  type QuoteTemplate,
} from "../documents/templates";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  generateKyroImage,
  looksLikeKyroImageGenerationRequest,
} from "../images/generation";
import { syncInboundEmail } from "../integrations/inbound-email-sync";
import { getInboundEmailOperationalSummary } from "../integrations/inbound-email-settings";
import {
  buildLlmUsageEvents,
  buildOpenAiWebSearchCallUsageEvent,
  toUsageEventRows,
  usageEventTotals,
} from "../usage/openai";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import { getUsageReport } from "../usage/queries";
import {
  conversationToAssistantLink,
  isConversationInLiveWorkQueue,
} from "./conversation-links";
import { searchAssistantHistory } from "./context-compaction";
import { getAssistantKnowledge } from "./knowledge";
import {
  looksLikeLegislationKnowledgeRequest,
  searchLegislationKnowledge,
} from "../knowledge-base/queries";
import {
  getPronunciationEntries,
  normalizePronunciationPhrase,
  upsertPronunciationEntry,
  type AssistantPronunciationEntry,
  type PronunciationCategory,
} from "./pronunciation";
import {
  looksLikeSettingsUpdatePrompt,
  updateAssistantEditableSettings,
} from "./settings-tools";
import type { AssistantToolSelection } from "./tool-planner";
import type {
  AssistantCommandResult,
  AssistantLink,
  AssistantRecentMessage,
  AssistantUiBlock,
} from "./types";
import {
  approvalQueueBlock,
  generatedImageBlock,
  outboundCallRequestBlock,
  summaryCardsBlock,
  timelineBlock,
} from "./ui-blocks";
import { runAssistantWebSearch } from "./web-search";
import {
  looksLikeOutboundCallRequest,
  resolveOutboundCallRequest,
  type OutboundCallRequestResolution,
} from "../voice/outbound-call-requests";

type WorkspaceInput = {
  id: string;
  name: string;
};

type CommandInput = {
  prompt: string;
  recentMessages?: AssistantRecentMessage[];
  supabase: SupabaseClient;
  threadId?: string | null;
  toolPlanModelPlanned?: boolean;
  toolSelection?: AssistantToolSelection | null;
  user: User;
  workspace: WorkspaceInput;
};

type RecentGeneratedImage = Extract<
  AssistantUiBlock,
  { type: "generated_image" }
>["images"][number];

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function titleCase(value: string) {
  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function assistantDate(value: string | null | undefined) {
  if (!value) {
    return "an unknown time";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function assistantMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en", {
    currency,
    maximumFractionDigits: value < 1 ? 6 : 2,
    style: "currency",
  }).format(value);
}

function quoteSearchTerm(prompt: string) {
  return normalized(prompt)
    .replace(
      /\b(find|show|open|me|the|a|an|quote|draft|document|for|from|customer|client)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function quoteSendSearchTerm(prompt: string) {
  return normalized(prompt)
    .replace(
      /\b(approval|approve|approved|send|sent|sending|email|e mail|mail|message|reply|draft|prepare|prepared|ready|review|attach|attached|attachment|pdf|quote|quotes|document|documents|invoice|invoices|this|that|the|a|an|to|for|from|customer|client|please|can|you|we|did|has|have|had|when|what|was|were|is|are|changed|since|history|version|kyro|cairo|kara|cara)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function contactSearchTerm(prompt: string) {
  return normalized(prompt)
    .replace(
      /\b(summarise|summarize|summary|show|open|customer|client|contact|profile|for|me)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function inquirySearchTerm(prompt: string) {
  return normalized(prompt)
    .replace(
      /\b(what|whats|s|happened|happening|happen|with|about|where|are|we|at|on|the|a|an|is|was|did|do|does|status|of|inquiry|enquiry|lead|job|customer|client|for|from|me|show|open|find|look|up|please)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string) {
  return normalized(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

const TEMPLATE_MATCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "create",
  "draft",
  "document",
  "documents",
  "for",
  "from",
  "generate",
  "make",
  "new",
  "quote",
  "quotes",
  "start",
  "template",
  "the",
  "to",
  "using",
  "with",
]);

function matchTokens(value: string) {
  return meaningfulTokens(value).filter(
    (token) => !TEMPLATE_MATCH_STOP_WORDS.has(token),
  );
}

function scoreTemplateMatch(prompt: string, template: QuoteTemplate) {
  const promptText = normalized(prompt);
  const labelText = normalized(template.label);
  const keyText = normalized(template.key.replace(/[-_]/g, " "));
  const descriptionText = normalized(template.description);
  const labelTokens = matchTokens(template.label);
  const keyTokens = matchTokens(template.key.replace(/[-_]/g, " "));
  const descriptionTokens = matchTokens(template.description);
  let score = 0;

  if (labelText && promptText.includes(labelText)) {
    score += 160;
  }

  if (keyText && promptText.includes(keyText)) {
    score += 120;
  }

  if (descriptionText.length > 12 && promptText.includes(descriptionText)) {
    score += 80;
  }

  const labelMatches = labelTokens.filter((token) =>
    promptText.includes(token),
  );
  const keyMatches = keyTokens.filter((token) => promptText.includes(token));
  const descriptionMatches = descriptionTokens.filter((token) =>
    promptText.includes(token),
  );

  score += labelMatches.length * 26;
  score += keyMatches.length * 18;
  score += descriptionMatches.length * 7;

  if (labelTokens.length > 1 && labelMatches.length === labelTokens.length) {
    score += 35;
  }

  return score;
}

export function selectQuoteTemplateForAssistantPrompt(
  prompt: string,
  templates: readonly QuoteTemplate[],
) {
  if (templates.length === 0) {
    return {
      candidates: [] as Array<{ score: number; template: QuoteTemplate }>,
      kind: "none" as const,
      template: null,
    };
  }

  const ranked = templates
    .map((template) => ({
      score: scoreTemplateMatch(prompt, template),
      template,
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];

  if (templates.length === 1) {
    return {
      candidates: ranked,
      kind: "selected" as const,
      template: best.template,
    };
  }

  if (best.score <= 0) {
    return {
      candidates: ranked.slice(0, 5),
      kind: "ambiguous" as const,
      template: null,
    };
  }

  const tied = ranked.filter((candidate) => candidate.score === best.score);

  if (tied.length > 1) {
    return {
      candidates: tied.slice(0, 5),
      kind: "ambiguous" as const,
      template: null,
    };
  }

  return {
    candidates: ranked.slice(0, 5),
    kind: "selected" as const,
    template: best.template,
  };
}

export function selectContactForAssistantPrompt(
  prompt: string,
  contacts: readonly ContactListItem[],
) {
  const promptText = normalized(prompt);
  const promptLower = prompt.toLowerCase();
  const promptDigits = prompt.replace(/\D/g, "");
  const ranked = contacts
    .map((contact) => {
      const name = contact.name ? normalized(contact.name) : "";
      const company = contact.company ? normalized(contact.company) : "";
      const email = contact.email?.toLowerCase().trim() ?? "";
      const phoneDigits = contact.phone?.replace(/\D/g, "") ?? "";
      let score = 0;

      if (email && promptLower.includes(email)) {
        score += 150;
      }

      if (phoneDigits.length >= 6 && promptDigits.includes(phoneDigits)) {
        score += 130;
      }

      if (name && promptText.includes(name)) {
        score += 110;
      }

      if (company && promptText.includes(company)) {
        score += 95;
      }

      return { contact, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];

  if (!best || best.score < 90) {
    return null;
  }

  const tied = ranked.filter((candidate) => candidate.score === best.score);

  return tied.length === 1 ? best.contact : null;
}

function recentContactIdFromMessages(
  recentMessages: readonly AssistantRecentMessage[] = [],
) {
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    const links = [
      ...(message.links ?? []),
      ...(message.uiBlocks ?? []).flatMap((block) => {
        if (block.type === "link_cards") {
          return block.links;
        }

        if (block.type === "summary_cards") {
          return block.cards
            .filter((card) => card.href)
            .map((card) => ({
              href: card.href as string,
              label: card.label,
              meta: card.detail ?? card.value,
            }));
        }

        return [];
      }),
    ];

    for (const link of links) {
      const match = link.href.match(/^\/contacts\/([^/?#]+)/);

      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  }

  return null;
}

function compactOutboundContextText(value: string, maxLength = 280) {
  const clean = value.replace(/\s+/g, " ").trim();

  if (!clean) {
    return null;
  }

  return clean.length > maxLength
    ? `${clean.slice(0, maxLength - 1)}...`
    : clean;
}

function outboundCallContextFromRecentMessages({
  prompt,
  recentMessages = [],
}: {
  prompt: string;
  recentMessages?: readonly AssistantRecentMessage[];
}) {
  const lines: string[] = [];

  for (const message of recentMessages.slice(-10)) {
    const content = compactOutboundContextText(message.content);

    if (content) {
      lines.push(`${message.role === "user" ? "User" : "Kyro"}: ${content}`);
    }

    for (const block of message.uiBlocks ?? []) {
      if (block.type !== "outbound_call_request") {
        continue;
      }

      const request = block.request;
      const callDetails = [
        request.contactName ? `recipient ${request.contactName}` : null,
        request.phoneNumber ? `phone ${request.phoneNumber}` : null,
        `instructions ${request.instructions}`,
      ]
        .filter((value): value is string => Boolean(value))
        .join("; ");

      lines.push(`Kyro prepared an outbound call: ${callDetails}`);
    }
  }

  const currentPrompt = compactOutboundContextText(prompt, 360);

  if (currentPrompt) {
    lines.push(`Current user request: ${currentPrompt}`);
  }

  if (lines.length === 0) {
    return null;
  }

  const summary = lines.join("\n").trim();

  return summary.length > 1800
    ? `Recent Assistant context before this outbound call request:\n${summary.slice(
        summary.length - 1800,
      )}`
    : `Recent Assistant context before this outbound call request:\n${summary}`;
}

type QuoteDraftSelection =
  | {
      candidates: Array<{
        quote: QuoteDraftListItem;
        reasons: string[];
        score: number;
      }>;
      kind: "none";
      quote: null;
      searchTerm: string;
    }
  | {
      candidates: Array<{
        quote: QuoteDraftListItem;
        reasons: string[];
        score: number;
      }>;
      kind: "ambiguous";
      quote: null;
      searchTerm: string;
    }
  | {
      candidates: Array<{
        quote: QuoteDraftListItem;
        reasons: string[];
        score: number;
      }>;
      kind: "selected";
      quote: QuoteDraftListItem;
      searchTerm: string;
    };

function customerEmailForQuote(quote: QuoteDraftListItem) {
  return quote.contact?.email ?? textValue(quote.metadata.customerEmail);
}

function quoteCustomerLabel(quote: QuoteDraftListItem) {
  return (
    quote.contact?.name ??
    quote.contact?.company ??
    textValue(quote.metadata.customerName) ??
    textValue(quote.metadata.customerCompany) ??
    "No customer yet"
  );
}

function quoteJobLabel(quote: QuoteDraftListItem) {
  return (
    quote.inquiryFacts?.jobType ??
    quote.lead?.serviceType ??
    textValue(quote.metadata.jobType) ??
    quote.lead?.title ??
    quote.title
  );
}

function quoteIsSendableStatus(quote: QuoteDraftListItem) {
  return !["approved", "sent", "archived"].includes(normalized(quote.status));
}

function quoteSendReadiness(quote: QuoteDraftListItem) {
  const blockers: string[] = [];
  const revisionState = quoteRevisionState(quote.metadata);

  if (!quote.conversation?.id) {
    blockers.push("not linked to an inquiry");
  }

  if (!customerEmailForQuote(quote)) {
    blockers.push("missing customer email");
  }

  if (!quoteIsSendableStatus(quote)) {
    blockers.push(`status is ${titleCase(quote.status)}`);
  }

  if (
    quote.status === "changes_requested" ||
    revisionState.pendingChangeRequest
  ) {
    blockers.push("customer changes need to be edited and saved first");
  }

  return {
    blockers,
    customerEmail: customerEmailForQuote(quote),
    ready: blockers.length === 0,
  };
}

function quoteSendHaystack(quote: QuoteDraftListItem) {
  return [
    quote.id,
    quote.title,
    quote.status,
    quoteCustomerLabel(quote),
    quote.contact?.email,
    quote.contact?.phone,
    quote.contact?.address,
    quote.lead?.title,
    quote.lead?.serviceType,
    quote.inquiryFacts?.jobType,
    quote.inquiryFacts?.address,
    textValue(quote.metadata.customerEmail),
    textValue(quote.metadata.customerName),
    textValue(quote.metadata.customerCompany),
    textValue(quote.metadata.jobType),
    textValue(quote.metadata.jobAddress),
  ]
    .filter(Boolean)
    .join(" ");
}

function scoreQuoteSendMatch(
  prompt: string,
  searchTerm: string,
  quote: QuoteDraftListItem,
) {
  const promptLower = prompt.toLowerCase();
  const phrase = normalized(searchTerm);
  const haystack = normalized(quoteSendHaystack(quote));
  const title = normalized(quote.title);
  const customer = normalized(quoteCustomerLabel(quote));
  const email = customerEmailForQuote(quote)?.toLowerCase();
  const tokens = meaningfulTokens(searchTerm);
  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  const reasons: string[] = [];
  let score = 0;

  if (email && promptLower.includes(email)) {
    score += 180;
    reasons.push("customer email");
  }

  if (phrase && title.includes(phrase)) {
    score += 130;
    reasons.push("quote title");
  }

  if (phrase && customer.includes(phrase)) {
    score += 120;
    reasons.push("customer");
  }

  if (phrase && haystack.includes(phrase)) {
    score += 70;
    reasons.push("quote details");
  }

  score += matchedTokens.length * 18;

  if (tokens.length > 0 && matchedTokens.length === tokens.length) {
    score += 35;
    reasons.push("all search terms");
  }

  if (quote.status === "ready") {
    score += 6;
  }

  return {
    quote,
    reasons,
    score,
  };
}

export function selectQuoteDraftForAssistantPrompt(
  prompt: string,
  quotes: readonly QuoteDraftListItem[],
  options: { includeSent?: boolean } = {},
): QuoteDraftSelection {
  const searchTerm = quoteSendSearchTerm(prompt);
  const candidates = options.includeSent
    ? [...quotes]
    : quotes.filter(quoteIsSendableStatus);

  if (!searchTerm) {
    if (candidates.length === 1) {
      return {
        candidates: [
          { quote: candidates[0], reasons: ["only unsent quote"], score: 1 },
        ],
        kind: "selected",
        quote: candidates[0],
        searchTerm,
      };
    }

    return {
      candidates: candidates.slice(0, 5).map((quote) => ({
        quote,
        reasons: [],
        score: 0,
      })),
      kind: candidates.length > 0 ? "ambiguous" : "none",
      quote: null,
      searchTerm,
    };
  }

  const ranked = candidates
    .map((quote) => scoreQuoteSendMatch(prompt, searchTerm, quote))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];

  if (!best || best.score < 30) {
    return {
      candidates: ranked.slice(0, 5),
      kind: "none",
      quote: null,
      searchTerm,
    };
  }

  const tied = ranked.filter((candidate) => candidate.score === best.score);

  if (tied.length > 1) {
    return {
      candidates: tied.slice(0, 5),
      kind: "ambiguous",
      quote: null,
      searchTerm,
    };
  }

  return {
    candidates: ranked.slice(0, 5),
    kind: "selected",
    quote: best.quote,
    searchTerm,
  };
}

export function documentTemplateControlIntent(prompt: string) {
  const text = normalized(prompt);
  const hasTemplateTarget = /\b(template|templates)\b/.test(text);

  if (!hasTemplateTarget) {
    return null;
  }

  const isSettingsOnly =
    /\b(direction|currency|validity|valid for|payment terms|footer|accent|prepared by footer)\b/.test(
      text,
    ) &&
    !/\b(create|build|generate|new|edit|revise|tweak|adjust|modify|rename|line item|line items|add|remove)\b/.test(
      text,
    );

  if (isSettingsOnly) {
    return null;
  }

  if (
    /\b(create|build|generate)\b/.test(text) ||
    /\bnew\b.*\btemplate\b/.test(text)
  ) {
    return "create" as const;
  }

  if (
    /\bmake me\b.*\btemplate\b/.test(text) ||
    /\bmake us\b.*\btemplate\b/.test(text)
  ) {
    return "create" as const;
  }

  if (
    /\b(edit|update|change|revise|tweak|adjust|modify|rename|add|remove)\b/.test(
      text,
    ) ||
    /\bmake\b.*\btemplate\b.*\b(more|less|use|with|include|without|look|feel)\b/.test(
      text,
    )
  ) {
    return "update" as const;
  }

  return null;
}

function templateLabelFromPrompt(prompt: string) {
  const named = prompt.match(/\b(?:called|named)\s+["“]?([^"”.,]+)["”]?/i)?.[1];

  if (named?.trim()) {
    return named.trim().slice(0, 120);
  }

  const beforeTemplate = prompt.match(
    /\b(?:create|build|generate|make(?:\s+me|\s+us)?)\s+(?:a|an|the)?\s*([\w\s&/-]{2,80}?)\s+template\b/i,
  )?.[1];
  const cleaned = beforeTemplate
    ?.replace(/\b(new|reusable|document|quote|customer)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned && cleaned.length >= 3) {
    return cleaned
      .split(/\s+/)
      .slice(0, 6)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ")
      .slice(0, 120);
  }

  return "Custom quote template";
}

function slugValue(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "template"
  );
}

function customTemplateFromRevision(
  revision: DocumentTemplateRevisionPayload,
  options: {
    createdAt: string;
    key: string;
    now: string;
    referenceFiles?: CustomDocumentTemplate["referenceFiles"];
  },
): CustomDocumentTemplate {
  return {
    createdAt: options.createdAt,
    description: revision.description,
    key: options.key,
    label: revision.label,
    lineItems: normalizeQuoteLineItems(revision.lineItems),
    notes: revision.notes,
    referenceFiles: options.referenceFiles ?? [],
    revisionRequest: revision.revisionRequest,
    settings: normalizeDocumentTemplateDesignSettings(revision.settings),
    updatedAt: options.now,
  };
}

function isExplicitMemoryInstruction(prompt: string) {
  return [
    /\bremember(?: that)?\s+.+/i,
    /\bfor future(?: reference)?[:,]?\s+.+/i,
    /\bnote(?: that)?\s+.+/i,
  ].some((pattern) => pattern.test(prompt));
}

function cleanPronunciationText(value: string) {
  return value
    .trim()
    .replace(/^["'“”]+|["'“”.,!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function parsePronunciationUpdate(prompt: string) {
  const patterns = [
    /\b(?:teach\s+(?:kyro|the assistant)\s+to\s+)?(?:pronounce|say)\s+(?:the\s+(?:word|phrase|name|place|business)\s+)?["“]?(.+?)["”]?\s+(?:as|like)\s+["“]?(.+?)["”]?[.!?]*$/i,
    /\b(?:pronunciation|pronounciation|pronunciation hint)\s+(?:of|for)\s+["“]?(.+?)["”]?\s+(?:to|as|like|is)\s+["“]?(.+?)["”]?[.!?]*$/i,
    /\b(?:change|set|update)\s+(?:the\s+)?(?:pronunciation|pronounciation)\s+(?:of|for)\s+["“]?(.+?)["”]?\s+(?:to|as|like)\s+["“]?(.+?)["”]?[.!?]*$/i,
    /\b(?:change|set|update)\s+["“]?(.+?)["”]?\s+(?:pronunciation|pronounciation)\s+(?:to|as|like)\s+["“]?(.+?)["”]?[.!?]*$/i,
    /\b(?:remember\s+that\s+)?["“]?(.+?)["”]?\s+(?:is|should be)\s+pronounced\s+["“]?(.+?)["”]?[.!?]*$/i,
    /\b["“](.+?)["”]\s+(?:should be pronounced|is pronounced|sounds like|should sound like)\s+["“](.+?)["”]/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const phrase = match ? cleanPronunciationText(match[1] ?? "") : "";
    const pronunciationHint = match
      ? cleanPronunciationText(match[2] ?? "")
      : "";

    if (phrase && pronunciationHint) {
      return { phrase, pronunciationHint };
    }
  }

  return null;
}

function looksLikePronunciationUpdatePrompt(prompt: string) {
  return Boolean(parsePronunciationUpdate(prompt));
}

function inferPronunciationCategory(
  prompt: string,
  phrase: string,
  existing?: AssistantPronunciationEntry,
): PronunciationCategory {
  const text = normalized(prompt);

  if (existing) {
    return existing.category;
  }

  if (/^[A-Z0-9&]{2,10}$/.test(phrase)) {
    return "acronym";
  }

  if (/\b(suburb|place|city|street|road|location)\b/.test(text)) {
    return "place";
  }

  if (/\b(person|name|staff|employee|customer|client)\b/.test(text)) {
    return "person";
  }

  if (/\b(business|company|supplier|brand)\b/.test(text)) {
    return "business";
  }

  if (/\b(product|model|part)\b/.test(text)) {
    return "product";
  }

  return "other";
}

function rowLink(label: string, href: string, meta?: string): AssistantLink {
  return { href, label, meta };
}

function recordsContext<T extends Record<string, unknown>>(items: T[]) {
  return items.slice(0, 8);
}

function joinHumanList(items: string[]) {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function looksLikeInquiryLookup(prompt: string) {
  const text = normalized(prompt);
  const searchTerm = inquirySearchTerm(prompt);

  if (!searchTerm) {
    return false;
  }

  if (
    text.includes("needs reply") ||
    text.includes("need reply") ||
    text.includes("needs a reply") ||
    text.includes("need a reply") ||
    text.includes("needs response") ||
    text.includes("need response") ||
    text.includes("needs a response") ||
    text.includes("need a response") ||
    text.includes("need responding") ||
    text.includes("needs responding") ||
    text.includes("work queue") ||
    text.includes("what should i do")
  ) {
    return false;
  }

  return (
    text.includes("inquiry") ||
    text.includes("enquiry") ||
    text.includes("lead") ||
    text.includes("job") ||
    text.includes("what happened") ||
    text.includes("where are we") ||
    text.includes("where is") ||
    text.includes("status")
  );
}

function looksLikeWorkQueueRequest(prompt: string) {
  const text = normalized(prompt);
  const hasQueueSubject =
    /\b(leads?|inquiries|enquiries|jobs?|conversations?|messages?|inbox|work queue|queue)\b/.test(
      text,
    );
  const hasAttentionIntent =
    /\b(needs?|needing|need|responding|respond|response|reply|replies|replied|unanswered|unresponded|unreplied|pending|open|waiting|attention|urgent|action|follow up|follow-up)\b/.test(
      text,
    );

  return (
    text.includes("needs reply") ||
    text.includes("need reply") ||
    text.includes("needs a reply") ||
    text.includes("need a reply") ||
    text.includes("needs response") ||
    text.includes("need response") ||
    text.includes("needs a response") ||
    text.includes("need a response") ||
    text.includes("need responding") ||
    text.includes("needs responding") ||
    text.includes("work queue") ||
    text.includes("what should i do") ||
    text.includes("what needs attention") ||
    text.includes("anything urgent") ||
    (hasQueueSubject && hasAttentionIntent)
  );
}

function looksLikeOverviewRequest(prompt: string) {
  const text = normalized(prompt);

  return (
    text.includes("overview") ||
    text.includes("dashboard") ||
    text.includes("workspace") ||
    text.includes("business summary") ||
    text.includes("crm summary") ||
    text.includes("what is going on") ||
    text.includes("whats going on") ||
    text.includes("what needs attention") ||
    text.includes("anything urgent") ||
    text.includes("how busy")
  );
}

function looksLikeEmailSyncRequest(prompt: string) {
  const text = normalized(prompt);

  return (
    (text.includes("check") ||
      text.includes("sync") ||
      text.includes("poll")) &&
    (text.includes("email") ||
      text.includes("inbox") ||
      text.includes("gmail") ||
      text.includes("outlook"))
  );
}

export function looksLikeInboundEmailAwarenessRequest(prompt: string) {
  const text = normalized(prompt);

  if (looksLikeEmailSyncRequest(prompt)) {
    return false;
  }

  if (
    text.includes("needs reply") ||
    text.includes("need reply") ||
    text.includes("work queue") ||
    /\b(leads?|jobs?)\b/.test(text)
  ) {
    return false;
  }

  if (
    text.includes("skipped email") ||
    text.includes("skipped mail") ||
    text.includes("filtered out") ||
    text.includes("filtered email")
  ) {
    return true;
  }

  const hasEmailSubject =
    /\b(email|emails|mail|gmail|outlook|emailed|inbound)\b/.test(text);
  const hasAwarenessIntent =
    /\b(anyone|anybody|customer|client|reply|replied|sent|came|come|overnight|today|morning|latest|new|recent|seen|ignored|skipped|filtered|attachment|attachments)\b/.test(
      text,
    );

  return hasEmailSubject && hasAwarenessIntent;
}

function looksLikeAssistantHistorySearchRequest(prompt: string) {
  const text = normalized(prompt);

  return (
    /\b(earlier|previously|before|yesterday|last week|last month|remember|talked|discussed|chat history|conversation history)\b/.test(
      text,
    ) &&
    /\b(what|where|when|did|have|find|search|show|pull|look|talked|discussed)\b/.test(
      text,
    )
  );
}

export function looksLikeQuoteSendRequest(prompt: string) {
  const text = normalized(prompt);
  const hasQuoteTarget =
    /\b(quote|quotes|document|documents|invoice|invoices|pdf)\b/.test(text);

  if (!hasQuoteTarget) {
    return false;
  }

  if (
    /\b(has|have|had|did|when|what|was|were|is|are)\b.*\b(sent|send|prepared|generated|changed|version|history)\b/.test(
      text,
    ) ||
    /\b(changed since|when did|has this|have we|did we)\b/.test(text)
  ) {
    return false;
  }

  return (
    /\b(send|sending|email|mail|forward|deliver)\b/.test(text) ||
    /\b(prepare|draft|write|create)\b.*\b(email|reply|message)\b/.test(text) ||
    /\b(attach|attachment|attached)\b.*\b(email|reply|message|quote|document|pdf)\b/.test(
      text,
    )
  );
}

export function looksLikeQuoteSendReadyListRequest(prompt: string) {
  const text = normalized(prompt);
  const hasQuoteTarget =
    /\b(quote|quotes|document|documents|invoice|invoices)\b/.test(text);

  if (!hasQuoteTarget) {
    return false;
  }

  return (
    /\bready\b.*\b(send|sending|email|customer|customers)\b/.test(text) ||
    /\b(send|email)\b.*\bready\b/.test(text) ||
    /\bwhat\b.*\bquotes?\b.*\bready\b/.test(text)
  );
}

export function looksLikeQuoteHistoryRequest(prompt: string) {
  const text = normalized(prompt);
  const hasQuoteTarget =
    /\b(quote|quotes|document|documents|invoice|invoices|pdf)\b/.test(text);

  if (!hasQuoteTarget) {
    return false;
  }

  return (
    /\b(has|have|had|did|when|what|was|were|is|are)\b.*\b(sent|prepared|generated|changed|approved|approval|viewed|version|history)\b/.test(
      text,
    ) ||
    /\b(changed since|version history|document trail|pdf history|send history|customer approval|quote approval|request(?:ed)? changes|change request)\b/.test(
      text,
    )
  );
}

function looksLikeHelpRequest(prompt: string) {
  const text = normalized(prompt);
  const directHelpIntent =
    text.includes("help") ||
    text.includes("manual") ||
    text.includes("guide") ||
    text.includes("docs") ||
    text.includes("documentation") ||
    text.includes("support article") ||
    text.includes("what can you do") ||
    text.includes("what can kyro do") ||
    text.includes("what are you able to do") ||
    text.includes("how do i use kyro") ||
    text.includes("how to use kyro");
  const definitionTopic =
    text.includes("kyro") ||
    text.includes("setting") ||
    text.includes("settings") ||
    text.includes("quiet hours") ||
    text.includes("lookback") ||
    text.includes("fetch cap") ||
    text.includes("poll frequency") ||
    text.includes("filtered out") ||
    text.includes("filtered email") ||
    text.includes("skipped email") ||
    text.includes("skipped mail") ||
    text.includes("timezone") ||
    text.includes("time zone") ||
    text.includes("pronunciation") ||
    text.includes("pronounciation") ||
    text.includes("aliases") ||
    text.includes("usage") ||
    text.includes("billing") ||
    text.includes("web search") ||
    text.includes("inbox") ||
    text.includes("crm");
  const explainerIntent =
    /\b(what does|what do|explain|how does|how do|why does|where do i|where is)\b/.test(
      text,
    ) ||
    /\b(mean|means|meaning)\b/.test(text) ||
    (/\b(what is|whats|what are)\b/.test(text) && definitionTopic);
  const kyroTopic =
    text.includes("kyro") ||
    text.includes("assistant") ||
    text.includes("voice") ||
    text.includes("realtime") ||
    text.includes("microphone") ||
    text.includes("setting") ||
    text.includes("settings") ||
    text.includes("general") ||
    text.includes("communication") ||
    text.includes("integrations") ||
    text.includes("quiet hours") ||
    text.includes("lookback") ||
    text.includes("fetch cap") ||
    text.includes("poll") ||
    text.includes("polling") ||
    text.includes("email sync") ||
    text.includes("inbound sync") ||
    text.includes("inbound email") ||
    text.includes("filtered out") ||
    text.includes("filtered email") ||
    text.includes("skipped email") ||
    text.includes("skipped mail") ||
    text.includes("gmail") ||
    text.includes("outlook") ||
    text.includes("pronunciation") ||
    text.includes("pronounciation") ||
    text.includes("vocabulary") ||
    text.includes("alias") ||
    text.includes("aliases") ||
    text.includes("usage") ||
    text.includes("cost") ||
    text.includes("billing") ||
    text.includes("crm") ||
    text.includes("documents") ||
    text.includes("quote draft") ||
    text.includes("work queue") ||
    text.includes("inbox") ||
    text.includes("log") ||
    text.includes("web search") ||
    text.includes("memory") ||
    text.includes("memories") ||
    text.includes("reconnect") ||
    text.includes("timezone") ||
    text.includes("time zone");

  return directHelpIntent || (explainerIntent && kyroTopic);
}

function looksLikeUsageSummaryRequest(prompt: string) {
  const text = normalized(prompt);

  return (
    /\b(usage|cost|spend|billing|api bill|tokens?|metered)\b/.test(text) &&
    /\b(summary|report|how much|costing|spending|this month|last 30|today|week|show|where)\b/.test(
      text,
    )
  );
}

export function looksLikeWebSearchRequest(prompt: string) {
  const text = normalized(prompt);

  const explicitSearch =
    /\b(search|google|look up|lookup|check|find)\b/.test(text) &&
    /\b(web|internet|online|public|news|latest|current|today|recent|website|site)\b/.test(
      text,
    );
  const currentPublic =
    /\b(latest|current|today|recent|news|price|pricing|regulation|rules|standard|law|weather|exchange rate|stock price)\b/.test(
      text,
    ) &&
    !/\b(kyro|workspace|inbox|crm|contact|lead|quote|document|file|setting|usage|billing|email sync|outbox)\b/.test(
      text,
    );

  return explicitSearch || currentPublic;
}

function latestGeneratedImageFromRecentMessages(
  recentMessages: readonly AssistantRecentMessage[] = [],
): RecentGeneratedImage | null {
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    const image = latestGeneratedImageFromBlocks(message?.uiBlocks);

    if (image) {
      return image;
    }
  }

  return null;
}

function generatedImageFromValue(value: unknown): RecentGeneratedImage | null {
  const image = objectRecord(value);
  const fileId = textValue(image.fileId);

  if (!fileId) {
    return null;
  }

  return {
    alt: textValue(image.alt) ?? "Generated image",
    contentType: textValue(image.contentType) ?? "image/png",
    downloadHref: textValue(image.downloadHref) ?? `/api/files/${fileId}`,
    editMode: Boolean(image.editMode),
    fileId,
    filename: textValue(image.filename) ?? "generated-image.png",
    href: textValue(image.href) ?? `/api/files/${fileId}?disposition=inline`,
    meta: textValue(image.meta) ?? undefined,
    model: textValue(image.model) ?? "unknown",
    prompt: textValue(image.prompt) ?? "",
    provider: textValue(image.provider) ?? "openai",
    quality: textValue(image.quality) ?? "unknown",
    referenceCount: Number.isFinite(Number(image.referenceCount))
      ? Number(image.referenceCount)
      : 0,
    size: textValue(image.size) ?? "auto",
  };
}

function latestGeneratedImageFromBlocks(blocksValue: unknown) {
  const blocks = Array.isArray(blocksValue) ? blocksValue : [];

  for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
    const block = objectRecord(blocks[blockIndex]);

    if (block.type !== "generated_image") {
      continue;
    }

    const images = Array.isArray(block.images) ? block.images : [];

    for (let imageIndex = images.length - 1; imageIndex >= 0; imageIndex -= 1) {
      const image = generatedImageFromValue(images[imageIndex]);

      if (image) {
        return image;
      }
    }
  }

  return null;
}

async function latestGeneratedImageFromThread({
  supabase,
  threadId,
  workspaceId,
}: {
  supabase: SupabaseClient;
  threadId?: string | null;
  workspaceId: string;
}) {
  if (!threadId) {
    return null;
  }

  const { data, error } = await supabase
    .from("assistant_messages")
    .select("ui_blocks")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    return null;
  }

  for (const row of data ?? []) {
    const image = latestGeneratedImageFromBlocks(objectRecord(row).ui_blocks);

    if (image) {
      return image;
    }
  }

  return null;
}

function looksLikeImageEditFollowUpText(prompt: string) {
  const text = normalized(prompt);
  const explicitEdit =
    /\b(edit|change|update|adjust|modify|redo|regenerate|rework|revise)\b.*\b(image|picture|photo|render|rendering|version|it|that|this|one)\b/.test(
      text,
    ) ||
    /\b(image|picture|photo|render|rendering|version)\b.*\b(edit|change|update|adjust|modify|redo|regenerate|rework|revise)\b/.test(
      text,
    );
  const action =
    /\b(make|turn|change|edit|redo|regenerate|rework|update|adjust|modify|revise|create|generate|render|produce)\b/.test(
      text,
    );
  const target =
    /\b(it|that|this|image|picture|photo|render|rendering|version|one|previous|same)\b/.test(
      text,
    );
  const visualChange =
    /\b(night|nighttime|evening|day|daytime|morning|darker|brighter|lighting|light|colour|color|style|view|background|realistic|luxury|modern|warmer|cooler|different|another|variation|variant|more|less|black|white|blue|green|red|replace|remove|add|with|without)\b/.test(
      text,
    );

  return explicitEdit || (action && target && visualChange);
}

function previousImagePromptSummary(prompt: string) {
  return prompt
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/\b(?:kyro\s+file\s+id|file\s+id|source\s+file)\s*:/i.test(line),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function looksLikeImageFollowUpRequest(
  prompt: string,
  recentMessages: readonly AssistantRecentMessage[] = [],
) {
  return Boolean(latestGeneratedImageFromRecentMessages(recentMessages)) &&
    looksLikeImageEditFollowUpText(prompt);
}

function looksLikeDirectImageGenerationCommand(prompt: string) {
  if (!looksLikeKyroImageGenerationRequest(prompt)) {
    return false;
  }

  const text = normalized(prompt);
  const directCreation =
    /\b(create|generate|make|render|draw|produce|design|visualise|visualize|mock up)\b/.test(
      text,
    ) &&
    /\b(image|picture|photo|render|rendering|visual|mockup|concept|graphic|flyer|poster)\b/.test(
      text,
    );
  const discussion =
    /\b(do you think|what do you think|will|would|should|could|why|how|explain|tell me about|matter|important|useful)\b/.test(
      text,
    );

  return directCreation || !discussion;
}

function imageFollowUpPromptFromRecentMessages(
  prompt: string,
  recentMessages: readonly AssistantRecentMessage[] = [],
) {
  return imageFollowUpPromptForImage(
    prompt,
    latestGeneratedImageFromRecentMessages(recentMessages),
  );
}

async function imageFollowUpPromptFromThread({
  prompt,
  supabase,
  threadId,
  workspaceId,
}: {
  prompt: string;
  supabase: SupabaseClient;
  threadId?: string | null;
  workspaceId: string;
}) {
  if (!looksLikeImageEditFollowUpText(prompt)) {
    return null;
  }

  return imageFollowUpPromptForImage(
    prompt,
    await latestGeneratedImageFromThread({
      supabase,
      threadId,
      workspaceId,
    }),
  );
}

function imageFollowUpPromptForImage(
  prompt: string,
  image: RecentGeneratedImage | null,
) {
  if (!image || !looksLikeImageEditFollowUpText(prompt)) {
    return null;
  }

  const previousPrompt = image.prompt
    ? previousImagePromptSummary(image.prompt)
    : null;

  return [
    `Edit the previously generated image using this follow-up request: ${prompt.trim()}`,
    `Source file: ${image.fileId}`,
    previousPrompt ? `Previous image prompt: ${previousPrompt}` : null,
    "Preserve the same core subject and composition unless the follow-up explicitly asks to change them.",
    "Generate and save the edited image; do not only describe the edit.",
  ]
    .filter(Boolean)
    .join("\n");
}

function looksLikeGeneratedImageRecallText(prompt: string) {
  const text = normalized(prompt);

  return (
    /\b(where|show|open|find|download|send|see|view)\b/.test(text) &&
    /\b(it|that|this|image|picture|photo|render|rendering|file|download)\b/.test(
      text,
    )
  );
}

function looksLikeGeneratedImageRecallRequest(
  prompt: string,
  recentMessages: readonly AssistantRecentMessage[] = [],
) {
  return Boolean(latestGeneratedImageFromRecentMessages(recentMessages)) &&
    looksLikeGeneratedImageRecallText(prompt);
}

function generatedImageRecallResult({
  image,
  prompt,
}: {
  image: RecentGeneratedImage | null;
  prompt: string;
}): AssistantCommandResult {
  if (!image) {
    return {
      context: {
        prompt,
      },
      fallbackAnswer: generalChatFallback(prompt),
      intent: "general_chat",
      links: [],
      title: "Chat",
    };
  }

  const label = image.editMode
    ? "Generated image with references"
    : "Generated image";
  const meta = [image.provider, image.model, image.size, image.quality]
    .filter(Boolean)
    .join(" - ");

  return {
    context: {
      generatedImage: {
        editMode: image.editMode,
        fileId: image.fileId,
        filename: image.filename,
        model: image.model,
        provider: image.provider,
        quality: image.quality,
        referenceCount: image.referenceCount,
        size: image.size,
      },
    },
    fallbackAnswer: "Here is the latest generated image from this thread.",
    intent: "image_generation_recall",
    links: [
      rowLink(label, image.href, meta),
      rowLink("Download image", image.downloadHref, image.filename),
    ],
    title: "Generated image",
    uiBlocks: generatedImageBlock("Generated image", [image]),
  };
}

async function generatedImageRecallCommand({
  prompt,
  recentMessages = [],
  supabase,
  threadId,
  workspace,
}: Pick<
  CommandInput,
  "prompt" | "recentMessages" | "supabase" | "threadId" | "workspace"
>): Promise<AssistantCommandResult> {
  return generatedImageRecallResult({
    image:
      latestGeneratedImageFromRecentMessages(recentMessages) ??
      (await latestGeneratedImageFromThread({
        supabase,
        threadId,
        workspaceId: workspace.id,
      })),
    prompt,
  });
}

async function resolvePlannedAssistantCommand({
  prompt,
  recentMessages = [],
  supabase,
  threadId = null,
  toolSelection,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult | null> {
  if (!toolSelection) {
    return null;
  }

  const plannedPrompt = toolSelection.prompt.trim() || prompt;

  switch (toolSelection.name) {
    case "general_chat":
      if (looksLikeWorkQueueRequest(prompt)) {
        return workQueueCommand({ supabase, workspace });
      }

      return generalChatCommand({ prompt });
    case "work_queue":
      return workQueueCommand({ supabase, workspace });
    case "inquiry_lookup":
      return inquiryLookupCommand({
        prompt: plannedPrompt,
        supabase,
        workspace,
      });
    case "contact_lookup":
      return contactCommand({ prompt: plannedPrompt, supabase, workspace });
    case "quote_lookup":
      return quoteCommand({ prompt: plannedPrompt, supabase, workspace });
    case "quote_create":
      return createQuoteDraftCommand({
        prompt: plannedPrompt,
        recentMessages,
        supabase,
        toolSelection,
        user,
        workspace,
      });
    case "quote_send":
      return quoteSendCommand({
        prompt: plannedPrompt,
        recentMessages,
        supabase,
        toolSelection,
        user,
        workspace,
      });
    case "quote_send_ready_list":
      return quoteSendReadyListCommand({ supabase, workspace });
    case "quote_history":
      return quoteHistoryCommand({
        prompt: plannedPrompt,
        supabase,
        workspace,
      });
    case "image_recall":
      return generatedImageRecallCommand({
        prompt,
        recentMessages,
        supabase,
        threadId,
        workspace,
      });
    case "image_generation": {
      const imagePrompt =
        toolSelection.mode === "edit_previous_image"
          ? (imageFollowUpPromptFromRecentMessages(
              plannedPrompt,
              recentMessages,
            ) ??
              (await imageFollowUpPromptFromThread({
                prompt: plannedPrompt,
                supabase,
                threadId,
                workspaceId: workspace.id,
              })))
          : null;

      return imageGenerationCommand({
        prompt: imagePrompt ?? plannedPrompt,
        recentMessages,
        supabase,
        toolSelection,
        user,
        workspace,
      });
    }
    case "document_template_create":
      return documentTemplateControlCommand({
        intent: "create",
        prompt: plannedPrompt,
        recentMessages,
        supabase,
        toolSelection,
        user,
        workspace,
      });
    case "document_template_update":
      return documentTemplateControlCommand({
        intent: "update",
        prompt: plannedPrompt,
        recentMessages,
        supabase,
        toolSelection,
        user,
        workspace,
      });
    case "usage_summary":
      return usageSummaryCommand({ supabase, workspace });
    case "web_search":
      return webSearchCommand({
        prompt: plannedPrompt,
        recentMessages,
        supabase,
        toolSelection,
        user,
        workspace,
      });
    case "outbound_call":
      return outboundCallCommand({
        prompt: plannedPrompt,
        recentMessages,
        supabase,
        threadId,
        user,
        workspace,
      });
    case "legislation_lookup":
      return legislationKnowledgeCommand({
        prompt: plannedPrompt,
        workspace,
      });
    case "app_help":
      return helpCommand({ prompt: plannedPrompt });
    case "email_sync":
      return emailSyncCommand({ supabase, user, workspace });
    case "inbound_email_awareness":
      return inboundEmailAwarenessCommand({
        prompt: plannedPrompt,
        supabase,
        workspace,
      });
    case "history_search":
      return assistantHistorySearchCommand({
        prompt: plannedPrompt,
        supabase,
        threadId,
        user,
        workspace,
      });
    case "settings_update":
      return updateAssistantEditableSettings({
        prompt: plannedPrompt,
        supabase,
        user,
        workspace,
      });
    case "memory_save":
      return memoryCommand({ prompt: plannedPrompt });
    case "pronunciation_update":
      return pronunciationUpdateCommand({
        prompt: plannedPrompt,
        recentMessages,
        supabase,
        toolSelection,
        user,
        workspace,
      });
    case "overview":
      return overviewCommand({ supabase, workspace });
    default:
      return null;
  }
}

export async function resolveAssistantCommand({
  prompt,
  recentMessages = [],
  supabase,
  threadId = null,
  toolPlanModelPlanned = false,
  toolSelection = null,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const text = normalized(prompt);
  const plannedCommand = await resolvePlannedAssistantCommand({
    prompt,
    recentMessages,
    supabase,
    threadId,
    toolSelection,
    user,
    workspace,
  });

  if (plannedCommand) {
    return plannedCommand;
  }

  if (looksLikeWorkQueueRequest(prompt)) {
    return workQueueCommand({ supabase, workspace });
  }

  if (looksLikeOutboundCallRequest(prompt)) {
    return outboundCallCommand({
      prompt,
      recentMessages,
      supabase,
      threadId,
      user,
      workspace,
    });
  }

  const imageFollowUpPrompt =
    imageFollowUpPromptFromRecentMessages(prompt, recentMessages) ??
    (await imageFollowUpPromptFromThread({
      prompt,
      supabase,
      threadId,
      workspaceId: workspace.id,
    }));

  if (imageFollowUpPrompt) {
    return imageGenerationCommand({
      prompt: imageFollowUpPrompt,
      recentMessages,
      supabase,
      user,
      workspace,
    });
  }

  if (
    toolPlanModelPlanned
      ? looksLikeDirectImageGenerationCommand(prompt)
      : looksLikeKyroImageGenerationRequest(prompt)
  ) {
    return imageGenerationCommand({
      prompt,
      recentMessages,
      supabase,
      user,
      workspace,
    });
  }

  if (
    looksLikeGeneratedImageRecallRequest(prompt, recentMessages) ||
    looksLikeGeneratedImageRecallText(prompt)
  ) {
    return generatedImageRecallCommand({
      prompt,
      recentMessages,
      supabase,
      threadId,
      workspace,
    });
  }

  if (looksLikeLegislationKnowledgeRequest(prompt)) {
    return legislationKnowledgeCommand({ prompt, workspace });
  }

  if (looksLikeWebSearchRequest(prompt)) {
    return webSearchCommand({ prompt, supabase, user, workspace });
  }

  if (toolPlanModelPlanned) {
    return generalChatCommand({ prompt });
  }

  if (looksLikePronunciationUpdatePrompt(prompt)) {
    return pronunciationUpdateCommand({ prompt, supabase, user, workspace });
  }

  if (isExplicitMemoryInstruction(prompt)) {
    return memoryCommand({ prompt });
  }

  const templateIntent = documentTemplateControlIntent(prompt);

  if (templateIntent) {
    return documentTemplateControlCommand({
      intent: templateIntent,
      prompt,
      supabase,
      user,
      workspace,
    });
  }

  if (looksLikeSettingsUpdatePrompt(prompt)) {
    return updateAssistantEditableSettings({
      prompt,
      supabase,
      user,
      workspace,
    });
  }

  if (looksLikeUsageSummaryRequest(prompt)) {
    return usageSummaryCommand({ supabase, workspace });
  }

  if (looksLikeHelpRequest(prompt)) {
    return helpCommand({ prompt });
  }

  if (looksLikeEmailSyncRequest(prompt)) {
    return emailSyncCommand({ supabase, user, workspace });
  }

  if (looksLikeInboundEmailAwarenessRequest(prompt)) {
    return inboundEmailAwarenessCommand({ prompt, supabase, workspace });
  }

  if (looksLikeAssistantHistorySearchRequest(prompt)) {
    return assistantHistorySearchCommand({
      prompt,
      supabase,
      threadId,
      user,
      workspace,
    });
  }

  if (looksLikeQuoteHistoryRequest(prompt)) {
    return quoteHistoryCommand({ prompt, supabase, workspace });
  }

  if (looksLikeQuoteSendReadyListRequest(prompt)) {
    return quoteSendReadyListCommand({ supabase, workspace });
  }

  if (looksLikeQuoteSendRequest(prompt)) {
    return quoteSendCommand({ prompt, supabase, user, workspace });
  }

  if (
    /\b(create|make|start|generate)\b/.test(text) &&
    /\b(quote|document|invoice)\b/.test(text)
  ) {
    return createQuoteDraftCommand({ prompt, supabase, user, workspace });
  }

  if (text.includes("quote") || text.includes("document")) {
    return quoteCommand({ prompt, supabase, workspace });
  }

  if (looksLikeInquiryLookup(prompt)) {
    return inquiryLookupCommand({ prompt, supabase, workspace });
  }

  if (
    text.includes("customer") ||
    text.includes("client") ||
    text.includes("contact") ||
    text.includes("summarise") ||
    text.includes("summarize")
  ) {
    return contactCommand({ prompt, supabase, workspace });
  }

  if (looksLikeOverviewRequest(prompt)) {
    return overviewCommand({ supabase, workspace });
  }

  return generalChatCommand({ prompt });
}

async function outboundCallCommand({
  prompt,
  recentMessages = [],
  supabase,
  threadId = null,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const resolution = await resolveOutboundCallRequest({
    contactId: recentContactIdFromMessages(recentMessages),
    contextSummary: outboundCallContextFromRecentMessages({
      prompt,
      recentMessages,
    }),
    prompt,
    supabase,
    workspaceId: workspace.id,
  });

  if (resolution.status === "ambiguous") {
    const links = resolution.matches.map((contact) => ({
      href: `/contacts/${contact.id}`,
      label: contact.name ?? contact.company ?? contact.phone ?? "Contact",
      meta: contact.email ?? contact.phone ?? undefined,
    }));

    return {
      context: { outboundCall: resolution },
      fallbackAnswer:
        "I found a few possible contacts for that call. Pick the right one, then tell me what you want Kyro to say.",
      intent: "outbound_call_prepare",
      links,
      title: "Outbound phone call",
      uiBlocks: [
        {
          links,
          title: "Possible call recipients",
          type: "link_cards",
        },
      ],
    };
  }

  if (resolution.status === "missing_phone") {
    const links = resolution.contactId
      ? [
          {
            href: `/contacts/${resolution.contactId}`,
            label: resolution.contactName ?? "Contact",
            meta: "No phone number",
          },
        ]
      : [];

    return {
      context: { outboundCall: resolution },
      fallbackAnswer:
        "I found the contact, but there is no phone number saved yet. Add a phone number first, then I can prepare the call.",
      intent: "outbound_call_prepare",
      links,
      title: "Outbound phone call",
      uiBlocks: links.length
        ? [
            {
              links,
              title: "Contact needs a phone number",
              type: "link_cards",
            },
          ]
        : [],
    };
  }

  if (resolution.status === "missing_instructions") {
    return {
      context: { outboundCall: resolution },
      fallbackAnswer:
        "I have the phone number, but I need to know what you want Kyro to say on the call.",
      intent: "outbound_call_prepare",
      links: resolution.contactId
        ? [
            {
              href: `/contacts/${resolution.contactId}`,
              label: resolution.contactName ?? resolution.phoneNumber ?? "Contact",
              meta: resolution.phoneNumber ?? undefined,
            },
          ]
        : [],
      title: "Outbound phone call",
      uiBlocks: [],
    };
  }

  if (resolution.status === "not_found") {
    return {
      context: { outboundCall: resolution },
      fallbackAnswer:
        "I couldn't find a matching contact or phone number for that call. Give me the contact name or phone number and what you want Kyro to say.",
      intent: "outbound_call_prepare",
      links: [],
      title: "Outbound phone call",
      uiBlocks: [],
    };
  }

  const readyResolution = resolution as Extract<
    OutboundCallRequestResolution,
    { status: "ready" }
  >;
  const recipient =
    readyResolution.contactName ??
    readyResolution.phoneNumber ??
    "selected contact";
  return {
    context: { outboundCall: readyResolution },
    fallbackAnswer: `I found ${recipient} and prepared the outbound call. Review the message, then press Confirm when you want Kyro to call.`,
    intent: "outbound_call_prepare",
    links: [],
    title: "Outbound phone call",
    uiBlocks: [
      ...outboundCallRequestBlock("Outbound phone call", {
        contactId: readyResolution.contactId,
        contactName: readyResolution.contactName,
        contextSummary: readyResolution.contextSummary,
        conversationId: readyResolution.conversationId,
        instructions: readyResolution.instructions,
        leadId: readyResolution.leadId,
        phoneNumber: readyResolution.phoneNumber,
        threadId,
      }),
    ],
  };
}

async function webSearchCommand({
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const search = await runAssistantWebSearch({
    maxOutputTokens: 680,
    prompt,
  });
  const sourceLinks = search.sources;

  if (search.tokenUsage || search.webSearchUsed) {
    const startedAt = Date.now();
    const { data: aiRun, error: aiRunError } = await supabase
      .from("ai_runs")
      .insert({
        actual_cost: "0",
        estimated_cost: "0",
        input_refs: {
          prompt,
          source: "assistant.web_search",
        },
        mode: "tool",
        model: search.model,
        output: {},
        provider: "openai",
        risk_level: "low",
        status: "running",
        task_type: "web_search",
        tool_calls: [
          {
            input: {
              prompt,
            },
            name: "web_search",
            result: {},
            status: "proposed",
          },
        ],
        usage: {},
        user_id: user.id,
        workspace_id: workspace.id,
      })
      .select("id")
      .single();

    if (aiRunError || !aiRun) {
      throw new Error(
        `Unable to create web search AI run: ${
          aiRunError?.message ?? "unknown error"
        }`,
      );
    }

    const aiRunId = String(aiRun.id);
    const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
      supabase,
      workspace.id,
      "OPENAI_LLM_MARKUP_RATE",
    );
    const usageEvents = [
      ...(search.tokenUsage
        ? buildLlmUsageEvents({
            context: {
              aiRunId,
              metadata: {
                source: "assistant.web_search",
                sourceCount: sourceLinks.length,
                webSearchUsed: search.webSearchUsed,
              },
              providerUsageId: search.providerUsageId,
              sourceId: aiRunId,
              sourceType: "ai_run",
              usageMarkupRate,
              userId: user.id,
              workspaceId: workspace.id,
            },
            model: search.model,
            provider: "openai",
            service: "llm",
            usage: search.tokenUsage,
          })
        : []),
      ...(search.webSearchUsed
        ? [
            buildOpenAiWebSearchCallUsageEvent({
              context: {
                aiRunId,
                metadata: {
                  source: "assistant.web_search",
                  sourceCount: sourceLinks.length,
                },
                providerUsageId: search.providerUsageId,
                sourceId: aiRunId,
                sourceType: "ai_run",
                usageMarkupRate,
                userId: user.id,
                workspaceId: workspace.id,
              },
              model: search.model,
            }),
          ]
        : []),
    ];
    const usageTotals = usageEventTotals(usageEvents);

    if (usageEvents.length > 0) {
      const { error: usageError } = await supabase
        .from("usage_events")
        .insert(toUsageEventRows(usageEvents));

      if (usageError) {
        throw new Error(`Unable to record web search usage: ${usageError.message}`);
      }
    }

    const output = {
      answer: search.text,
      fallbackReason: search.fallbackReason ?? null,
      sources: sourceLinks,
      webSearchUsed: search.webSearchUsed,
    };
    const { error: completeError } = await supabase
      .from("ai_runs")
      .update({
        actual_cost: String(usageTotals.costSnapshot),
        completed_at: new Date().toISOString(),
        estimated_cost: String(usageTotals.costSnapshot),
        latency_ms: Date.now() - startedAt,
        output,
        status: search.fallbackReason ? "failed" : "completed",
        tool_calls: [
          {
            input: {
              prompt,
            },
            name: "web_search",
            result: output,
            status: search.fallbackReason ? "blocked" : "completed",
          },
        ],
        usage: {
          customerCharge: usageTotals.customerChargeSnapshot,
          inputTokens: search.inputTokens,
          outputTokens: search.outputTokens,
          providerCost: usageTotals.costSnapshot,
          sourceCount: sourceLinks.length,
          webSearchUsed: search.webSearchUsed,
        },
      })
      .eq("id", aiRunId);

    if (completeError) {
      throw new Error(`Unable to complete web search AI run: ${completeError.message}`);
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: search.fallbackReason
        ? "assistant_web_search.failed"
        : "assistant_web_search.completed",
      actorId: aiRunId,
      actorType: "ai",
      after: output,
      entityId: aiRunId,
      entityType: "ai_run",
      metadata: {
        requestedByUserId: user.id,
        source: "assistant.web_search",
      },
    });
  }

  return {
    context: {
      answer: search.text,
      fallbackReason: search.fallbackReason ?? null,
      query: prompt,
      sources: recordsContext(
        sourceLinks.map((source) => ({
          href: source.href,
          label: source.label,
          meta: source.meta ?? null,
        })),
      ),
      webSearchUsed: search.webSearchUsed,
    },
    fallbackAnswer: search.text,
    intent: "web_search",
    links: sourceLinks,
    title: "Web search",
  };
}

async function helpCommand({
  prompt,
}: Pick<CommandInput, "prompt">): Promise<AssistantCommandResult> {
  const knowledge = await getAssistantKnowledge(prompt);

  return {
    context: {
      guidance:
        "Answer from these Kyro help/manual snippets. Use user-facing manual snippets first; use internal architecture snippets only to clarify product state or implementation when useful.",
      snippets: knowledge.snippets,
    },
    fallbackAnswer:
      knowledge.snippets.length > 0
        ? `I found Kyro help notes about ${knowledge.snippets[0].heading}.`
        : "I can help explain Kyro settings, connected accounts, voice, pronunciation, usage, and workflow behaviour.",
    intent: "app_help",
    links: knowledge.links,
    title: "Kyro help",
  };
}

async function legislationKnowledgeCommand({
  prompt,
  workspace,
}: Pick<CommandInput, "prompt" | "workspace">): Promise<AssistantCommandResult> {
  const result = await searchLegislationKnowledge({
    prompt,
    workspaceId: workspace.id,
  });
  const links = result.collectionMatches
    .slice(0, 8)
    .map((match) =>
      rowLink(
        match.title,
        match.officialUrl,
        `${match.jurisdictionRegion} - ${match.regulator}`,
      ),
    );

  return {
    context: {
      collectionTargets: recordsContext(
        result.collectionMatches.map((match) => ({
          documentsToCollect: match.documentsToCollect,
          industries: match.industries,
          jurisdictionRegion: match.jurisdictionRegion,
          licensingMode: match.licensingMode,
          notes: match.notes,
          officialUrl: match.officialUrl,
          regulator: match.regulator,
          sourceType: match.sourceType,
          title: match.title,
        })),
      ),
      guidance: result.hasStructuredContent
        ? "Answer only from these legislation/guidance snippets and source links. If the snippets are incomplete or only mention standards references, say so plainly."
        : "No ingested legislation text was found for this question yet. Use the matched official collection targets to explain which sources should be ingested next, and do not invent legal rules.",
      query: prompt,
      snippets: result.snippets,
    },
    fallbackAnswer: result.hasStructuredContent
      ? `I found legislation and regulator guidance snippets that look relevant to that question.`
      : result.collectionMatches.length > 0
        ? `I found the official Australian sources we'd use for that topic, but the full legislation text has not been ingested into Kyro yet.`
        : "I do not have legislation material ingested for that topic yet.",
    intent: "legislation_lookup",
    links,
    title: "Legislation knowledge",
    uiBlocks: [
      ...timelineBlock(
        "Official sources",
        result.collectionMatches.slice(0, 6).map((match) => ({
          detail: `${match.regulator} - ${match.licensingMode.replaceAll("_", " ")}`,
          href: match.officialUrl,
          label: `${match.jurisdictionRegion}: ${match.title}`,
          tone: match.licensingMode === "metadata_only" ? "warning" : ("cyan" as const),
        })),
      ),
    ],
  };
}

async function pronunciationUpdateCommand({
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const parsed = parsePronunciationUpdate(prompt);

  if (!parsed) {
    return {
      context: {
        expectedFormat:
          'Try "pronounce Woolloongabba as wuh-lun-gabba" or "set Woolloongabba pronunciation to wuh-lun-gabba".',
      },
      fallbackAnswer:
        "I can update pronunciation entries, but I could not confidently read the word and pronunciation hint from that request.",
      intent: "pronunciation_update",
      links: [
        {
          href: "/settings?section=voice",
          label: "Voice settings",
          meta: "Pronunciation list",
        },
      ],
      title: "Pronunciation update",
    };
  }

  const existingEntries = await getPronunciationEntries(supabase, workspace.id);
  const existingEntry = existingEntries.find(
    (entry) =>
      normalizePronunciationPhrase(entry.phrase) ===
      normalizePronunciationPhrase(parsed.phrase),
  );
  const entry = await upsertPronunciationEntry({
    aliases: existingEntry?.aliases ?? [],
    category: inferPronunciationCategory(prompt, parsed.phrase, existingEntry),
    phrase: existingEntry?.phrase ?? parsed.phrase,
    pronunciationHint: parsed.pronunciationHint,
    source: "assistant",
    status: "approved",
    supabase,
    user,
    workspaceId: workspace.id,
  });

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "assistant_pronunciation.updated",
    actorId: user.id,
    actorType: "ai",
    after: { entry },
    before: existingEntry ? { entry: existingEntry } : null,
    entityId: entry.id,
    entityType: "assistant_pronunciation",
    metadata: {
      assistantPrompt: prompt,
      requestedByUserId: user.id,
    },
  });

  return {
    context: {
      phrase: entry.phrase,
      pronunciationHint: entry.pronunciationHint,
      source: entry.source,
    },
    fallbackAnswer: `I updated ${entry.phrase} so Kyro says it like ${entry.pronunciationHint}.`,
    intent: "pronunciation_update",
    links: [
      {
        href: "/settings?section=voice",
        label: "Voice settings",
        meta: "Pronunciation list",
      },
    ],
    mutation: {
      entityId: entry.id,
      entityType: "assistant_pronunciation",
      label: "Pronunciation updated",
    },
    title: "Pronunciation update",
  };
}

async function emailSyncCommand({
  supabase,
  user,
  workspace,
}: Pick<
  CommandInput,
  "supabase" | "user" | "workspace"
>): Promise<AssistantCommandResult> {
  const result = await syncInboundEmail({
    supabase,
    trigger: "assistant",
    user,
    workspaceId: workspace.id,
  });
  const answer =
    result.needsReconnect.length > 0
      ? `I checked email, but ${result.needsReconnect.length} account needs to be reconnected with inbox-read permission. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
      : result.errors.length > 0
        ? `I checked email with ${result.errors.length} issue(s). I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
        : `I checked email. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, observed ${result.observedMessages}, and skipped ${result.duplicates} duplicate(s).`;

  return {
    context: {
      result,
      scope:
        "Manual assistant-triggered inbound email sync. New actionable mail is promoted to CRM conversations.",
    },
    fallbackAnswer: answer,
    intent: "email_sync",
    links: result.promotedConversations
      .slice(0, 5)
      .map((conversation) =>
        rowLink(
          conversation.subject,
          `/inbox/${conversation.conversationId}`,
          titleCase(conversation.provider),
        ),
      ),
    title: "Email sync",
  };
}

async function inboundEmailAwarenessCommand({
  prompt,
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "prompt" | "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const text = normalized(prompt);
  const [operationalSummary, skippedSummary] = await Promise.all([
    getInboundEmailOperationalSummary(supabase, workspace.id),
    getSkippedEmailSummaries(supabase, workspace.id),
  ]);
  const decisions = operationalSummary.decisions;
  const promoted = decisions.filter(
    (decision) => decision.stage === "promoted",
  );
  const observed = decisions.filter(
    (decision) => decision.stage === "observed",
  );
  const failed = decisions.filter((decision) => decision.stage === "failed");
  const withAttachments = decisions.filter(
    (decision) => decision.attachmentCount > 0,
  );
  const wantsSkipped =
    text.includes("skipped") ||
    text.includes("filtered") ||
    text.includes("ignored");
  const wantsAttachments = text.includes("attachment") || text.includes("file");
  const latest = wantsSkipped
    ? (observed[0] ?? decisions[0])
    : wantsAttachments
      ? (withAttachments[0] ?? decisions[0])
      : decisions[0];
  const promotedLinks = promoted
    .filter((decision) => decision.conversationId)
    .slice(0, 4)
    .map((decision) =>
      rowLink(
        decision.subject,
        `/inbox/${decision.conversationId}`,
        `${titleCase(decision.stage ?? "email")} - ${assistantDate(
          decision.receivedAt ?? decision.createdAt,
        )}`,
      ),
    );
  const links =
    promotedLinks.length > 0
      ? promotedLinks
      : [
          rowLink(
            "Filtered-out emails",
            "/inbox?skipped=1",
            `${skippedSummary.last24HoursCount} last 24h`,
          ),
          rowLink(
            "Inbound email settings",
            "/settings?section=integrations",
            "Connected inboxes",
          ),
        ];
  const latestLine = latest
    ? `Latest seen: "${latest.subject}" from ${latest.fromEmail ?? "unknown sender"} (${titleCase(
        latest.stage ?? latest.status,
      )}).`
    : "Kyro has not recorded any inbound email decisions yet.";
  const skippedLine = wantsSkipped
    ? `There are ${skippedSummary.items.length} filtered-out emails in the tray, with ${skippedSummary.last24HoursCount} from the last 24 hours.`
    : `Recent inbound summary: ${promoted.length} promoted, ${observed.length} observed/filtered, ${failed.length} failed.`;
  const attachmentLine =
    withAttachments.length > 0
      ? `${withAttachments.length} recent email decision(s) included attachments.`
      : "No recent inbound email decisions show attachments.";

  return {
    context: {
      decisions,
      skippedEmails: skippedSummary.items.slice(0, 8),
      syncRuns: operationalSummary.syncRuns,
    },
    fallbackAnswer: wantsAttachments
      ? `${attachmentLine} ${latestLine}`
      : `${skippedLine} ${latestLine}`,
    intent: "inbound_email_awareness",
    links,
    title: "Inbound email awareness",
  };
}

async function assistantHistorySearchCommand({
  prompt,
  supabase,
  threadId,
  user,
  workspace,
}: Pick<
  CommandInput,
  "prompt" | "supabase" | "threadId" | "user" | "workspace"
>): Promise<AssistantCommandResult> {
  const resolvedThreadId =
    threadId ?? (await activeAssistantThreadId(supabase, workspace.id, user.id));
  const result = await searchAssistantHistory({
    query: prompt,
    supabase,
    threadId: resolvedThreadId,
    userId: user.id,
    workspaceId: workspace.id,
  });
  const top = result.items.slice(0, 5);

  return {
    context: {
      matches: result.items.map((item) => ({
        excerpt: item.excerpt,
        label: item.label,
        meta: item.meta ?? null,
        occurredAt: item.occurredAt,
        type: item.type,
      })),
      query: prompt,
      scope:
        "Searches raw assistant messages and compacted long-term context snapshots for the current user's persistent assistant.",
    },
    fallbackAnswer:
      top.length > 0
        ? `I found ${top.length} relevant assistant history item${top.length === 1 ? "" : "s"}. The strongest match is "${top[0].label}" from ${assistantDate(top[0].occurredAt)}.`
        : "I searched the assistant history I have indexed so far, but I did not find a clear match.",
    intent: "assistant_history_search",
    links: [],
    title: "Assistant history",
    uiBlocks: timelineBlock(
      "Assistant history",
      top.map((item) => ({
        at: assistantDate(item.occurredAt),
        detail: item.excerpt,
        label: item.label,
        tone: item.type === "snapshot" ? "purple" : "cyan",
      })),
    ),
  };
}

async function activeAssistantThreadId(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("assistant_threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load assistant thread: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("Assistant thread was not found.");
  }

  return String(data.id);
}

async function memoryCommand({
  prompt,
}: Pick<CommandInput, "prompt">): Promise<AssistantCommandResult> {
  return {
    context: {
      instruction: prompt,
      persistence:
        "Saved when the request contains an explicit memory instruction.",
    },
    fallbackAnswer: "I have noted that for future assistant context.",
    intent: "memory_save",
    links: [],
    title: "Memory",
  };
}

async function generalChatCommand({
  prompt,
}: Pick<CommandInput, "prompt">): Promise<AssistantCommandResult> {
  return {
    context: {
      prompt,
      scope:
        "General conversational assistant turn. No CRM records were requested, so no UI cards should be shown.",
    },
    fallbackAnswer: generalChatFallback(prompt),
    intent: "general_chat",
    links: [],
    title: "Chat",
  };
}

function generalChatFallback(prompt: string) {
  const text = normalized(prompt);

  if (text.includes("favourite meal") || text.includes("favorite meal")) {
    return "If I had to pick, I would go for a proper breakfast roll and a dangerously strong coffee. Very practical, very on-brand for a trades CRM assistant.";
  }

  if (text.includes("how are you") || text.includes("how are you feeling")) {
    return "I am feeling switched on and ready to help. Slightly over-caffeinated in spirit, which is probably the correct setting for Kyro.";
  }

  return "I'm here. Ask me anything, serious or stupid, and we can get into it.";
}

async function workQueueCommand({
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const conversations = await getConversationList(supabase, workspace.id);
  const actionable = conversations.filter(isConversationInLiveWorkQueue);
  const top = actionable.slice(0, 5);
  const summaries = top.map(workQueueVoiceSummary);
  const approvalItems = actionable
    .filter((conversation) => conversation.pendingApprovalCount > 0)
    .slice(0, 5)
    .map((conversation) => ({
      detail: `${conversation.pendingApprovalCount} approval${conversation.pendingApprovalCount === 1 ? "" : "s"} - ${conversation.nextActionLabel}`,
      href: `/inbox/${conversation.id}`,
      id: conversation.id,
      label: conversation.contactName ?? conversation.leadTitle ?? "Inquiry",
      status: conversation.workflowBucket,
    }));

  return {
    context: {
      count: actionable.length,
      records: recordsContext(
        top.map((conversation) => ({
          customer: conversation.contactName,
          job:
            conversation.inquiryFacts?.jobType ??
            conversation.leadServiceType ??
            conversation.leadTitle,
          nextAction: conversation.nextActionLabel,
          operatorSummary: workQueueVoiceSummary(conversation),
          missingInfo: conversation.inquiryFacts?.missingInfo ?? [],
          status: conversation.status,
          workflowBucket: conversation.workflowBucket,
        })),
      ),
    },
    fallbackAnswer:
      top.length > 0
        ? `${actionable.length} conversation${actionable.length === 1 ? "" : "s"} need attention. ${summaries.join(" ")}`
        : "There are no conversations needing immediate attention in the current work queue.",
    intent: "work_queue",
    links: top.map(conversationToAssistantLink),
    title: "Work queue",
    uiBlocks: [
      ...summaryCardsBlock("Queue summary", [
        {
          detail: "Live work queue",
          href: "/inbox",
          label: "Needs attention",
          tone: actionable.length > 0 ? "warning" : "success",
          value: String(actionable.length),
        },
      ]),
      ...approvalQueueBlock("Approval queue", approvalItems),
    ],
  };
}

function workQueueVoiceSummary(conversation: ConversationListItem) {
  const customer = conversationDisplayName(conversation);
  const job = conversationJobLabel(conversation);
  const jobSuffix = job === "General inquiry" ? "" : ` for ${job}`;
  const missing = conversation.inquiryFacts?.missingInfo ?? [];

  if (conversation.workflowBucket === "missing_info") {
    const missingText = joinHumanList(missing);

    return `${customer}${jobSuffix}: missing ${missingText || "key details"}. Next step: send a short reply asking for that.`;
  }

  if (
    conversation.pendingApprovalCount > 0 ||
    conversation.status === "reply_drafted"
  ) {
    return `${customer}${jobSuffix}: a draft reply is waiting for review. Next step: review and send it.`;
  }

  if (conversation.workflowBucket === "follow_up_due") {
    return `${customer}${jobSuffix}: follow-up is due. Next step: check the thread and nudge the customer if still relevant.`;
  }

  if (conversation.workflowBucket === "ready_to_quote") {
    return `${customer}${jobSuffix}: ready for quote work. Next step: prepare or review the quote.`;
  }

  if (conversation.workflowBucket === "site_visit_needed") {
    return `${customer}${jobSuffix}: likely needs a site visit. Next step: suggest a booking time.`;
  }

  if (conversation.workflowBucket === "needs_review") {
    return `${customer}${jobSuffix}: needs review before action. Next step: check the profile and inquiry details.`;
  }

  return `${customer}${jobSuffix}: ${conversation.nextActionLabel}.`;
}

async function inquiryLookupCommand({
  prompt,
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "prompt" | "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const conversations = await getConversationList(supabase, workspace.id);
  const searchTerm = inquirySearchTerm(prompt);
  const matches = rankInquiryMatches(conversations, searchTerm);
  const exactMatches = matches.filter(
    (match) => match.matchQuality === "exact",
  );
  const selected = exactMatches.length > 0 ? exactMatches : matches;
  const top = selected.slice(0, 5).map((match) => match.conversation);

  if (exactMatches.length === 1) {
    const conversation = exactMatches[0].conversation;

    return {
      context: {
        matchType: "exact",
        records: recordsContext([inquiryRecord(conversation)]),
        searchTerm,
      },
      fallbackAnswer: `${inquiryStatusSummary(conversation)} Open the inquiry below if you want to review or action it.`,
      intent: "inquiry_lookup",
      links: [conversationToInquiryLink(conversation)],
      title: "Inquiry",
    };
  }

  if (top.length > 0) {
    return {
      context: {
        matchType: exactMatches.length > 1 ? "multiple_exact" : "partial",
        records: recordsContext(top.map(inquiryRecord)),
        searchTerm,
      },
      fallbackAnswer:
        top.length === 1
          ? `I found a possible match for "${searchTerm}": ${conversationDisplayName(top[0])}. Do you mean this inquiry?`
          : `I found ${top.length} possible inquiry matches for "${searchTerm}". Which one do you mean?`,
      intent: "inquiry_lookup",
      links: top.map(conversationToInquiryLink),
      title:
        top.length === 1
          ? "Possible inquiry match"
          : "Possible inquiry matches",
    };
  }

  return {
    context: {
      matchType: "none",
      records: [],
      searchTerm,
    },
    fallbackAnswer: `I could not find an inquiry matching "${searchTerm}". Try the customer's first name, surname, phone/email, or the job type.`,
    intent: "inquiry_lookup",
    links: [],
    title: "Inquiry lookup",
  };
}

async function quoteCommand({
  prompt,
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "prompt" | "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const quotes = await getQuoteDraftList(supabase, workspace.id);
  const searchTerm = quoteSearchTerm(prompt);
  const text = normalized(prompt);
  const statusFilter = [
    "approved",
    "archived",
    "changes_requested",
    "draft",
    "ready",
    "sent",
  ].find((status) => text.includes(status));
  const matched = quotes.filter((quote) => {
    const haystack = normalized(
      [
        quote.title,
        quote.status,
        quote.contact?.name,
        quote.contact?.company,
        quote.contact?.email,
        quote.lead?.title,
        quote.lead?.serviceType,
        quote.inquiryFacts?.jobType,
        quote.inquiryFacts?.address,
      ]
        .filter(Boolean)
        .join(" "),
    );

    return (
      (!statusFilter || quote.status === statusFilter) &&
      (!searchTerm || haystack.includes(searchTerm))
    );
  });
  const results = searchTerm || statusFilter ? matched : quotes;
  const top = results.slice(0, 5);

  return {
    context: {
      count: results.length,
      filter: statusFilter ?? null,
      records: recordsContext(
        top.map((quote) => ({
          customer:
            quote.contact?.name ??
            quote.contact?.company ??
            quote.metadata.customerName,
          job:
            quote.inquiryFacts?.jobType ??
            quote.lead?.serviceType ??
            quote.metadata.jobType,
          lineItems: quote.lineItemCount,
          status: quote.status,
          title: quote.title,
        })),
      ),
      searchTerm,
    },
    fallbackAnswer:
      top.length > 0
        ? `I found ${results.length} quote draft${results.length === 1 ? "" : "s"}. The first is ${top[0].title}, currently ${titleCase(top[0].status)}.`
        : `I could not find a quote draft matching "${searchTerm || statusFilter || "that request"}".`,
    intent: "quote_lookup",
    links: top.map((quote) =>
      rowLink(
        quote.title,
        `/files/${quote.id}`,
        `${titleCase(quote.status)} - ${quote.lineItemCount} line items`,
      ),
    ),
    title: "Quote drafts",
  };
}

function quoteSendSubject(title: string) {
  return `Your quote: ${title}`;
}

function quoteSendBody({
  approvalUrl,
  customerName,
  jobLabel,
}: {
  approvalUrl?: string | null;
  customerName: string | null;
  jobLabel: string | null;
}) {
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";
  const scope = jobLabel ? ` for ${jobLabel}` : "";

  return [
    greeting,
    "",
    `Thanks for the opportunity. I have attached the quote${scope} for you to review.`,
    "",
    approvalUrl
      ? `You can approve the quote or request changes here: ${approvalUrl}`
      : "Please let me know if you would like anything changed, or if you are happy for us to proceed.",
    "",
    "If the link gives you any trouble, just reply to this email and I will help.",
  ].join("\n");
}

function quoteReadyRecord(quote: QuoteDraftListItem) {
  const readiness = quoteSendReadiness(quote);
  const revisionState = quoteRevisionState(quote.metadata);

  return {
    blockers: readiness.blockers,
    customer: quoteCustomerLabel(quote),
    customerEmail: readiness.customerEmail,
    job: quoteJobLabel(quote),
    lineItems: quote.lineItemCount,
    linkedConversationId: quote.conversation?.id ?? null,
    quoteVersion: revisionState.currentVersion,
    revisionNeeded: revisionState.needsRevision,
    status: quote.status,
    title: quote.title,
  };
}

async function quoteSendReadyListCommand({
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const quotes = await getQuoteDraftList(supabase, workspace.id);
  const openQuotes = quotes.filter(quoteIsSendableStatus);
  const ready = openQuotes.filter((quote) => quoteSendReadiness(quote).ready);
  const blocked = openQuotes.filter(
    (quote) => !quoteSendReadiness(quote).ready,
  );
  const top = ready.slice(0, 6);

  return {
    context: {
      blockedCount: blocked.length,
      blockedExamples: recordsContext(
        blocked.slice(0, 6).map(quoteReadyRecord),
      ),
      readyCount: ready.length,
      readyQuotes: recordsContext(top.map(quoteReadyRecord)),
    },
    fallbackAnswer:
      ready.length > 0
        ? `${ready.length} quote draft${ready.length === 1 ? "" : "s"} look ready to prepare for customer review. Say "send the quote for [customer/job]" and I will create the reviewable email with the PDF attached.`
        : blocked.length > 0
          ? `I found ${blocked.length} open quote draft${blocked.length === 1 ? "" : "s"}, but none are ready to send yet. The usual blockers are missing customer email or no linked inquiry.`
          : "There are no open quote drafts ready to send.",
    intent: "quote_send_ready_list",
    links: top.map((quote) =>
      rowLink(
        quote.title,
        `/files/${quote.id}`,
        `${quoteCustomerLabel(quote)} - ${titleCase(quote.status)}`,
      ),
    ),
    title: "Quotes ready to send",
  };
}

async function quoteHistoryCommand({
  prompt,
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "prompt" | "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const quotes = await getQuoteDraftList(supabase, workspace.id);
  const selection = selectQuoteDraftForAssistantPrompt(prompt, quotes, {
    includeSent: true,
  });

  if (!selection.quote) {
    const candidates = selection.candidates.slice(0, 5);

    return {
      context: {
        candidates: candidates.map((candidate) => ({
          customer: quoteCustomerLabel(candidate.quote),
          id: candidate.quote.id,
          job: quoteJobLabel(candidate.quote),
          score: candidate.score,
          status: candidate.quote.status,
          title: candidate.quote.title,
        })),
        searchTerm: selection.searchTerm,
      },
      fallbackAnswer:
        candidates.length > 0
          ? "I can check quote history, but I need to know which quote draft you mean."
          : `I could not find a quote draft matching "${selection.searchTerm || "that request"}".`,
      intent: "quote_history",
      links: candidates.map((candidate) =>
        rowLink(
          candidate.quote.title,
          `/files/${candidate.quote.id}`,
          `${quoteCustomerLabel(candidate.quote)} - ${titleCase(candidate.quote.status)}`,
        ),
      ),
      title: candidates.length > 0 ? "Choose a quote" : "Quote not found",
    };
  }

  const [profile, documentTemplateSettings] = await Promise.all([
    getQuoteDraftProfile(supabase, workspace.id, selection.quote.id),
    getDocumentTemplateSettings(supabase, workspace.id),
  ]);

  if (!profile) {
    return {
      context: {
        quoteDraftId: selection.quote.id,
      },
      fallbackAnswer: "I could not load that quote draft.",
      intent: "quote_history",
      links: [],
      title: "Quote history",
    };
  }

  const metadata = profile.quoteDraft.metadata;
  const history = quoteDocumentHistory(metadata);
  const revisionState = quoteRevisionState(metadata);
  const currentContentHash = quoteDocumentContentHash({
    profile,
    settings: documentTemplateDesignSettingsForQuote(
      metadata,
      documentTemplateSettings,
    ),
  });
  const freshness = quoteDocumentChangedSinceLastEvent({
    currentContentHash,
    history,
  });
  const sentEvent = history.find((event) => event.kind === "email_sent");
  const preparedEvent = history.find(
    (event) => event.kind === "email_prepared",
  );
  const generatedEvent = history.find(
    (event) => event.kind === "pdf_generated",
  );
  const approvedEvent = history.find(
    (event) => event.kind === "customer_approved",
  );
  const changesRequestedEvent = history.find(
    (event) => event.kind === "customer_changes_requested",
  );
  const viewedEvent = history.find((event) => event.kind === "customer_viewed");
  const versionLine = `Current quote version is v${revisionState.currentVersion}.`;
  const statusLine = approvedEvent
    ? `The customer approved it on ${assistantDate(approvedEvent.occurredAt)}.`
    : changesRequestedEvent
      ? `The customer requested changes on ${assistantDate(changesRequestedEvent.occurredAt)}.`
      : viewedEvent
        ? `The customer viewed it on ${assistantDate(viewedEvent.occurredAt)}, but I cannot see an approval or change request yet.`
        : sentEvent
          ? `It was sent${sentEvent.sentTo ? ` to ${sentEvent.sentTo}` : ""} on ${assistantDate(sentEvent.occurredAt)}.`
          : preparedEvent
            ? `It has a prepared email from ${assistantDate(preparedEvent.occurredAt)}, but I cannot see a sent event yet.`
            : generatedEvent
              ? `A PDF was generated on ${assistantDate(generatedEvent.occurredAt)}, but I cannot see a prepared or sent email yet.`
              : "I cannot see any generated PDF, prepared email, sent email, customer view, or customer approval history for this quote yet.";
  const changedLine = revisionState.pendingChangeRequest
    ? `The customer requested changes to v${revisionState.pendingChangeRequest.requestedFromVersion}: ${revisionState.pendingChangeRequest.message ?? "no note was provided"}.`
    : freshness.latest
      ? freshness.changed
        ? "The quote has changed since the latest document event, so generate or prepare a fresh PDF before relying on it."
        : "The latest document event matches the current quote content."
      : "There is no document version to compare against yet.";

  return {
    context: {
      changedSinceLatestDocument: freshness.changed,
      currentContentHash,
      generatedEvent,
      history: history.slice(0, 8),
      latestDocumentEvent: freshness.latest,
      quoteVersion: revisionState.currentVersion,
      approvedEvent,
      changesRequestedEvent,
      preparedEvent,
      quote: quoteReadyRecord(profile.quoteDraft),
      sentEvent,
      viewedEvent,
    },
    fallbackAnswer: `${profile.quoteDraft.title}: ${versionLine} ${statusLine} ${changedLine}`,
    intent: "quote_history",
    links: [
      rowLink(
        profile.quoteDraft.title,
        `/files/${profile.quoteDraft.id}`,
        "Quote history",
      ),
      ...(profile.quoteDraft.conversation
        ? [
            rowLink(
              "Open inquiry",
              `/inbox/${profile.quoteDraft.conversation.id}`,
              "Linked conversation",
            ),
          ]
        : []),
    ],
    title: "Quote history",
  };
}

type PrepareQuoteSendResult =
  | {
      actionId: string;
      conversationId: string;
      customerEmail: string;
      document: Record<string, unknown>;
      quoteDraftId: string;
      quoteTitle: string;
      status: "prepared";
    }
  | {
      actionId: string;
      conversationId: string;
      quoteDraftId: string;
      quoteTitle: string;
      status: "duplicate";
    }
  | {
      message: string;
      quoteDraftId: string;
      quoteTitle: string;
      reason: string;
      status: "blocked";
    };

async function prepareQuoteDraftSendFromAssistant({
  prompt,
  quoteDraftId,
  supabase,
  user,
  workspace,
}: CommandInput & {
  quoteDraftId: string;
}): Promise<PrepareQuoteSendResult> {
  const { data: quoteDraft, error: quoteDraftError } = await supabase
    .from("quote_drafts")
    .select("id,title,status,metadata,contact_id,conversation_id,lead_id")
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (quoteDraftError) {
    throw new Error(`Unable to load quote draft: ${quoteDraftError.message}`);
  }

  if (!quoteDraft) {
    return {
      message: "I could not find that quote draft.",
      quoteDraftId,
      quoteTitle: "Quote draft",
      reason: "not_found",
      status: "blocked",
    };
  }

  const quoteTitle = String(quoteDraft.title);
  const conversationId = textValue(quoteDraft.conversation_id);

  if (!conversationId) {
    return {
      message:
        "That quote draft is not linked to an inquiry yet, so I cannot prepare a customer email for it.",
      quoteDraftId,
      quoteTitle,
      reason: "missing_conversation",
      status: "blocked",
    };
  }

  const [contactResult, leadResult] = await Promise.all([
    quoteDraft.contact_id
      ? supabase
          .from("contacts")
          .select("name,email,company")
          .eq("workspace_id", workspace.id)
          .eq("id", quoteDraft.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    quoteDraft.lead_id
      ? supabase
          .from("leads")
          .select("title,service_type")
          .eq("workspace_id", workspace.id)
          .eq("id", quoteDraft.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (contactResult.error) {
    throw new Error(
      `Unable to load customer contact: ${contactResult.error.message}`,
    );
  }

  if (leadResult.error) {
    throw new Error(`Unable to load linked lead: ${leadResult.error.message}`);
  }

  const contact = objectRecord(contactResult.data);
  const lead = objectRecord(leadResult.data);
  const metadata = objectRecord(quoteDraft.metadata);
  const revisionState = quoteRevisionState(metadata);
  const customerEmail =
    textValue(contact.email) ?? textValue(metadata.customerEmail);

  if (
    String(quoteDraft.status) === "changes_requested" ||
    revisionState.pendingChangeRequest
  ) {
    return {
      message:
        "That quote has customer-requested changes waiting. Open it, edit and save the revision, then I can prepare the revised quote email.",
      quoteDraftId,
      quoteTitle,
      reason: "revision_needs_edit",
      status: "blocked",
    };
  }

  if (!customerEmail) {
    return {
      message:
        "The linked customer needs an email address before I can prepare the quote email.",
      quoteDraftId,
      quoteTitle,
      reason: "missing_customer_email",
      status: "blocked",
    };
  }

  const pending = await supabase
    .from("actions")
    .select("id,input")
    .eq("workspace_id", workspace.id)
    .eq("type", "draft_reply")
    .eq("target_type", "conversation")
    .eq("target_id", conversationId)
    .in("status", ["pending_approval", "approved"])
    .limit(25);

  if (pending.error) {
    throw new Error(
      `Unable to check pending quote emails: ${pending.error.message}`,
    );
  }

  const duplicateAction = (pending.data ?? []).find((action) => {
    const input = objectRecord(action.input);

    return textValue(input.attachmentQuoteDraftId) === quoteDraftId;
  });

  if (duplicateAction) {
    return {
      actionId: String(duplicateAction.id),
      conversationId,
      quoteDraftId,
      quoteTitle,
      status: "duplicate",
    };
  }

  const approvalLink = await createQuoteApprovalLinkForDraft(supabase, {
    actorId: user.id,
    actorType: "ai",
    customerEmail,
    quoteDraftId,
    source: "assistant.quote_send",
    workspaceId: workspace.id,
  });
  const artifact = await buildQuotePdfArtifactForDraft(supabase, {
    quoteDraftId,
    workspace,
  });
  const documentMetadata = quoteVersionedDocumentMetadata(
    quotePdfMetadata(artifact),
    metadata,
  );
  const customerName =
    textValue(metadata.customerName) ??
    textValue(contact.name) ??
    textValue(contact.company);
  const jobLabel =
    textValue(metadata.jobType) ??
    textValue(lead.service_type) ??
    textValue(lead.title) ??
    quoteTitle;
  const subject =
    revisionState.currentVersion > 1
      ? `Your revised quote: ${quoteTitle}`
      : quoteSendSubject(quoteTitle);
  const body = quoteSendBody({
    approvalUrl: approvalLink.url,
    customerName,
    jobLabel,
  });

  const { data: action, error: actionError } = await supabase
    .from("actions")
    .insert({
      workspace_id: workspace.id,
      type: "draft_reply",
      status: "pending_approval",
      requested_by: "ai",
      approval_required: true,
      target_type: "conversation",
      target_id: conversationId,
      input: {
        attachmentQuoteDraftId: quoteDraftId,
        approvalLinkId: approvalLink.approvalLink.id,
        approvalUrl: approvalLink.url,
        body,
        channelType: "email",
        generatedDocument: documentMetadata,
        quoteDraftId,
        settingsSnapshot: {
          approvalRequired: true,
          generatedDocument: documentMetadata,
          quoteApprovalLinkId: approvalLink.approvalLink.id,
          source: "assistant.quote_send",
        },
        signatureVariant: "ai_generated",
        source: "assistant.quote_send",
        subject,
      },
      policy_snapshot: {
        mode: "require_approval",
        reason: "Customer-facing document sends require user review.",
        source: "assistant.quote_send",
      },
    })
    .select("id")
    .single();

  if (actionError || !action) {
    throw new Error(
      `Unable to prepare quote email: ${actionError?.message ?? "unknown error"}`,
    );
  }

  const preparedMetadata = markQuotePreparedForCustomer({
    approvalLinkId: approvalLink.approvalLink.id,
    at: documentMetadata.generatedAt,
    contentHash: documentMetadata.contentHash,
    metadata: {
      ...metadata,
      lastGeneratedDocument: documentMetadata,
      preparedSendActionId: String(action.id),
      preparedSendAt: documentMetadata.generatedAt,
    },
    source: "assistant.quote_send",
  });
  const nextMetadata = appendQuoteDocumentHistory(preparedMetadata, {
    actionId: String(action.id),
    actorType: "ai",
    contentHash: documentMetadata.contentHash,
    document: documentMetadata,
    kind: "email_prepared",
    occurredAt: documentMetadata.generatedAt,
    quoteVersion: quoteRevisionState(preparedMetadata).currentVersion,
    source: "assistant.quote_send",
  });
  const { error: updateError } = await supabase
    .from("quote_drafts")
    .update({
      metadata: nextMetadata,
      status:
        String(quoteDraft.status) === "draft" ||
        String(quoteDraft.status) === "changes_requested"
          ? "ready"
          : quoteDraft.status,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId);

  if (updateError) {
    throw new Error(`Unable to update quote draft: ${updateError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "ai",
    actorId: user.id,
    action: "assistant_quote_draft.send_prepared",
    entityType: "quote_draft",
    entityId: quoteDraftId,
    before: {
      metadata,
      status: quoteDraft.status,
    },
    after: {
      actionId: String(action.id),
      document: documentMetadata,
      metadata: nextMetadata,
      status:
        String(quoteDraft.status) === "draft" ||
        String(quoteDraft.status) === "changes_requested"
          ? "ready"
          : quoteDraft.status,
    },
    metadata: {
      assistantPrompt: prompt,
      conversationId,
      customerEmail,
      quoteApprovalLinkId: approvalLink.approvalLink.id,
      quoteVersion: quoteRevisionState(preparedMetadata).currentVersion,
      requestedByUserId: user.id,
      source: "assistant.quote_send",
    },
  });

  return {
    actionId: String(action.id),
    conversationId,
    customerEmail,
    document: documentMetadata,
    quoteDraftId,
    quoteTitle,
    status: "prepared",
  };
}

async function quoteSendCommand({
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const quotes = await getQuoteDraftList(supabase, workspace.id);
  const selection = selectQuoteDraftForAssistantPrompt(prompt, quotes);

  if (!selection.quote) {
    const candidates = selection.candidates.slice(0, 5);

    return {
      context: {
        candidates: candidates.map((candidate) => ({
          customer: quoteCustomerLabel(candidate.quote),
          id: candidate.quote.id,
          job: quoteJobLabel(candidate.quote),
          reasons: candidate.reasons,
          score: candidate.score,
          status: candidate.quote.status,
          title: candidate.quote.title,
        })),
        searchTerm: selection.searchTerm,
      },
      fallbackAnswer:
        selection.kind === "ambiguous" && candidates.length > 0
          ? "I can prepare the quote email, but I need to know which quote draft you mean."
          : `I could not find an open quote draft matching "${selection.searchTerm || "that request"}".`,
      intent: "quote_send_prepare",
      links: candidates.map((candidate) =>
        rowLink(
          candidate.quote.title,
          `/files/${candidate.quote.id}`,
          `${quoteCustomerLabel(candidate.quote)} - ${titleCase(candidate.quote.status)}`,
        ),
      ),
      title:
        selection.kind === "ambiguous" ? "Choose a quote" : "Quote not found",
    };
  }

  const readiness = quoteSendReadiness(selection.quote);

  if (!readiness.ready) {
    return {
      context: {
        blockers: readiness.blockers,
        quote: quoteReadyRecord(selection.quote),
      },
      fallbackAnswer: `I found ${selection.quote.title}, but I cannot prepare it for sending yet because it is ${readiness.blockers.join(" and ")}.`,
      intent: "quote_send_prepare",
      links: [
        rowLink(
          selection.quote.title,
          `/files/${selection.quote.id}`,
          "Fix quote details",
        ),
      ],
      title: "Quote needs setup",
    };
  }

  const result = await prepareQuoteDraftSendFromAssistant({
    prompt,
    quoteDraftId: selection.quote.id,
    supabase,
    user,
    workspace,
  });

  if (result.status === "blocked") {
    return {
      context: {
        quoteDraftId: result.quoteDraftId,
        reason: result.reason,
      },
      fallbackAnswer: result.message,
      intent: "quote_send_prepare",
      links: [
        rowLink(
          result.quoteTitle,
          `/files/${result.quoteDraftId}`,
          "Quote draft",
        ),
      ],
      title: "Quote needs setup",
    };
  }

  if (result.status === "duplicate") {
    return {
      context: {
        actionId: result.actionId,
        conversationId: result.conversationId,
        quoteDraftId: result.quoteDraftId,
      },
      fallbackAnswer:
        "A quote email is already prepared for this draft. Review the pending message in the linked inquiry before creating another one.",
      intent: "quote_send_prepare",
      links: [
        rowLink(
          result.quoteTitle,
          `/inbox/${result.conversationId}`,
          "Review email",
        ),
        rowLink(
          result.quoteTitle,
          `/files/${result.quoteDraftId}`,
          "Quote draft",
        ),
      ],
      title: "Quote email already prepared",
    };
  }

  return {
    context: {
      actionId: result.actionId,
      conversationId: result.conversationId,
      customerEmail: result.customerEmail,
      document: result.document,
      quoteDraftId: result.quoteDraftId,
      quoteTitle: result.quoteTitle,
    },
    fallbackAnswer:
      "I prepared a reviewable customer email with the quote PDF attached. It has not been sent yet; open the inquiry, check the message, then send it when you are happy.",
    intent: "quote_send_prepare",
    links: [
      rowLink(
        result.quoteTitle,
        `/inbox/${result.conversationId}`,
        "Review and send",
      ),
      rowLink(
        result.quoteTitle,
        `/files/${result.quoteDraftId}`,
        "Quote draft",
      ),
    ],
    mutation: {
      entityId: result.actionId,
      entityType: "action",
      label: "Quote email prepared",
    },
    title: "Quote email prepared",
  };
}

async function contactCommand({
  prompt,
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "prompt" | "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const contacts = await getContactList(supabase, workspace.id);
  const searchTerm = contactSearchTerm(prompt);
  const matched = contacts.filter((contact) => {
    const haystack = normalized(
      [
        contact.name,
        contact.company,
        contact.email,
        contact.phone,
        contact.address,
        contact.contactType,
      ]
        .filter(Boolean)
        .join(" "),
    );

    return !searchTerm || haystack.includes(searchTerm);
  });
  const contact = matched[0] ?? contacts[0] ?? null;

  if (!contact) {
    return {
      context: {
        count: 0,
        searchTerm,
      },
      fallbackAnswer: "There are no contacts to summarise yet.",
      intent: "contact_summary",
      links: [],
      title: "Contact summary",
    };
  }

  const profile = await getContactProfile(supabase, workspace.id, contact.id);
  const contactTimeline = profile
    ? [
        ...profile.messages.slice(0, 4).map((message) => ({
          at: message.receivedAt ?? message.sentAt ?? message.createdAt,
          detail:
            message.subject ??
            message.bodyText?.slice(0, 120) ??
            "Message recorded",
          href: message.conversationId
            ? `/inbox/${message.conversationId}`
            : `/contacts/${contact.id}`,
          label: `${titleCase(message.direction)} message`,
          tone:
            message.direction === "inbound"
              ? ("cyan" as const)
              : ("pink" as const),
        })),
        ...profile.quoteDrafts.slice(0, 2).map((quote) => ({
          at: quote.updatedAt,
          detail: `${titleCase(quote.status)} - ${quote.lineItemCount} line items`,
          href: `/files/${quote.id}`,
          label: quote.title,
          tone: "purple" as const,
        })),
      ]
        .sort((left, right) => {
          const leftTime = left.at ? Date.parse(left.at) : 0;
          const rightTime = right.at ? Date.parse(right.at) : 0;

          return rightTime - leftTime;
        })
        .slice(0, 5)
    : [];

  return {
    context: {
      contact: profile
        ? {
            actions: profile.counts.actions,
            address: profile.contact.address,
            company: profile.contact.company,
            contactType: profile.contact.contactType,
            conversations: profile.counts.conversations,
            email: profile.contact.email,
            leads: profile.counts.leads,
            messages: profile.counts.messages,
            name: profile.contact.name,
            phone: profile.contact.phone,
            quoteDrafts: profile.counts.quoteDrafts,
            recentLeads: recordsContext(
              profile.leads.map((lead) => ({
                nextStep: lead.nextStep,
                serviceType: lead.serviceType,
                status: lead.status,
                title: lead.title,
              })),
            ),
          }
        : contact,
      searchTerm,
    },
    fallbackAnswer: `${contact.name ?? contact.company ?? "This contact"} has ${profile?.counts.messages ?? contact.messageCount} linked messages, ${profile?.counts.leads ?? 0} leads, and ${profile?.counts.quoteDrafts ?? 0} quote drafts.`,
    intent: "contact_summary",
    links: [
      rowLink(
        contact.name ?? contact.company ?? "Open contact",
        `/contacts/${contact.id}`,
        contact.email ?? contact.phone ?? undefined,
      ),
    ],
    title: "Contact summary",
    uiBlocks: [
      ...summaryCardsBlock("Contact snapshot", [
        {
          detail: "Linked messages",
          href: `/contacts/${contact.id}`,
          label: "Messages",
          tone: "cyan",
          value: String(profile?.counts.messages ?? contact.messageCount),
        },
        {
          detail: "Open or historical leads",
          href: `/contacts/${contact.id}`,
          label: "Leads",
          tone: "purple",
          value: String(profile?.counts.leads ?? 0),
        },
        {
          detail: "Documents linked to this profile",
          href: `/contacts/${contact.id}`,
          label: "Quotes",
          tone: "pink",
          value: String(profile?.counts.quoteDrafts ?? 0),
        },
      ]),
      ...timelineBlock("Recent contact timeline", contactTimeline),
    ],
  };
}

type InquiryMatch = {
  conversation: ConversationListItem;
  matchedTokens: string[];
  matchQuality: "exact" | "partial";
  score: number;
};

function rankInquiryMatches(
  conversations: ConversationListItem[],
  searchTerm: string,
): InquiryMatch[] {
  const requestedTokens = meaningfulTokens(searchTerm);

  if (requestedTokens.length === 0) {
    return [];
  }

  return conversations
    .map((conversation) =>
      scoreInquiryMatch(conversation, searchTerm, requestedTokens),
    )
    .filter((match): match is InquiryMatch => Boolean(match))
    .sort((left, right) => right.score - left.score);
}

function scoreInquiryMatch(
  conversation: ConversationListItem,
  searchTerm: string,
  requestedTokens: string[],
): InquiryMatch | null {
  const normalizedSearchTerm = normalized(searchTerm);
  const haystack = normalized(inquiryHaystack(conversation));
  const contactName = normalized(conversation.contactName ?? "");
  const matchedTokens = requestedTokens.filter((token) =>
    haystack.includes(token),
  );

  if (matchedTokens.length === 0) {
    return null;
  }

  const allTokensMatched = matchedTokens.length === requestedTokens.length;
  const phraseMatched = Boolean(
    normalizedSearchTerm && haystack.includes(normalizedSearchTerm),
  );
  const contactPhraseMatched = Boolean(
    normalizedSearchTerm && contactName.includes(normalizedSearchTerm),
  );
  const matchQuality = allTokensMatched || phraseMatched ? "exact" : "partial";
  const score =
    matchedTokens.length * 12 +
    (allTokensMatched ? 45 : 0) +
    (phraseMatched ? 70 : 0) +
    (contactPhraseMatched ? 30 : 0) +
    (conversation.workflowBucket === "needs_reply" ? 4 : 0);

  return {
    conversation,
    matchedTokens,
    matchQuality,
    score,
  };
}

function inquiryHaystack(conversation: ConversationListItem) {
  return [
    conversation.contactName,
    conversation.leadTitle,
    conversation.leadServiceType,
    conversation.leadNextStep,
    conversation.latestSubject,
    conversation.latestBody,
    conversation.inquiryFacts?.jobType,
    conversation.inquiryFacts?.address,
    conversation.inquiryFacts?.missingInfo.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function conversationDisplayName(conversation: ConversationListItem) {
  return conversation.contactName ?? conversation.leadTitle ?? "this inquiry";
}

function conversationJobLabel(conversation: ConversationListItem) {
  const candidates = [
    conversation.inquiryFacts?.jobType,
    conversation.leadServiceType,
    conversation.leadTitle,
  ];

  return (
    candidates.find(
      (candidate) => candidate && !isGenericInquiryLabel(candidate),
    ) ?? "General inquiry"
  );
}

function isGenericInquiryLabel(value: string) {
  const label = normalized(value);

  return (
    label.startsWith("new inquiry from ") ||
    label.startsWith("new enquiry from ") ||
    label.startsWith("quote inquiry from ") ||
    label.startsWith("quote enquiry from ") ||
    label === "manual inbound" ||
    label === "manual inbound enquiry"
  );
}

function replyStatusForConversation(conversation: ConversationListItem) {
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

function inquiryRecord(conversation: ConversationListItem) {
  return {
    customer: conversationDisplayName(conversation),
    job: conversationJobLabel(conversation),
    nextAction: conversation.nextActionLabel,
    operatorSummary: inquiryStatusSummary(conversation),
    replyStatus: replyStatusForConversation(conversation),
    status: conversation.status,
    workflowBucket: conversation.workflowBucket,
  };
}

function conversationToInquiryLink(
  conversation: ConversationListItem,
): AssistantLink {
  const baseLink = conversationToAssistantLink(conversation);
  const jobLabel = conversationJobLabel(conversation);

  return {
    ...baseLink,
    label: `${conversationDisplayName(conversation)} inquiry`,
    meta:
      jobLabel === "General inquiry"
        ? conversation.nextActionLabel
        : `${conversation.nextActionLabel} - ${jobLabel}`,
  };
}

function inquiryStatusSummary(conversation: ConversationListItem) {
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

async function documentTemplateControlCommand({
  intent,
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput & {
  intent: "create" | "update";
}): Promise<AssistantCommandResult> {
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    throw new Error(
      `Unable to load document templates: ${beforeError.message}`,
    );
  }

  const beforeSettings = normalizeDocumentTemplateSettings(
    beforePolicy?.settings,
  );

  if (intent === "update" && beforeSettings.customTemplates.length === 0) {
    return {
      context: {
        templateCount: 0,
      },
      fallbackAnswer:
        "There are no reusable templates to edit yet. Create a template first, then Kyro can revise it from chat or voice.",
      intent: "document_template_update",
      links: [
        rowLink("Create template", "/files/templates/new", "Documents"),
      ],
      title: "Edit document template",
    };
  }

  const now = new Date().toISOString();
  const currentTemplate =
    intent === "update"
      ? selectQuoteTemplateForAssistantPrompt(
          prompt,
          beforeSettings.customTemplates,
        )
      : null;

  if (currentTemplate && !currentTemplate.template) {
    const candidates = currentTemplate.candidates.slice(0, 5);

    return {
      context: {
        candidates: candidates.map((candidate) => ({
          description: candidate.template.description,
          key: candidate.template.key,
          label: candidate.template.label,
          score: candidate.score,
        })),
        templateCount: beforeSettings.customTemplates.length,
      },
      fallbackAnswer:
        "I can edit a reusable template, but I need to know which template you want changed.",
      intent: "document_template_update",
      links: candidates.map((candidate) =>
        rowLink(
          candidate.template.label,
          `/files/templates/${encodeURIComponent(candidate.template.key)}`,
          candidate.template.description,
        ),
      ),
      title: "Choose a template to edit",
    };
  }

  const existingTemplate =
    currentTemplate?.template && "createdAt" in currentTemplate.template
      ? (currentTemplate.template as CustomDocumentTemplate)
      : null;
  const templatePayload = existingTemplate
    ? documentTemplateRevisionPayload(existingTemplate)
    : blankDocumentTemplateRevisionPayload({
        label: templateLabelFromPrompt(prompt),
        settings: beforeSettings,
      });
  const revision = await runDocumentTemplateRevision({
    instruction: prompt,
    template: templatePayload,
    workspaceName: workspace.name,
  });
  const key =
    existingTemplate?.key ??
    `custom_${slugValue(revision.data.label)}_${Date.now().toString(36)}`;
  const template = customTemplateFromRevision(revision.data, {
    createdAt: existingTemplate?.createdAt ?? now,
    key,
    now,
    referenceFiles: existingTemplate?.referenceFiles ?? [],
  });
  const settings = normalizeDocumentTemplateSettings({
    ...beforeSettings,
    customTemplates: existingTemplate
      ? beforeSettings.customTemplates.map((item) =>
          item.key === existingTemplate.key ? template : item,
        )
      : [...beforeSettings.customTemplates, template],
  });
  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    throw new Error(
      `Unable to save document template: ${saveError?.message ?? "unknown error"}`,
    );
  }

  const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
    supabase,
    workspace.id,
    "OPENAI_LLM_MARKUP_RATE",
  );
  const usageEvents = buildLlmUsageEvents({
    context: {
      metadata: {
        source: "assistant_document_template_control",
        templateKey: template.key,
      },
      providerUsageId: revision.usage.providerUsageId,
      usageMarkupRate,
      userId: user.id,
      workspaceId: workspace.id,
    },
    model: revision.model,
    provider: "openai",
    service: "llm",
    usage: revision.usage,
  });
  const usageTotals = usageEventTotals(usageEvents);
  const { data: templateAiRun } = await supabase
    .from("ai_runs")
    .insert({
      actual_cost: String(usageTotals.costSnapshot),
      completed_at: new Date().toISOString(),
      estimated_cost: String(usageTotals.costSnapshot),
      input_refs: {
        intent,
        source: "assistant_document_template_control",
        templateKey: template.key,
      },
      mode: "assistant_tool",
      model: revision.model,
      output: {
        templateKey: template.key,
        templateLabel: template.label,
      },
      provider: "openai",
      risk_level: "low",
      status: "completed",
      task_type: "document_template_revision",
      tool_calls: [],
      usage: {
        cachedInputTokens: revision.usage.cachedInputTokens,
        customerCharge: usageTotals.customerChargeSnapshot,
        inputTokens: revision.usage.inputTokens,
        outputTokens: revision.usage.outputTokens,
        reasoningTokens: revision.usage.reasoningTokens,
        totalTokens: revision.usage.totalTokens,
      },
      user_id: user.id,
      workspace_id: workspace.id,
    })
    .select("id")
    .single();

  if (templateAiRun?.id) {
    const aiRunId = String(templateAiRun.id);

    await supabase.from("usage_events").insert(
      toUsageEventRows(
        usageEvents.map((event) => ({
          ...event,
          aiRunId,
          sourceId: aiRunId,
          sourceType: "ai_run",
        })),
      ),
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: existingTemplate
      ? "assistant_document_template.updated"
      : "assistant_document_template.created",
    actorId: user.id,
    actorType: "ai",
    after: { template },
    before: existingTemplate
      ? { template: existingTemplate }
      : beforePolicy
        ? { settings: beforePolicy.settings }
        : null,
    entityId: String(savedPolicy.id),
    entityType: "workspace_policy",
    metadata: {
      assistantPrompt: prompt,
      model: revision.model,
      policyType: DOCUMENT_TEMPLATE_POLICY_TYPE,
      requestedByUserId: user.id,
      templateKey: template.key,
      usage: revision.usage,
    },
  });

  const actionLabel = existingTemplate ? "updated" : "created";

  return {
    context: {
      template: {
        description: template.description,
        key: template.key,
        label: template.label,
        lineItemCount: template.lineItems.length,
        notes: template.notes,
        revisionRequest: template.revisionRequest,
        settings: template.settings,
      },
    },
    fallbackAnswer: `${template.label} has been ${actionLabel} as a reusable document template.`,
    intent: existingTemplate
      ? "document_template_update"
      : "document_template_create",
    links: [
      rowLink(
        template.label,
        `/files/templates/${encodeURIComponent(template.key)}`,
        "Review template",
      ),
      rowLink(
        "Create draft",
        `/files/new?templateKey=${encodeURIComponent(template.key)}`,
        "Use this template",
      ),
    ],
    mutation: {
      entityId: template.key,
      entityType: "document_template",
      label: existingTemplate ? "Template updated" : "Template created",
    },
    title: existingTemplate ? "Template updated" : "Template created",
  };
}

async function createQuoteDraftCommand({
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const documentTemplateSettings = await getDocumentTemplateSettings(
    supabase,
    workspace.id,
  );
  const templates = quoteTemplateCatalog(
    documentTemplateSettings.customTemplates,
  );
  const templateSelection = selectQuoteTemplateForAssistantPrompt(
    prompt,
    templates,
  );

  if (templateSelection.kind === "none") {
    return {
      context: {
        templateCount: 0,
      },
      fallbackAnswer:
        "There are no document templates yet. Create a reusable quote template first, then Kyro can start quote drafts from it.",
      intent: "quote_create",
      links: [
        rowLink("Create template", "/files/templates/new", "Documents"),
      ],
      title: "Create quote draft",
    };
  }

  if (!templateSelection.template) {
    const candidates = templateSelection.candidates.slice(0, 5);

    return {
      context: {
        candidates: candidates.map((candidate) => ({
          description: candidate.template.description,
          key: candidate.template.key,
          label: candidate.template.label,
          score: candidate.score,
        })),
        templateCount: templates.length,
      },
      fallbackAnswer:
        "I can start a quote draft from a saved template, but I need to know which template to use.",
      intent: "quote_create",
      links: candidates.map((candidate) =>
        rowLink(
          candidate.template.label,
          `/files/new?templateKey=${encodeURIComponent(candidate.template.key)}`,
          candidate.template.description,
        ),
      ),
      title: "Choose a quote template",
    };
  }

  const template = templateSelection.template;
  const contacts = await getContactList(supabase, workspace.id);
  const contact = selectContactForAssistantPrompt(prompt, contacts);
  const title = draftTitleFromTemplate(template);
  const templateRecord = objectRecord(template);
  const templateSettings = normalizeDocumentTemplateDesignSettings(
    templateRecord.settings ?? documentTemplateSettings,
  );
  const referenceFiles = Array.isArray(templateRecord.referenceFiles)
    ? templateRecord.referenceFiles
    : [];
  const { data: quoteDraft, error } = await supabase
    .from("quote_drafts")
    .insert({
      workspace_id: workspace.id,
      contact_id: contact?.id ?? null,
      line_items: template.lineItems,
      metadata: {
        assistantPrompt: prompt,
        customerCompany: contact?.company ?? null,
        customerEmail: contact?.email ?? null,
        customerName: contact?.name ?? contact?.company ?? null,
        customerPhone: contact?.phone ?? null,
        documentTemplateReferenceFiles: referenceFiles,
        documentTemplateSettings: templateSettings,
        dryRun: true,
        jobAddress: contact?.address ?? null,
        jobType: template.label,
        preferredTime: null,
        quoteRevision: {
          currentVersion: 1,
          status: "draft",
        },
        requestedByUserId: user.id,
        source: "assistant.command",
        templateKey: template.key,
      },
      notes: template.notes,
      status: "draft",
      title,
    })
    .select("id,title,status")
    .single();

  if (error || !quoteDraft) {
    throw new Error(
      `Unable to create quote draft: ${error?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorId: user.id,
    actorType: "user",
    action: "quote_draft.created_from_assistant",
    after: {
      status: quoteDraft.status,
      templateKey: template.key,
      title: quoteDraft.title,
    },
    entityId: String(quoteDraft.id),
    entityType: "quote_draft",
    metadata: {
      assistantPrompt: prompt,
    },
  });

  return {
    context: {
      createdQuoteDraft: {
        contact: contact
          ? {
              company: contact.company,
              email: contact.email,
              id: contact.id,
              name: contact.name,
            }
          : null,
        id: String(quoteDraft.id),
        status: String(quoteDraft.status),
        template: template.label,
        title: String(quoteDraft.title),
      },
    },
    fallbackAnswer: `${quoteDraft.title} has been created as a draft.`,
    intent: "quote_create",
    links: [
      rowLink(String(quoteDraft.title), `/files/${quoteDraft.id}`, "Draft"),
      rowLink(
        "Print / PDF",
        `/files/${quoteDraft.id}/print`,
        "Customer document",
      ),
    ],
    mutation: {
      entityId: String(quoteDraft.id),
      entityType: "quote_draft",
      label: "Quote draft created",
    },
    title: "Create quote draft",
  };
}

async function imageGenerationCommand({
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const image = await generateKyroImage({
    prompt,
    supabase,
    user,
    workspace,
  });
  const label = image.editMode
    ? "Generated image with references"
    : "Generated image";
  const meta = `${image.provider} ${image.model} - ${image.size} - ${image.quality}`;

  return {
    context: {
      generatedImage: {
        editMode: image.editMode,
        fileId: image.fileId,
        filename: image.filename,
        model: image.model,
        provider: image.provider,
        quality: image.quality,
        referenceCount: image.referenceFiles.length,
        size: image.size,
      },
    },
    fallbackAnswer:
      image.referenceFiles.length > 0
        ? `I generated a referenced image from the attached file context and saved it to Kyro files.`
        : `I generated the image and saved it to Kyro files.`,
    intent: "image_generation",
    links: [
      rowLink(label, image.href, meta),
      rowLink("Download image", image.downloadHref, image.filename),
    ],
    mutation: {
      entityId: image.fileId,
      entityType: "file",
      label: "Generated image",
    },
    title: "Image generation",
    uiBlocks: generatedImageBlock("Generated image", [
      {
        alt: `Generated image for: ${prompt}`,
        contentType: image.contentType,
        downloadHref: image.downloadHref,
        editMode: image.editMode,
        fileId: image.fileId,
        filename: image.filename,
        href: image.href,
        meta,
        model: image.model,
        prompt,
        provider: image.provider,
        quality: image.quality,
        referenceCount: image.referenceFiles.length,
        size: image.size,
      },
    ]),
  };
}

async function usageSummaryCommand({
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const usage = await getUsageReport(supabase, workspace.id, "30d");
  const totals = usage.totals;
  const topTasks = usage.taskBreakdown.slice(0, 4);

  return {
    context: {
      generatedAt: usage.generatedAt,
      taskBreakdown: recordsContext(
        topTasks.map((task) => ({
          customerCharge: task.customerCharge,
          events: task.events,
          label: task.label,
          quantity: task.quantity,
        })),
      ),
      totals: {
        customerCharge: totals.customerCharge,
        currency: totals.currency,
        events: totals.events,
      },
      window: usage.activeWindow,
    },
    fallbackAnswer: `The last 30 days show ${totals.events} metered events with a total usage charge of ${assistantMoney(
      totals.customerCharge,
      totals.currency,
    )}.`,
    intent: "usage_summary",
    links: [
      rowLink(
        "Billing and metering",
        "/settings?section=usage",
        `${totals.events} events`,
      ),
    ],
    title: "Usage summary",
    uiBlocks: [
      ...summaryCardsBlock("Usage summary", [
        {
          detail: "Final metered usage charge",
          href: "/settings?section=usage",
          label: "Usage charge",
          tone: "purple",
          value: assistantMoney(totals.customerCharge, totals.currency),
        },
        {
          detail: "Recorded usage events",
          href: "/settings?section=usage",
          label: "Metered events",
          tone: "cyan",
          value: String(totals.events),
        },
      ]),
      ...timelineBlock(
        "Top metered work",
        topTasks.map((task) => ({
          detail: `${task.events} events - ${assistantMoney(
            task.customerCharge,
            task.currency,
          )}`,
          href: "/settings?section=usage",
          label: task.label,
          tone: "neutral" as const,
        })),
      ),
    ],
  };
}

async function overviewCommand({
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const [conversations, quotes, contacts, usage] = await Promise.all([
    getConversationList(supabase, workspace.id),
    getQuoteDraftList(supabase, workspace.id),
    getContactList(supabase, workspace.id),
    getUsageReport(supabase, workspace.id, "30d"),
  ]);
  const needsReply = conversations.filter(
    (conversation) => conversation.workflowBucket === "needs_reply",
  );
  const readyQuotes = quotes.filter((quote) => quote.status === "ready");

  return {
    context: {
      contacts: contacts.length,
      needsReply: needsReply.length,
      quoteDrafts: quotes.length,
      readyQuotes: readyQuotes.length,
      usage: usage.totals,
      workspaceName: workspace.name,
    },
    fallbackAnswer: `${workspace.name} has ${needsReply.length} conversations needing reply and ${readyQuotes.length} quote drafts ready.`,
    intent: "overview",
    links: [
      rowLink("Inbox", "/inbox", `${needsReply.length} need reply`),
      rowLink("Files", "/files", `${readyQuotes.length} ready quotes`),
      rowLink("Contacts", "/contacts", `${contacts.length} contacts`),
    ],
    title: "Workspace overview",
    uiBlocks: [
      ...summaryCardsBlock("Workspace snapshot", [
        {
          detail: "Conversations needing reply",
          href: "/inbox?filter=needs_reply",
          label: "Inbox",
          tone: needsReply.length > 0 ? "warning" : "success",
          value: String(needsReply.length),
        },
        {
          detail: "Quote drafts ready",
          href: "/files",
          label: "Quotes",
          tone: "purple",
          value: String(readyQuotes.length),
        },
        {
          detail: "Profiles indexed",
          href: "/contacts",
          label: "Contacts",
          tone: "cyan",
          value: String(contacts.length),
        },
        {
          detail: `${usage.totals.events} metered events in 30 days`,
          href: "/settings?section=usage",
          label: "Usage",
          tone: "pink",
          value: assistantMoney(
            usage.totals.customerCharge,
            usage.totals.currency,
          ),
        },
      ]),
    ],
  };
}
