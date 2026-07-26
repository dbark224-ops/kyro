import { objectRecord, textValue } from "@kyro/core";
import { normalized } from "./prompt-text";
import type { AssistantRecentMessage, AssistantUiBlock } from "./types";

/**
 * Finding the image the user is talking about.
 *
 * Lifted verbatim out of commands.ts. "Make it darker" has to resolve against
 * the last image the assistant generated, which means scanning recent messages
 * and their UI blocks. Pure inspection of what was already said; generating the
 * new image stayed behind.
 */

export type RecentGeneratedImage = Extract<
  AssistantUiBlock,
  { type: "generated_image" }
>["images"][number];

export function latestGeneratedImageFromRecentMessages(
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

export function generatedImageFromValue(value: unknown): RecentGeneratedImage | null {
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

export function latestGeneratedImageFromBlocks(blocksValue: unknown) {
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

export function looksLikeImageEditFollowUpText(prompt: string) {
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

export function looksLikeImageFollowUpRequest(
  prompt: string,
  recentMessages: readonly AssistantRecentMessage[] = [],
) {
  return (
    Boolean(latestGeneratedImageFromRecentMessages(recentMessages)) &&
    looksLikeImageEditFollowUpText(prompt)
  );
}
