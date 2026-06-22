import type { AssistantLink, AssistantUiBlock } from "./types";

export function linkCardsBlock(title: string, links: AssistantLink[]): AssistantUiBlock[] {
  return links.length > 0
    ? [
        {
          links,
          title,
          type: "link_cards",
        },
      ]
    : [];
}

export function memoryNoticeBlock(content: string): AssistantUiBlock {
  return {
    content,
    title: "Memory saved",
    type: "memory_notice",
  };
}

export function generatedImageBlock(
  title: string,
  images: Extract<AssistantUiBlock, { type: "generated_image" }>["images"],
): AssistantUiBlock[] {
  return images.length > 0
    ? [
        {
          images,
          title,
          type: "generated_image",
        },
      ]
    : [];
}

export function linksFromBlocks(blocks: AssistantUiBlock[]) {
  return blocks.flatMap((block) => {
    if (block.type === "link_cards") {
      return block.links;
    }

    if (block.type === "generated_image") {
      return block.images.map((image) => ({
        href: image.href,
        label: image.filename,
        meta: image.meta ?? image.size,
      }));
    }

    return [];
  });
}
