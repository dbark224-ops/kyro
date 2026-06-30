"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";

const SKIPPED_EMAIL_DIALOG_TRANSITION_EVENT =
  "kyro:skipped-email-dialog-transition";

type DialogTransitionState = "opening" | "closing";

type DialogTransitionDetail = {
  state: DialogTransitionState;
};

type DialogTransitionEvent = CustomEvent<DialogTransitionDetail>;

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

function announceDialogTransition(state: DialogTransitionState) {
  window.dispatchEvent(
    new CustomEvent(SKIPPED_EMAIL_DIALOG_TRANSITION_EVENT, {
      detail: { state },
    }),
  );
}

export function SkippedEmailDialogToggleLink({
  ariaLabel,
  children,
  className,
  href,
  isOpen,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  href: string;
  isOpen: boolean;
}) {
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setIsPending(false);
  }, [href, isOpen]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!shouldHandleClick(event)) {
      return;
    }

    setIsPending(true);
    announceDialogTransition(isOpen ? "closing" : "opening");
  }

  return (
    <SmartPrefetchLink
      aria-busy={isPending}
      aria-label={ariaLabel}
      className={className}
      href={href}
      onClick={handleClick}
    >
      {isPending ? (
        <span aria-hidden="true" className="settings-submit-spinner" />
      ) : null}
      {children}
    </SmartPrefetchLink>
  );
}

export function SkippedEmailCloseLink({
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

    announceDialogTransition("closing");
  }

  return (
    <SmartPrefetchLink className={className} href={href} onClick={handleClick}>
      {children}
    </SmartPrefetchLink>
  );
}

function SkippedEmailLoadingDialog() {
  return (
    <div className="skipped-email-backdrop" role="presentation">
      <section
        aria-labelledby="skipped-email-loading-title"
        aria-live="polite"
        aria-modal="true"
        className="skipped-email-dialog skipped-email-dialog-loading"
        role="dialog"
      >
        <div className="skipped-email-panel-heading">
          <div>
            <p className="eyebrow">Filtered-out emails</p>
            <h3 id="skipped-email-loading-title">Loading</h3>
            <p>
              Kyro is opening the filtered-out email list and latest skipped
              mail decisions.
            </p>
          </div>
          <span className="pill subtle">Loading</span>
        </div>
        <div className="skipped-email-loading-card">
          <span aria-hidden="true" className="settings-submit-spinner" />
          <div>
            <strong>Loading filtered-out emails</strong>
            <span>Preparing the skipped-mail review window...</span>
          </div>
        </div>
        <div aria-hidden="true" className="skipped-email-loading-list">
          <span />
          <span />
          <span />
        </div>
      </section>
    </div>
  );
}

export function SkippedEmailDialogTransitionShell({
  children,
  showSkippedEmail,
}: {
  children?: ReactNode;
  showSkippedEmail: boolean;
}) {
  const [transitionState, setTransitionState] =
    useState<DialogTransitionState | null>(null);

  useEffect(() => {
    const handleTransition = (event: Event) => {
      setTransitionState((event as DialogTransitionEvent).detail.state);
    };

    window.addEventListener(
      SKIPPED_EMAIL_DIALOG_TRANSITION_EVENT,
      handleTransition,
    );

    return () => {
      window.removeEventListener(
        SKIPPED_EMAIL_DIALOG_TRANSITION_EVENT,
        handleTransition,
      );
    };
  }, []);

  useEffect(() => {
    if (
      (showSkippedEmail && transitionState === "opening") ||
      (!showSkippedEmail && transitionState === "closing")
    ) {
      setTransitionState(null);
    }
  }, [showSkippedEmail, transitionState]);

  useEffect(() => {
    if (!transitionState) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setTransitionState(null);
    }, 10000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [transitionState]);

  if (transitionState === "closing") {
    return null;
  }

  if (!children && transitionState === "opening") {
    return <SkippedEmailLoadingDialog />;
  }

  return children ?? null;
}
