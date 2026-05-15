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

export function linksFromBlocks(blocks: AssistantUiBlock[]) {
  return blocks.flatMap((block) => (block.type === "link_cards" ? block.links : []));
}
