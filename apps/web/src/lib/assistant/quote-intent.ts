import { textValue } from "@kyro/core";
import type { QuoteTemplate } from "../documents/templates";
import type { QuoteDraftListItem } from "../crm/queries";
import { meaningfulTokens, normalized } from "./prompt-text";

/**
 * Working out which quote, template or document the user meant.
 *
 * Lifted verbatim out of commands.ts. This is the matching layer -- scoring a
 * prompt against saved templates and quote drafts, and recognising a send,
 * history or ready-list request. It is pure text scoring with no database
 * access; the commands that load and send those documents stayed behind.
 */

export function quoteSendSearchTerm(prompt: string) {
  return normalized(prompt)
    .replace(
      /\b(approval|approve|approved|send|sent|sending|email|e mail|mail|message|reply|draft|prepare|prepared|ready|review|attach|attached|attachment|pdf|quote|quotes|document|documents|invoice|invoices|this|that|the|a|an|to|for|from|customer|client|please|can|you|we|did|has|have|had|when|what|was|were|is|are|changed|since|history|version|kyro|cairo|kara|cara)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export const TEMPLATE_MATCH_STOP_WORDS = new Set([
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

export function matchTokens(value: string) {
  return meaningfulTokens(value).filter(
    (token) => !TEMPLATE_MATCH_STOP_WORDS.has(token),
  );
}

export function scoreTemplateMatch(prompt: string, template: QuoteTemplate) {
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

export type QuoteDraftSelection =
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

export function customerEmailForQuote(quote: QuoteDraftListItem) {
  return quote.contact?.email ?? textValue(quote.metadata.customerEmail);
}

export function quoteCustomerLabel(quote: QuoteDraftListItem) {
  return (
    quote.contact?.name ??
    quote.contact?.company ??
    textValue(quote.metadata.customerName) ??
    textValue(quote.metadata.customerCompany) ??
    "No customer yet"
  );
}

export function quoteIsSendableStatus(quote: QuoteDraftListItem) {
  return !["approved", "sent", "archived"].includes(normalized(quote.status));
}

export function quoteSendHaystack(quote: QuoteDraftListItem) {
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

export function scoreQuoteSendMatch(
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
