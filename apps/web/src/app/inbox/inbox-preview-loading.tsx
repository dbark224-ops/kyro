"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";

const INBOX_PREVIEW_LOADING_EVENT = "kyro:inbox-preview-loading";
const INBOX_PREVIEW_CLOSE_EVENT = "kyro:inbox-preview-close";

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
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const isPending = pendingHref === href && !selected;

  useEffect(() => {
    if (!pendingHref) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setPendingHref(null);
    }, 12000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingHref]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!shouldHandleClick(event) || selected) {
      return;
    }

    setPendingHref(href);
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
      preload
    >
      {children}
    </SmartPrefetchLink>
  );
}

export function InboxPreviewCloseLink({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!shouldHandleClick(event)) {
      return;
    }

    window.dispatchEvent(new Event(INBOX_PREVIEW_CLOSE_EVENT));
  }

  return (
    <SmartPrefetchLink
      className={className}
      href={href}
      onClick={handleClick}
      preload
    >
      {children}
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
  const [closedConversationId, setClosedConversationId] = useState<
    string | null
  >(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleLoading = (event: Event) => {
      setClosedConversationId(null);
      setPendingPreview((event as InboxPreviewLoadingEvent).detail);
      document
        .querySelector(".inbox-workspace[data-preview-hidden='true']")
        ?.removeAttribute("data-preview-hidden");
    };
    const handleClose = () => {
      setPendingPreview(null);
      setClosedConversationId(selectedConversationId ?? "closed");
      shellRef.current
        ?.closest(".inbox-workspace")
        ?.setAttribute("data-preview-hidden", "true");
    };

    window.addEventListener(INBOX_PREVIEW_LOADING_EVENT, handleLoading);
    window.addEventListener(INBOX_PREVIEW_CLOSE_EVENT, handleClose);

    return () => {
      window.removeEventListener(INBOX_PREVIEW_LOADING_EVENT, handleLoading);
      window.removeEventListener(INBOX_PREVIEW_CLOSE_EVENT, handleClose);
    };
  }, [selectedConversationId]);

  const optimisticallyClosed = Boolean(
    closedConversationId &&
    (closedConversationId === selectedConversationId ||
      !selectedConversationId),
  );

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

  const visiblePendingPreview =
    pendingPreview?.conversationId === selectedConversationId
      ? null
      : pendingPreview;
  const shouldShowPending = Boolean(visiblePendingPreview);

  if (optimisticallyClosed || (!children && !shouldShowPending)) {
    return null;
  }

  return (
    <div
      className="inbox-preview-transition-shell"
      data-loading={shouldShowPending ? "true" : undefined}
      ref={shellRef}
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
                {visiblePendingPreview?.label ?? "Loading the latest thread..."}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
