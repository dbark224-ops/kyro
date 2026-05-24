import type { AssistantLink } from "./types";
import {
  estimateTokens,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  type OpenAiTokenUsage,
} from "../usage/openai";

type WebSearchInput = {
  apiKey?: string;
  maxOutputTokens?: number;
  model?: string;
  prompt: string;
};

type WebSearchResult = {
  fallbackReason?: string;
  inputTokens: number;
  outputTokens: number;
  providerUsageId?: string;
  sources: AssistantLink[];
  text: string;
  tokenUsage?: OpenAiTokenUsage;
  webSearchUsed: boolean;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isEnabledValue(value: string) {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function validWebUrl(value: string) {
  try {
    const url = new URL(value);

    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function sourceTitle(url: URL, title: string | null) {
  return title ?? url.hostname.replace(/^www\./, "");
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
      const record = objectRecord(part);
      const text = textValue(record.text);

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

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);
  const message = textValue(error.message);

  return message ?? "OpenAI web search request failed.";
}

function addSourceLink(links: AssistantLink[], value: unknown) {
  const record = objectRecord(value);
  const rawUrl = textValue(record.url) ?? textValue(record.uri);

  if (!rawUrl) {
    return;
  }

  const url = validWebUrl(rawUrl);

  if (!url) {
    return;
  }

  links.push({
    href: url.toString(),
    label: sourceTitle(url, textValue(record.title)),
    meta: url.hostname.replace(/^www\./, ""),
  });
}

function collectWebSources(value: unknown, links: AssistantLink[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectWebSources(item, links));
    return;
  }

  const record = objectRecord(value);

  if (!Object.keys(record).length) {
    return;
  }

  if (textValue(record.type) === "url_citation" || textValue(record.url)) {
    addSourceLink(links, record);
  }

  const action = objectRecord(record.action);
  const actionSources = action.sources;

  if (Array.isArray(actionSources)) {
    actionSources.forEach((source) => addSourceLink(links, source));
  }

  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectWebSources(child, links);
    }
  }
}

function responseUsedWebSearch(payload: unknown) {
  const output = Array.isArray(objectRecord(payload).output)
    ? (objectRecord(payload).output as unknown[])
    : [];

  return output.some((item) => textValue(objectRecord(item).type) === "web_search_call");
}

export function assistantWebSearchEnabled() {
  const value =
    envValue("ASSISTANT_WEB_SEARCH_ENABLED") ||
    envValue("OPENAI_WEB_SEARCH_ENABLED");

  return isEnabledValue(value);
}

export function openAiWebSearchTool() {
  return {
    type: "web_search",
  };
}

export function extractWebSearchSources(payload: unknown) {
  const links: AssistantLink[] = [];

  collectWebSources(payload, links);

  return dedupeAssistantLinks(links).slice(0, 6);
}

export function hasWebSearchCall(payload: unknown) {
  return responseUsedWebSearch(payload);
}

export function dedupeAssistantLinks(links: AssistantLink[]) {
  const seen = new Set<string>();

  return links.filter((link) => {
    const href = textValue(link.href);

    if (!href || seen.has(href)) {
      return false;
    }

    seen.add(href);

    return true;
  });
}

export function normalizeAssistantLinks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeAssistantLinks(
    value.flatMap((item) => {
      const record = objectRecord(item);
      const href = textValue(record.href);
      const label = textValue(record.label);

      if (!href || !label || !validWebUrl(href)) {
        return [];
      }

      return [
        {
          href,
          label,
          meta: textValue(record.meta) ?? undefined,
        },
      ];
    }),
  ).slice(0, 6);
}

export async function runAssistantWebSearch({
  apiKey = envValue("OPENAI_API_KEY"),
  maxOutputTokens,
  model =
    envValue("ASSISTANT_WEB_SEARCH_MODEL") ||
    envValue("OPENAI_BALANCED_MODEL") ||
    envValue("ASSISTANT_MODEL") ||
    "gpt-4.1-mini",
  prompt,
}: WebSearchInput): Promise<WebSearchResult> {
  const trimmedPrompt = prompt.trim();
  const outputTokenLimit = maxOutputTokens ?? 520;

  if (!apiKey) {
    return {
      fallbackReason: "OPENAI_API_KEY is not configured for web search.",
      inputTokens: estimateTokens(trimmedPrompt),
      outputTokens: 0,
      sources: [],
      text: "Web search is not configured yet.",
      webSearchUsed: false,
    };
  }

  if (!assistantWebSearchEnabled()) {
    return {
      fallbackReason: "Assistant web search is disabled.",
      inputTokens: estimateTokens(trimmedPrompt),
      outputTokens: 0,
      sources: [],
      text: "Web search is disabled for this assistant.",
      webSearchUsed: false,
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: trimmedPrompt,
        instructions:
          "You are Kyro's web search tool. Search the public web when needed, answer concisely, and rely only on sourced public information. Do not claim access to Kyro CRM data, user accounts, private documents, or actions. Include source-backed wording and avoid unsupported certainty.",
        max_output_tokens: outputTokenLimit,
        model,
        tools: [openAiWebSearchTool()],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(providerErrorMessage(payload));
    }

    const text = responseOutputText(payload);

    if (!text) {
      throw new Error("OpenAI returned an empty web search response.");
    }

    return {
      ...responseUsage(payload, trimmedPrompt, text),
      sources: extractWebSearchSources(payload),
      text,
      webSearchUsed: hasWebSearchCall(payload),
    };
  } catch (error) {
    const fallbackReason =
      error instanceof Error ? error.message : "OpenAI web search request failed.";

    return {
      fallbackReason,
      inputTokens: estimateTokens(trimmedPrompt),
      outputTokens: estimateTokens(fallbackReason),
      sources: [],
      text: "I could not complete the web search just now.",
      webSearchUsed: false,
    };
  }
}
