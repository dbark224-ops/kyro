import {
  ASSISTANT_HELP_MANUAL,
  CURRENT_ARCHITECTURE_ASSISTANT_SUMMARY,
} from "./knowledge-corpus";
import type { AssistantLink } from "./types";

type KnowledgeSource = {
  audience: "internal" | "user";
  content: string;
  title: string;
};

export type AssistantKnowledgeResult = {
  links: AssistantLink[];
  snippets: Array<{
    audience: "internal" | "user";
    content: string;
    heading: string;
    source: string;
  }>;
};

const SOURCES: KnowledgeSource[] = [
  {
    audience: "user",
    content: ASSISTANT_HELP_MANUAL,
    title: "Kyro Assistant Help Manual",
  },
  {
    audience: "internal",
    content: CURRENT_ARCHITECTURE_ASSISTANT_SUMMARY,
    title: "Current Architecture",
  },
];

const HELP_LINKS: Array<AssistantLink & { keywords: string[] }> = [
  {
    href: "/assistant",
    keywords: [
      "assistant",
      "chat",
      "help",
      "manual",
      "guide",
      "what can you do",
      "how to use",
    ],
    label: "Assistant",
    meta: "Ask Kyro about work, settings, and help",
  },
  {
    href: "/voice",
    keywords: ["voice", "realtime", "microphone", "talk", "speech", "audio"],
    label: "Voice",
    meta: "Live voice assistant",
  },
  {
    href: "/inbox",
    keywords: [
      "inbox",
      "reply",
      "needs reply",
      "work queue",
      "filtered",
      "skipped",
      "email popup",
    ],
    label: "Inbox",
    meta: "Business conversations and skipped email review",
  },
  {
    href: "/contacts",
    keywords: ["crm", "contact", "customer", "lead", "supplier", "builder"],
    label: "CRM",
    meta: "Contacts, leads, and customer history",
  },
  {
    href: "/documents",
    keywords: ["document", "documents", "quote", "draft", "template"],
    label: "Documents",
    meta: "Quote drafts and document work",
  },
  {
    href: "/",
    keywords: ["log", "activity", "audit", "timeline", "events"],
    label: "Log",
    meta: "Workspace activity timeline",
  },
  {
    href: "/settings?section=general",
    keywords: ["general", "timezone", "time zone", "workspace default"],
    label: "General settings",
    meta: "Timezone and workspace defaults",
  },
  {
    href: "/settings?section=communication",
    keywords: ["communication", "signature", "tone", "approval", "channels"],
    label: "Communication settings",
    meta: "Reply tone, channels, approvals, and signatures",
  },
  {
    href: "/settings?section=integrations",
    keywords: [
      "email",
      "inbox",
      "gmail",
      "outlook",
      "quiet",
      "quiet hours",
      "lookback",
      "fetch",
      "fetch cap",
      "sync",
      "poll",
      "polling",
      "reconnect",
    ],
    label: "Connected accounts",
    meta: "Inbound email and integrations",
  },
  {
    href: "/settings?section=voice",
    keywords: ["voice", "pronunciation", "pronounciation", "vocabulary", "speech"],
    label: "Voice assistant",
    meta: "Voice and pronunciation settings",
  },
  {
    href: "/settings?section=usage",
    keywords: ["usage", "cost", "billing", "metering"],
    label: "Billing and metering",
    meta: "Usage, cost, and metering",
  },
  {
    href: "/developer/outbox",
    keywords: [
      "outbox",
      "outbound email",
      "failed send",
      "failed email",
      "email failed",
      "send failed",
      "retry",
      "retry email",
      "retry delivery",
      "delivery failed",
      "outbound delivery",
      "developer outbox",
    ],
    label: "Outbox operations",
    meta: "Inspect, retry, or dismiss outbound delivery rows",
  },
];

const SECTION_BOOSTS: Array<{
  heading: string;
  keywords: string[];
  weight?: number;
}> = [
  {
    heading: "Lookback And Fetch Cap",
    keywords: ["lookback", "fetch cap", "max messages", "missed mail"],
    weight: 10,
  },
  {
    heading: "Inbound Email Sync",
    keywords: ["email sync", "inbound email", "gmail", "outlook", "polling"],
    weight: 5,
  },
  {
    heading: "Inbound Email Architecture",
    keywords: ["email sync", "inbound email", "gmail", "outlook", "polling"],
    weight: 8,
  },
  {
    heading: "Assistant Architecture",
    keywords: ["assistant", "voice", "tool", "manual", "settings"],
    weight: 8,
  },
  {
    heading: "Quiet Hours",
    keywords: ["quiet hours", "overnight", "active hours"],
    weight: 10,
  },
  {
    heading: "Filtered-Out Emails",
    keywords: ["filtered out", "skipped email", "skipped mail", "newsletter", "sender", "promote"],
    weight: 10,
  },
  {
    heading: "Outbound Delivery And Outbox",
    keywords: [
      "outbox",
      "outbound email",
      "failed send",
      "failed email",
      "email failed",
      "send failed",
      "retry",
      "retry email",
      "delivery failed",
      "outbound delivery",
      "dismiss failed",
    ],
    weight: 12,
  },
  {
    heading: "Developer Screen",
    keywords: ["developer", "outbox operations", "retry", "dismiss", "delivery"],
    weight: 8,
  },
  {
    heading: "Pronunciation Vocabulary",
    keywords: ["pronunciation", "pronounciation", "vocabulary", "aliases"],
    weight: 10,
  },
  {
    heading: "Safe Settings Kyro Can Change",
    keywords: ["what can you change", "safe settings", "settings can you change"],
    weight: 8,
  },
  {
    heading: "What Kyro Can Do",
    keywords: ["what can you do", "what can kyro do", "able to do"],
    weight: 10,
  },
];

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9/\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function queryTokens(prompt: string) {
  const stopWords = new Set([
    "about",
    "and",
    "change",
    "could",
    "does",
    "help",
    "can",
    "how",
    "mean",
    "me",
    "please",
    "should",
    "setting",
    "settings",
    "the",
    "this",
    "what",
    "whats",
    "with",
    "work",
    "works",
    "would",
    "you",
  ]);

  return normalized(prompt)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function textIncludesKeyword(text: string, keyword: string) {
  const normalizedKeyword = normalized(keyword);

  if (!normalizedKeyword) {
    return false;
  }

  if (normalizedKeyword.includes(" ")) {
    return text.includes(normalizedKeyword);
  }

  return new RegExp(`(^|\\s)${escapeRegExp(normalizedKeyword)}($|\\s)`).test(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSections(markdown: string) {
  const sections: Array<{ heading: string; content: string }> = [];
  const lines = markdown.split(/\r?\n/);
  let heading = "Overview";
  let content: string[] = [];

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+)$/);

    if (match) {
      if (content.join("\n").trim()) {
        sections.push({ content: content.join("\n").trim(), heading });
      }

      heading = match[1].trim();
      content = [];
    } else {
      content.push(line);
    }
  }

  if (content.join("\n").trim()) {
    sections.push({ content: content.join("\n").trim(), heading });
  }

  return sections;
}

function scoreSection(
  section: { content: string; heading: string },
  tokens: string[],
  promptText: string,
) {
  const haystack = normalized(`${section.heading} ${section.content}`);
  const boost = SECTION_BOOSTS.reduce(
    (total, rule) =>
      rule.heading === section.heading &&
      rule.keywords.some((keyword) => textIncludesKeyword(promptText, keyword))
        ? total + (rule.weight ?? 5)
        : total,
    0,
  );

  return tokens.reduce(
    (score, token) => score + (haystack.includes(token) ? 1 : 0),
    boost,
  ) + (textIncludesKeyword(promptText, normalized(section.heading)) ? 3 : 0);
}

function truncateSnippet(value: string) {
  const normalizedSnippet = value.replace(/\s+/g, " ").trim();

  return normalizedSnippet.length > 1800
    ? `${normalizedSnippet.slice(0, 1797)}...`
    : normalizedSnippet;
}

function relevantLinks(prompt: string) {
  const text = normalized(prompt);
  const links = HELP_LINKS.map((link) => ({
    ...link,
    score: link.keywords.filter((keyword) => textIncludesKeyword(text, keyword))
      .length,
  }))
    .filter((link) => link.score > 0)
    .sort((left, right) => right.score - left.score);

  return (links.length > 0 ? links : HELP_LINKS.slice(0, 2)).map((link) => ({
    href: link.href,
    label: link.label,
    meta: link.meta,
  }));
}

function wantsInternalContext(promptText: string) {
  return [
    "architecture",
    "architectural",
    "backend",
    "code",
    "database",
    "implementation",
    "implemented",
    "technical",
    "under the hood",
  ].some((keyword) => textIncludesKeyword(promptText, keyword));
}

export async function getAssistantKnowledge(
  prompt: string,
): Promise<AssistantKnowledgeResult> {
  const promptText = normalized(prompt);
  const tokens = queryTokens(prompt);
  const snippets: AssistantKnowledgeResult["snippets"] = [];

  for (const source of SOURCES) {
    if (source.audience === "internal" && !wantsInternalContext(promptText)) {
      continue;
    }

    const sections = splitSections(source.content);
    const ranked = sections
      .map((section) => ({
        ...section,
        score: scoreSection(section, tokens, promptText),
      }))
      .filter(
        (section) => section.score > (tokens.length > 2 ? 3 : tokens.length > 1 ? 1 : 0),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, source.audience === "user" ? 3 : 1);

    for (const section of ranked) {
      snippets.push({
        audience: source.audience,
        content: truncateSnippet(section.content),
        heading: section.heading,
        source: source.title,
      });
    }
  }

  return {
    links: relevantLinks(prompt),
    snippets:
      snippets.length > 0
        ? snippets
        : [
            {
              audience: "user",
              content:
                "Kyro is a trades-focused CRM and operations assistant. It can help with inbound enquiries, contacts, quote drafts, connected email, voice, pronunciation, and safe workspace settings.",
              heading: "What Kyro Is",
              source: "Kyro Assistant Help Manual",
            },
          ],
  };
}
