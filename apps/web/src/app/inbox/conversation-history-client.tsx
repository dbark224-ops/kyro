"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ConversationHistoryDetailFact,
  ConversationHistoryDetailSection,
  ConversationHistoryItem,
} from "./conversation-history-types";

function DetailFacts({ facts }: { facts: ConversationHistoryDetailFact[] }) {
  const visibleFacts = facts.filter((fact) => fact.value && fact.value !== "-");

  if (visibleFacts.length === 0) {
    return null;
  }

  return (
    <dl className="conversation-history-detail-facts">
      {visibleFacts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailSectionView({
  section,
}: {
  section: ConversationHistoryDetailSection;
}) {
  if (section.data !== undefined) {
    return (
      <details className="conversation-history-technical-details">
        <summary>{section.title}</summary>
        <pre>{JSON.stringify(section.data, null, 2)}</pre>
      </details>
    );
  }

  return (
    <section className="conversation-history-detail-section">
      <h3>{section.title}</h3>
      <p>{section.body || "No content recorded."}</p>
    </section>
  );
}

function HistoryDetailModal({
  contained,
  item,
  onClose,
}: {
  contained: boolean;
  item: ConversationHistoryItem;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (!contained) {
      document.body.style.overflow = "hidden";
    }
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      if (!contained) {
        document.body.style.overflow = previousOverflow;
      }
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contained, onClose]);

  const titleId = `conversation-history-detail-${item.id.replaceAll(":", "-")}`;

  return (
    <div
      className={`call-log-modal-backdrop conversation-history-modal-backdrop${
        contained ? " is-contained" : ""
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="call-log-modal conversation-history-modal"
        role="dialog"
      >
        <header className="call-log-modal-header">
          <div>
            <p className="eyebrow">{item.type}</p>
            <h2 id={titleId}>{item.modalTitle}</h2>
            <p>
              {item.title} - {item.occurredAtLabel}
            </p>
          </div>
          <button
            className="secondary-button compact"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            Close
          </button>
        </header>
        <div className="call-log-modal-body conversation-history-modal-body">
          <section className="conversation-history-detail-section">
            <h3>Overview</h3>
            <DetailFacts facts={item.details.facts} />
          </section>
          {item.details.sections.map((section) => (
            <DetailSectionView key={section.title} section={section} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function ConversationHistoryClient({
  items,
}: {
  items: ConversationHistoryItem[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [modalRoot, setModalRoot] = useState<HTMLElement | null>(null);
  const [selectedItem, setSelectedItem] =
    useState<ConversationHistoryItem | null>(null);
  const closeSelectedItem = useCallback(() => {
    setSelectedItem(null);
    setModalRoot(null);
  }, []);

  const openItem = useCallback((item: ConversationHistoryItem) => {
    const detailPanel =
      rootRef.current?.closest<HTMLElement>(
        "[data-conversation-detail-panel]",
      ) ?? document.body;

    setModalRoot(detailPanel);
    setSelectedItem(item);
  }, []);

  return (
    <div className="conversation-history-shell" ref={rootRef}>
      <details className="assistant-preview-panel conversation-history">
        <summary>
          <div>
            <h3>Conversation history</h3>
            <span>Messages, deliveries, actions, and follow-up activity</span>
          </div>
          <span>{items.length}</span>
        </summary>
        <div className="conversation-history-list">
          {items.length > 0 ? (
            items.map((item) => (
              <button
                aria-label={`View ${item.title}: ${item.summary}`}
                className="conversation-history-row"
                key={item.id}
                onClick={() => openItem(item)}
                type="button"
              >
                <span className="conversation-history-dot" />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                </div>
                <div className="conversation-history-meta">
                  <span>{item.type}</span>
                  <time>{item.occurredAtLabel}</time>
                </div>
              </button>
            ))
          ) : (
            <p className="empty-copy">No conversation activity recorded yet.</p>
          )}
        </div>
      </details>
      {selectedItem && modalRoot
        ? createPortal(
            <HistoryDetailModal
              contained={modalRoot !== document.body}
              item={selectedItem}
              onClose={closeSelectedItem}
            />,
            modalRoot,
          )
        : null}
    </div>
  );
}
