import type { AssistantLink, AssistantUiBlock } from "./types";

export function linkCardsBlock(
  title: string,
  links: AssistantLink[],
): AssistantUiBlock[] {
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

export function memorySuggestionBlock({
  content,
  memoryId,
}: {
  content: string;
  memoryId: string;
}): AssistantUiBlock {
  return {
    content,
    memoryId,
    status: "pending_approval",
    title: "Suggested memory",
    type: "memory_suggestion",
  };
}

export function summaryCardsBlock(
  title: string,
  cards: Extract<AssistantUiBlock, { type: "summary_cards" }>["cards"],
): AssistantUiBlock[] {
  return cards.length > 0
    ? [
        {
          cards,
          title,
          type: "summary_cards",
        },
      ]
    : [];
}

export function timelineBlock(
  title: string,
  items: Extract<AssistantUiBlock, { type: "timeline" }>["items"],
): AssistantUiBlock[] {
  return items.length > 0
    ? [
        {
          items,
          title,
          type: "timeline",
        },
      ]
    : [];
}

export function approvalQueueBlock(
  title: string,
  items: Extract<AssistantUiBlock, { type: "approval_queue" }>["items"],
): AssistantUiBlock[] {
  return items.length > 0
    ? [
        {
          items,
          title,
          type: "approval_queue",
        },
      ]
    : [];
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

    if (block.type === "summary_cards") {
      return block.cards
        .filter((card) => card.href)
        .map((card) => ({
          href: card.href as string,
          label: card.label,
          meta: card.detail ?? card.value,
        }));
    }

    if (block.type === "timeline") {
      return block.items
        .filter((item) => item.href)
        .map((item) => ({
          href: item.href as string,
          label: item.label,
          meta: item.detail ?? item.at ?? undefined,
        }));
    }

    if (block.type === "approval_queue") {
      return block.items
        .filter((item) => item.href)
        .map((item) => ({
          href: item.href as string,
          label: item.label,
          meta: item.detail ?? item.status,
        }));
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
