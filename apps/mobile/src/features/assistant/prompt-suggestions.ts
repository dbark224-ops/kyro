import type { AssistantThreadMessage } from "@/lib/mobile-api-types";

export const MOBILE_PROMPT_SUGGESTION_COUNT = 2;

const DEFAULT_ASSISTANT_PROMPT_SUGGESTIONS = [
  "Show me leads needing reply",
  "What quote drafts are ready?",
  "Create a bathroom quote draft",
  "Summarise my busiest customer",
  "Generate a project concept image",
  "Show recent inbound email decisions",
  "Show usage and costs",
  "Help me update Kyro settings"
];

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripAttachmentContext(content: string) {
  return content
    .split(/\n\n(?:Attached file context|Stored Kyro attachment context):/i)[0]
    .trim();
}

function normalizePromptSuggestion(value: unknown) {
  const text = textValue(value);

  if (!text) {
    return null;
  }

  return text
    .replace(/^[-*+\d.)\s]+/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/g, "");
}

function hasUnsafePromptSpecifics(value: string) {
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /\b(?:\+?\d[\d\s().-]{7,}\d)\b/.test(value) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(
      value
    ) ||
    /\b(?:file|kyro file|source file)\s+id\b/i.test(value) ||
    /\b(?:about|for|from|with)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/.test(
      value
    ) ||
    /\bthe\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\s+(?:inquiry|customer|contact|lead|job|quote)\b/.test(
      value
    )
  );
}

function normalizePromptSuggestions(values: unknown[]) {
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const value of values) {
    const suggestion = normalizePromptSuggestion(value);

    if (
      !suggestion ||
      suggestion.length < 8 ||
      suggestion.length > 88 ||
      hasUnsafePromptSpecifics(suggestion)
    ) {
      continue;
    }

    const key = suggestion.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    suggestions.push(suggestion);
  }

  return suggestions;
}

function deterministicSuggestionsFromTextSamples(samples: string[]) {
  const scores = new Map<string, number>();

  const add = (suggestion: string, weight = 1) => {
    scores.set(suggestion, (scores.get(suggestion) ?? 0) + weight);
  };

  for (const sample of samples) {
    const text = sample.toLowerCase();

    if (/\b(lead|leads|reply|approval|inbox|work queue)\b/.test(text)) {
      add("Show me leads needing reply");
    }

    if (/\b(quote|quotes|draft|ready|send)\b/.test(text)) {
      add("What quote drafts are ready?");
    }

    if (
      /\b(create|make|draft|generate)\b.*\b(quote|invoice|document)\b/.test(
        text
      )
    ) {
      add("Create a quote draft");
    }

    if (/\b(image|render|photo|picture|visual|mockup|concept)\b/.test(text)) {
      add("Generate a project concept image");
    }

    if (/\b(customer|client|contact|busiest|summari[sz]e)\b/.test(text)) {
      add("Summarise my busiest customer");
    }

    if (/\b(email|inbound|sync|skipped|sender)\b/.test(text)) {
      add("Show recent inbound email decisions");
    }

    if (/\b(usage|cost|billing|margin|charge)\b/.test(text)) {
      add("Show usage and costs");
    }

    if (/\b(setting|settings|voice|signature|prompt)\b/.test(text)) {
      add("Help me update Kyro settings");
    }
  }

  return normalizePromptSuggestions([
    ...[...scores.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([suggestion]) => suggestion),
    ...DEFAULT_ASSISTANT_PROMPT_SUGGESTIONS
  ]);
}

function userPromptSamples(messages: AssistantThreadMessage[]) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => stripAttachmentContext(message.content))
    .filter((content) => content.length > 0 && content.length <= 500)
    .slice(-48);
}

export function mobileAssistantPromptSuggestions({
  messages,
  remoteSuggestions
}: {
  messages: AssistantThreadMessage[];
  remoteSuggestions?: string[] | null;
}) {
  const remote = normalizePromptSuggestions(remoteSuggestions ?? []);

  if (remote.length > 0) {
    return remote.slice(0, MOBILE_PROMPT_SUGGESTION_COUNT);
  }

  const local = deterministicSuggestionsFromTextSamples(userPromptSamples(messages));

  return normalizePromptSuggestions([
    ...local,
    ...DEFAULT_ASSISTANT_PROMPT_SUGGESTIONS
  ]).slice(0, MOBILE_PROMPT_SUGGESTION_COUNT);
}
