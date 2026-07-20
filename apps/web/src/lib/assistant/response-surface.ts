import type { AssistantTurnResult } from "./types";

export type AssistantResponseSurface = "interactive" | "text_only";

const TEXT_ONLY_INPUT_SOURCES = new Set([
  "sms",
  "whatsapp",
  "whatsapp_sandbox",
]);
const INVISIBLE_UI_REFERENCE =
  /(?:\b(?:card|box|panel|preview|button|link|item|dynamic event)\b.{0,28}\b(?:below|above|shown|displayed|screen)\b)|(?:\b(?:below|above)\b.{0,28}\b(?:card|box|panel|preview|button|link|item)\b)/i;

function plainTextContent(value: string) {
  return value
    .replace(/\bopen the inquiry below\b/gi, "Open Kyro's Inbox")
    .replace(
      /\b(?:open|click|use|review)\s+(?:the\s+)?(?:card|box|panel|preview|button|link|item)\s+(?:below|above)\b/gi,
      "open Kyro",
    )
    .replace(
      /\b(?:the\s+)?(?:card|box|panel|preview|button|link|item|dynamic event)\s+(?:below|above)\b/gi,
      "Kyro",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function assistantResponseSurface(
  inputSource: string | null | undefined,
): AssistantResponseSurface {
  return inputSource && TEXT_ONLY_INPUT_SOURCES.has(inputSource)
    ? "text_only"
    : "interactive";
}

export function projectAssistantResultForSurface(
  result: AssistantTurnResult,
  inputSource: string | null | undefined,
  fallbackContent?: string,
): AssistantTurnResult {
  if (assistantResponseSurface(inputSource) !== "text_only") {
    return result;
  }

  const content = INVISIBLE_UI_REFERENCE.test(result.content)
    ? fallbackContent?.trim() || result.content
    : result.content;

  return {
    ...result,
    content: plainTextContent(content),
    contextLinks: result.contextLinks ?? result.links,
    links: [],
    uiBlocks: [],
  };
}
