import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  getContactList,
  getContactProfile,
  getConversationList,
  getQuoteDraftList,
  getQuoteDraftProfile,
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
import { syncInboundEmail } from "../integrations/inbound-email-sync";
import {
  conversationToAssistantLink,
  isConversationInLiveWorkQueue,
} from "./conversation-links";
import { getAssistantKnowledge } from "./knowledge";
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
import type { AssistantCommandResult, AssistantLink } from "./types";

type WorkspaceInput = {
  id: string;
  name: string;
};

type CommandInput = {
  prompt: string;
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceInput;
};

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

  const labelMatches = labelTokens.filter((token) => promptText.includes(token));
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

  if (!quote.conversation?.id) {
    blockers.push("not linked to an inquiry");
  }

  if (!customerEmailForQuote(quote)) {
    blockers.push("missing customer email");
  }

  if (!quoteIsSendableStatus(quote)) {
    blockers.push(`status is ${titleCase(quote.status)}`);
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
        candidates: [{ quote: candidates[0], reasons: ["only unsent quote"], score: 1 }],
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

  if (/\b(create|build|generate)\b/.test(text) || /\bnew\b.*\btemplate\b/.test(text)) {
    return "create" as const;
  }

  if (/\bmake me\b.*\btemplate\b/.test(text) || /\bmake us\b.*\btemplate\b/.test(text)) {
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

function looksLikeInquiryLookup(prompt: string) {
  const text = normalized(prompt);
  const searchTerm = inquirySearchTerm(prompt);

  if (!searchTerm) {
    return false;
  }

  if (
    text.includes("needs reply") ||
    text.includes("need reply") ||
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

export function looksLikeQuoteSendRequest(prompt: string) {
  const text = normalized(prompt);
  const hasQuoteTarget = /\b(quote|quotes|document|documents|invoice|invoices|pdf)\b/.test(
    text,
  );

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
  const hasQuoteTarget = /\b(quote|quotes|document|documents|invoice|invoices)\b/.test(
    text,
  );

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
  const hasQuoteTarget = /\b(quote|quotes|document|documents|invoice|invoices|pdf)\b/.test(
    text,
  );

  if (!hasQuoteTarget) {
    return false;
  }

  return (
    /\b(has|have|had|did|when|what|was|were|is|are)\b.*\b(sent|prepared|generated|changed|approved|approval|viewed|version|history)\b/.test(
      text,
    ) ||
    /\b(changed since|version history|document trail|pdf history|send history|customer approval|quote approval)\b/.test(
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

export async function resolveAssistantCommand({
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const text = normalized(prompt);

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

  if (looksLikeHelpRequest(prompt)) {
    return helpCommand({ prompt });
  }

  if (looksLikeEmailSyncRequest(prompt)) {
    return emailSyncCommand({ supabase, user, workspace });
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
    text.includes("lead") ||
    text.includes("needs reply") ||
    text.includes("work queue") ||
    text.includes("what should i do") ||
    text.includes("inbox")
  ) {
    return workQueueCommand({ supabase, workspace });
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
          status: conversation.status,
          workflowBucket: conversation.workflowBucket,
        })),
      ),
    },
    fallbackAnswer:
      top.length > 0
        ? `${top.length} conversations need attention. The first one is ${top[0].contactName ?? "an unknown contact"}: ${top[0].nextActionLabel}.`
        : "There are no conversations needing immediate attention in the current work queue.",
    intent: "work_queue",
    links: top.map(conversationToAssistantLink),
    title: "Work queue",
  };
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
        `/documents/${quote.id}`,
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

  return {
    blockers: readiness.blockers,
    customer: quoteCustomerLabel(quote),
    customerEmail: readiness.customerEmail,
    job: quoteJobLabel(quote),
    lineItems: quote.lineItemCount,
    linkedConversationId: quote.conversation?.id ?? null,
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
  const blocked = openQuotes.filter((quote) => !quoteSendReadiness(quote).ready);
  const top = ready.slice(0, 6);

  return {
    context: {
      blockedCount: blocked.length,
      blockedExamples: recordsContext(blocked.slice(0, 6).map(quoteReadyRecord)),
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
        `/documents/${quote.id}`,
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
          `/documents/${candidate.quote.id}`,
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
  const preparedEvent = history.find((event) => event.kind === "email_prepared");
  const generatedEvent = history.find((event) => event.kind === "pdf_generated");
  const approvedEvent = history.find((event) => event.kind === "customer_approved");
  const changesRequestedEvent = history.find(
    (event) => event.kind === "customer_changes_requested",
  );
  const viewedEvent = history.find((event) => event.kind === "customer_viewed");
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
  const changedLine = freshness.latest
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
      approvedEvent,
      changesRequestedEvent,
      preparedEvent,
      quote: quoteReadyRecord(profile.quoteDraft),
      sentEvent,
      viewedEvent,
    },
    fallbackAnswer: `${profile.quoteDraft.title}: ${statusLine} ${changedLine}`,
    intent: "quote_history",
    links: [
      rowLink(
        profile.quoteDraft.title,
        `/documents/${profile.quoteDraft.id}`,
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
    throw new Error(`Unable to load customer contact: ${contactResult.error.message}`);
  }

  if (leadResult.error) {
    throw new Error(`Unable to load linked lead: ${leadResult.error.message}`);
  }

  const contact = objectRecord(contactResult.data);
  const lead = objectRecord(leadResult.data);
  const metadata = objectRecord(quoteDraft.metadata);
  const customerEmail =
    textValue(contact.email) ?? textValue(metadata.customerEmail);

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
    throw new Error(`Unable to check pending quote emails: ${pending.error.message}`);
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
  const documentMetadata = quotePdfMetadata(artifact);
  const customerName =
    textValue(metadata.customerName) ??
    textValue(contact.name) ??
    textValue(contact.company);
  const jobLabel =
    textValue(metadata.jobType) ??
    textValue(lead.service_type) ??
    textValue(lead.title) ??
    quoteTitle;
  const subject = quoteSendSubject(quoteTitle);
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

  const nextMetadata = appendQuoteDocumentHistory(
    {
      ...metadata,
      lastGeneratedDocument: documentMetadata,
      preparedSendActionId: String(action.id),
      preparedSendAt: documentMetadata.generatedAt,
      quoteApprovalLinkId: approvalLink.approvalLink.id,
    },
    {
      actionId: String(action.id),
      actorType: "ai",
      contentHash: documentMetadata.contentHash,
      document: documentMetadata,
      kind: "email_prepared",
      occurredAt: documentMetadata.generatedAt,
      source: "assistant.quote_send",
    },
  );
  const { error: updateError } = await supabase
    .from("quote_drafts")
    .update({
      metadata: nextMetadata,
      status:
        String(quoteDraft.status) === "draft" ? "ready" : quoteDraft.status,
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
      status: String(quoteDraft.status) === "draft" ? "ready" : quoteDraft.status,
    },
    metadata: {
      assistantPrompt: prompt,
      conversationId,
      customerEmail,
      quoteApprovalLinkId: approvalLink.approvalLink.id,
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
          `/documents/${candidate.quote.id}`,
          `${quoteCustomerLabel(candidate.quote)} - ${titleCase(candidate.quote.status)}`,
        ),
      ),
      title: selection.kind === "ambiguous" ? "Choose a quote" : "Quote not found",
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
          `/documents/${selection.quote.id}`,
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
        rowLink(result.quoteTitle, `/documents/${result.quoteDraftId}`, "Quote draft"),
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
        rowLink(result.quoteTitle, `/inbox/${result.conversationId}`, "Review email"),
        rowLink(result.quoteTitle, `/documents/${result.quoteDraftId}`, "Quote draft"),
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
      rowLink(result.quoteTitle, `/inbox/${result.conversationId}`, "Review and send"),
      rowLink(result.quoteTitle, `/documents/${result.quoteDraftId}`, "Quote draft"),
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
    throw new Error(`Unable to load document templates: ${beforeError.message}`);
  }

  const beforeSettings = normalizeDocumentTemplateSettings(beforePolicy?.settings);

  if (intent === "update" && beforeSettings.customTemplates.length === 0) {
    return {
      context: {
        templateCount: 0,
      },
      fallbackAnswer:
        "There are no reusable templates to edit yet. Create a template first, then Kyro can revise it from chat or voice.",
      intent: "document_template_update",
      links: [rowLink("Create template", "/documents/templates/new", "Documents")],
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
          `/documents/templates/${encodeURIComponent(candidate.template.key)}`,
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
        `/documents/templates/${encodeURIComponent(template.key)}`,
        "Review template",
      ),
      rowLink(
        "Create draft",
        `/documents/new?templateKey=${encodeURIComponent(template.key)}`,
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
  const templates = quoteTemplateCatalog(documentTemplateSettings.customTemplates);
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
        rowLink("Create template", "/documents/templates/new", "Documents"),
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
          `/documents/new?templateKey=${encodeURIComponent(candidate.template.key)}`,
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
      rowLink(String(quoteDraft.title), `/documents/${quoteDraft.id}`, "Draft"),
      rowLink(
        "Print / PDF",
        `/documents/${quoteDraft.id}/print`,
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

async function overviewCommand({
  supabase,
  workspace,
}: Pick<
  CommandInput,
  "supabase" | "workspace"
>): Promise<AssistantCommandResult> {
  const [conversations, quotes, contacts] = await Promise.all([
    getConversationList(supabase, workspace.id),
    getQuoteDraftList(supabase, workspace.id),
    getContactList(supabase, workspace.id),
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
      workspaceName: workspace.name,
    },
    fallbackAnswer: `${workspace.name} has ${needsReply.length} conversations needing reply and ${readyQuotes.length} quote drafts ready.`,
    intent: "overview",
    links: [
      rowLink("Inbox", "/inbox", `${needsReply.length} need reply`),
      rowLink("Documents", "/documents", `${readyQuotes.length} ready quotes`),
      rowLink("Contacts", "/contacts", `${contacts.length} contacts`),
    ],
    title: "Workspace overview",
  };
}
