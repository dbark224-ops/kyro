"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

type Mailbox = "inbox" | "junk" | "deleted";

type PendingMailboxNavigation = {
  from: Mailbox;
  to: Mailbox;
};

function shouldTrackClick(event: MouseEvent<HTMLDivElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

function mailboxLabel(mailbox: Mailbox) {
  if (mailbox === "junk") {
    return "junk";
  }

  if (mailbox === "deleted") {
    return "deleted messages";
  }

  return "inbox";
}

export function InboxMailboxTransition({
  activeMailbox,
  children,
}: Readonly<{
  activeMailbox: Mailbox;
  children: ReactNode;
}>) {
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingMailboxNavigation | null>(null);
  const pendingMailbox =
    pendingNavigation?.from === activeMailbox ? pendingNavigation.to : null;

  useEffect(() => {
    if (!pendingMailbox) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setPendingNavigation(null);
    }, 45_000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingMailbox]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (!shouldTrackClick(event)) {
      return;
    }

    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[data-mailbox-target]",
    );
    const nextMailbox = link?.dataset.mailboxTarget as Mailbox | undefined;

    if (
      !nextMailbox ||
      nextMailbox === activeMailbox ||
      link?.target === "_blank"
    ) {
      return;
    }

    setPendingNavigation({
      from: activeMailbox,
      to: nextMailbox,
    });
  }

  return (
    <div
      aria-busy={pendingMailbox ? "true" : undefined}
      className="inbox-mailbox-transition"
      onClickCapture={handleClick}
    >
      {children}
      {pendingMailbox ? (
        <div aria-live="polite" className="inbox-mailbox-loading-overlay">
          <div className="inbox-preview-loading-card">
            <span aria-hidden="true" className="settings-submit-spinner" />
            <div>
              <strong>Loading {mailboxLabel(pendingMailbox)}</strong>
              <span>Updating the mailbox view...</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
