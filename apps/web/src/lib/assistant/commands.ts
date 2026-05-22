import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  getContactList,
  getContactProfile,
  getConversationList,
  getQuoteDraftList,
  type ConversationListItem,
} from "../crm/queries";
import { getQuoteTemplate } from "../documents/templates";
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

function titleCase(value: string) {
  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function inferTemplateKey(prompt: string) {
  const text = normalized(prompt);

  if (text.includes("bathroom") || text.includes("renovation")) {
    return "bathroom_renovation";
  }

  if (text.includes("plumb") || text.includes("leak") || text.includes("tap")) {
    return "plumbing_repair";
  }

  return "general_service_quote";
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

function looksLikeHelpRequest(prompt: string) {
  const text = normalized(prompt);
  const helpIntent =
    text.includes("help") ||
    text.includes("manual") ||
    text.includes("guide") ||
    text.includes("how do i") ||
    text.includes("how does") ||
    text.includes("what does") ||
    text.includes("explain");
  const kyroTopic =
    text.includes("kyro") ||
    text.includes("setting") ||
    text.includes("quiet hours") ||
    text.includes("lookback") ||
    text.includes("fetch cap") ||
    text.includes("inbound email") ||
    text.includes("gmail") ||
    text.includes("outlook") ||
    text.includes("voice") ||
    text.includes("pronunciation") ||
    text.includes("usage") ||
    text.includes("billing") ||
    text.includes("timezone") ||
    text.includes("time zone");

  return helpIntent && kyroTopic;
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

  if (looksLikeSettingsUpdatePrompt(prompt)) {
    return updateAssistantEditableSettings({
      prompt,
      supabase,
      user,
      workspace,
    });
  }

  if (looksLikeEmailSyncRequest(prompt)) {
    return emailSyncCommand({ supabase, user, workspace });
  }

  if (looksLikeHelpRequest(prompt)) {
    return helpCommand({ prompt });
  }

  if (/\b(create|make|start|generate)\b/.test(text) && text.includes("quote")) {
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
  const statusFilter = ["draft", "ready", "sent", "archived"].find((status) =>
    text.includes(status),
  );
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

async function createQuoteDraftCommand({
  prompt,
  supabase,
  user,
  workspace,
}: CommandInput): Promise<AssistantCommandResult> {
  const template = getQuoteTemplate(inferTemplateKey(prompt));
  const { data: quoteDraft, error } = await supabase
    .from("quote_drafts")
    .insert({
      workspace_id: workspace.id,
      line_items: template.lineItems,
      metadata: {
        assistantPrompt: prompt,
        customerCompany: null,
        customerEmail: null,
        customerName: null,
        customerPhone: null,
        dryRun: true,
        jobAddress: null,
        jobType: template.label,
        preferredTime: null,
        requestedByUserId: user.id,
        source: "assistant.command",
        templateKey: template.key,
      },
      notes: template.notes,
      status: "draft",
      title: template.defaultTitle,
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
