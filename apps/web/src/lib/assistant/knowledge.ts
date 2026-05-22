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
    href: "/settings?section=general",
    keywords: ["general", "timezone", "time zone", "workspace default"],
    label: "General settings",
    meta: "Timezone and workspace defaults",
  },
  {
    href: "/settings?section=integrations",
    keywords: ["email", "inbox", "gmail", "outlook", "quiet", "lookback", "fetch", "sync"],
    label: "Connected accounts",
    meta: "Inbound email and integrations",
  },
  {
    href: "/settings?section=voice",
    keywords: ["voice", "pronunciation", "vocabulary", "speech"],
    label: "Voice assistant",
    meta: "Voice and pronunciation settings",
  },
  {
    href: "/settings?section=usage",
    keywords: ["usage", "cost", "billing", "metering"],
    label: "Billing and metering",
    meta: "Usage, cost, and metering",
  },
];

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9/\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function queryTokens(prompt: string) {
  const stopWords = new Set([
    "about",
    "does",
    "help",
    "how",
    "mean",
    "me",
    "please",
    "setting",
    "settings",
    "the",
    "this",
    "what",
    "whats",
    "with",
    "work",
    "works",
  ]);

  return normalized(prompt)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
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
) {
  const haystack = normalized(`${section.heading} ${section.content}`);

  return tokens.reduce(
    (score, token) => score + (haystack.includes(token) ? 1 : 0),
    0,
  );
}

function truncateSnippet(value: string) {
  const normalizedSnippet = value.replace(/\s+/g, " ").trim();

  return normalizedSnippet.length > 1400
    ? `${normalizedSnippet.slice(0, 1397)}...`
    : normalizedSnippet;
}

function relevantLinks(prompt: string) {
  const text = normalized(prompt);
  const links = HELP_LINKS.filter((link) =>
    link.keywords.some((keyword) => text.includes(keyword)),
  );

  return (links.length > 0 ? links : HELP_LINKS.slice(0, 2)).map((link) => ({
    href: link.href,
    label: link.label,
    meta: link.meta,
  }));
}

export async function getAssistantKnowledge(
  prompt: string,
): Promise<AssistantKnowledgeResult> {
  const tokens = queryTokens(prompt);
  const snippets: AssistantKnowledgeResult["snippets"] = [];

  for (const source of SOURCES) {
    const sections = splitSections(source.content);
    const ranked = sections
      .map((section) => ({
        ...section,
        score: scoreSection(section, tokens),
      }))
      .filter((section) => section.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, source.audience === "user" ? 4 : 2);

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
