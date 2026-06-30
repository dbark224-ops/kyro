"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";

const INBOX_PREVIEW_LOADING_EVENT = "kyro:inbox-preview-loading";

type PendingPreview = {
  conversationId: string;
  href: string;
  label?: string;
};

type InboxPreviewLoadingEvent = CustomEvent<PendingPreview>;

function shouldHandleClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.currentTarget.target !== "_blank"
  );
}

function announcePreviewLoading(detail: PendingPreview) {
  window.dispatchEvent(
    new CustomEvent(INBOX_PREVIEW_LOADING_EVENT, {
      detail,
    }),
  );
}

export function InboxConversationLink({
  children,
  className,
  conversationId,
  href,
  label,
  selected,
}: {
  children: ReactNode;
  className?: string;
  conversationId: string;
  href: string;
  label?: string;
  selected: boolean;
}) {
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setIsPending(false);
  }, [selected, href]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!shouldHandleClick(event) || selected) {
      return;
    }

    setIsPending(true);
    announcePreviewLoading({
      conversationId,
      href,
      label,
    });
  }

  return (
    <SmartPrefetchLink
      aria-busy={isPending}
      className={className}
      href={href}
      onClick={handleClick}
    >
      {children}
      {isPending ? (
        <span className="conversation-row-loading">
          <span aria-hidden="true" className="settings-submit-spinner" />
          Opening
        </span>
      ) : null}
    </SmartPrefetchLink>
  );
}

export function InboxPreviewTransitionShell({
  children,
  selectedConversationId,
}: {
  children?: ReactNode;
  selectedConversationId?: string | null;
}) {
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(
    null,
  );

  useEffect(() => {
    const handleLoading = (event: Event) => {
      setPendingPreview((event as InboxPreviewLoadingEvent).detail);
    };

    window.addEventListener(INBOX_PREVIEW_LOADING_EVENT, handleLoading);

    return () => {
      window.removeEventListener(INBOX_PREVIEW_LOADING_EVENT, handleLoading);
    };
  }, []);

  useEffect(() => {
    if (
      pendingPreview &&
      pendingPreview.conversationId === selectedConversationId
    ) {
      setPendingPreview(null);
    }
  }, [pendingPreview, selectedConversationId]);

  useEffect(() => {
    if (!pendingPreview) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPendingPreview(null);
    }, 12000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingPreview]);

  const shouldShowPending =
    pendingPreview && pendingPreview.conversationId !== selectedConversationId;

  if (!children && !shouldShowPending) {
    return null;
  }

  return (
    <div
      className="inbox-preview-transition-shell"
      data-loading={shouldShowPending ? "true" : undefined}
    >
      {children}
      {shouldShowPending ? (
        <div
          aria-live="polite"
          className={
            children
              ? "inbox-preview-loading-overlay"
              : "panel assistant-inline-preview inbox-inline-preview inbox-preview-loading-panel"
          }
        >
          <div className="inbox-preview-loading-card">
            <span aria-hidden="true" className="settings-submit-spinner" />
            <div>
              <strong>Opening conversation</strong>
              <span>
                {pendingPreview.label ?? "Loading the latest thread..."}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
