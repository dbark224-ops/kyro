"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type {
  AssistantLink,
  AssistantThreadMessage,
  AssistantUiBlock,
} from "../../lib/assistant/types";

function toneClass(tone?: string) {
  return tone ? ` tone-${tone}` : "";
}

function CompactBlock({
  children,
  title,
}: Readonly<{
  children: ReactNode;
  title: string;
}>) {
  return (
    <section className="assistant-compact-block">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function CompactRow({
  children,
  href,
  tone,
}: Readonly<{
  children: ReactNode;
  href?: string;
  tone?: string;
}>) {
  const className = `assistant-compact-row${toneClass(tone)}`;

  if (href) {
    return (
      <Link className={className} href={href}>
        {children}
      </Link>
    );
  }

  return <div className={className}>{children}</div>;
}

function CompactRowBody({
  label,
  meta,
  value,
}: Readonly<{
  label: string;
  meta?: string | null;
  value?: string | null;
}>) {
  return (
    <>
      <span className="assistant-compact-main">
        <strong className="assistant-compact-label">{label}</strong>
        {value ? <strong className="assistant-compact-value">{value}</strong> : null}
      </span>
      {meta ? <span className="assistant-compact-meta">{meta}</span> : null}
    </>
  );
}

function MoreCount({
  maxItems,
  total,
}: Readonly<{
  maxItems: number;
  total: number;
}>) {
  if (total <= maxItems) {
    return null;
  }

  return (
    <span className="assistant-compact-more">+ {total - maxItems} more</span>
  );
}

function linksAsBlock(links: AssistantLink[]): AssistantUiBlock {
  return {
    links,
    title: "Related",
    type: "link_cards",
  };
}

function blockFallbackText(block: AssistantUiBlock) {
  if ("content" in block && typeof block.content === "string") {
    return block.content;
  }

  if ("description" in block && typeof block.description === "string") {
    return block.description;
  }

  return null;
}

function renderBlock(block: AssistantUiBlock, maxItems: number, key: string) {
  if (block.type === "link_cards") {
    return (
      <CompactBlock key={key} title={block.title}>
        <div className="assistant-compact-list">
          {block.links.slice(0, maxItems).map((link) => (
            <CompactRow href={link.href} key={`${link.href}-${link.label}`}>
              <CompactRowBody label={link.label} meta={link.meta} />
            </CompactRow>
          ))}
          <MoreCount maxItems={maxItems} total={block.links.length} />
        </div>
      </CompactBlock>
    );
  }

  if (block.type === "summary_cards") {
    return (
      <CompactBlock key={key} title={block.title}>
        <div className="assistant-compact-list">
          {block.cards.slice(0, maxItems).map((card) => (
            <CompactRow
              href={card.href}
              key={`${card.href ?? card.label}-${card.value}`}
              tone={card.tone}
            >
              <CompactRowBody
                label={card.label}
                meta={card.detail}
                value={card.value}
              />
            </CompactRow>
          ))}
          <MoreCount maxItems={maxItems} total={block.cards.length} />
        </div>
      </CompactBlock>
    );
  }

  if (block.type === "timeline") {
    return (
      <CompactBlock key={key} title={block.title}>
        <div className="assistant-compact-list">
          {block.items.slice(0, maxItems).map((item) => (
            <CompactRow
              href={item.href}
              key={`${item.href ?? item.label}-${item.at ?? ""}`}
              tone={item.tone}
            >
              <CompactRowBody
                label={item.label}
                meta={item.detail}
                value={item.at}
              />
            </CompactRow>
          ))}
          <MoreCount maxItems={maxItems} total={block.items.length} />
        </div>
      </CompactBlock>
    );
  }

  if (block.type === "approval_queue") {
    return (
      <CompactBlock key={key} title={block.title}>
        <div className="assistant-compact-list">
          {block.items.slice(0, maxItems).map((item) => (
            <CompactRow href={item.href} key={item.id} tone="pink">
              <CompactRowBody
                label={item.label}
                meta={item.detail ?? item.actionLabel}
                value={item.status}
              />
            </CompactRow>
          ))}
          <MoreCount maxItems={maxItems} total={block.items.length} />
        </div>
      </CompactBlock>
    );
  }

  if (block.type === "generated_image") {
    return (
      <CompactBlock key={key} title={block.title}>
        <div className="assistant-compact-generated-images">
          {block.images.slice(0, maxItems).map((image) => (
            <Link
              className="assistant-compact-image-card"
              href={image.href}
              key={image.fileId}
            >
              <img alt={image.alt} src={image.href} />
              <span>{image.meta ?? image.filename}</span>
            </Link>
          ))}
        </div>
        <MoreCount maxItems={maxItems} total={block.images.length} />
      </CompactBlock>
    );
  }

  if (block.type === "outbound_call_request") {
    return (
      <CompactBlock key={key} title={block.title}>
        <div className="assistant-compact-request">
          <span>Recipient</span>
          <strong>{block.request.contactName ?? "Phone contact"}</strong>
          <span>Phone</span>
          <strong>{block.request.phoneNumber}</strong>
          <p>{block.request.instructions}</p>
        </div>
      </CompactBlock>
    );
  }

  const fallbackText = blockFallbackText(block);

  if (!fallbackText) {
    return null;
  }

  return (
    <CompactBlock key={key} title={block.title}>
      <p className="assistant-compact-text">{fallbackText}</p>
    </CompactBlock>
  );
}

export function AssistantCompactBlocks({
  maxItems = 3,
  message,
}: Readonly<{
  maxItems?: number;
  message: AssistantThreadMessage;
}>) {
  const blocks =
    message.uiBlocks?.length
      ? message.uiBlocks
      : message.links?.length
        ? [linksAsBlock(message.links)]
        : [];

  if (!blocks.length) {
    return null;
  }

  return (
    <div className="assistant-compact-blocks">
      {blocks.map((block, index) =>
        renderBlock(block, maxItems, `${block.type}-${index}`),
      )}
    </div>
  );
}
