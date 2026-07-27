"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { PendingSmartPrefetchLink } from "../components/pending-smart-prefetch-link";

/**
 * Instant feedback when a CRM profile is opened.
 *
 * Clicking a row shimmered the row itself and then nothing happened until the
 * server came back with the whole page -- the profile panel is server
 * rendered, so on a slow query the screen simply sat there and the click read
 * as ignored. The inbox already solved this: announce the pending navigation,
 * draw a loading card over the panel straight away, and let the real content
 * replace it. This is that, for the CRM.
 *
 * Deliberately the same shape as inbox-preview-loading.tsx rather than a
 * shared abstraction -- the two differ in what they name the thing being
 * opened, and one indirection layer over two callers costs more than it saves.
 */
const CRM_PROFILE_LOADING_EVENT = "kyro:crm-profile-loading";
const NAVIGATION_FALLBACK_TIMEOUT_MS = 45_000;

type PendingProfile = {
  contactId: string;
  href: string;
  label?: string;
};

type CrmProfileLoadingEvent = CustomEvent<PendingProfile>;

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

export function CrmProfileLink({
  children,
  className,
  contactId,
  href,
  label,
  preload = false,
  selected,
}: Readonly<{
  children: ReactNode;
  className?: string;
  contactId: string;
  href: string;
  label?: string;
  preload?: boolean;
  selected: boolean;
}>) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!shouldHandleClick(event) || selected) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(CRM_PROFILE_LOADING_EVENT, {
        detail: { contactId, href, label },
      }),
    );
  }

  return (
    <PendingSmartPrefetchLink
      className={className}
      href={href}
      onClick={handleClick}
      preload={preload}
    >
      {children}
    </PendingSmartPrefetchLink>
  );
}

export function CrmProfileTransitionShell({
  children,
  selectedContactId,
}: Readonly<{
  children?: ReactNode;
  selectedContactId?: string | null;
}>) {
  const [pendingProfile, setPendingProfile] = useState<PendingProfile | null>(
    null,
  );
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleLoading = (event: Event) => {
      setPendingProfile((event as CrmProfileLoadingEvent).detail);
    };

    window.addEventListener(CRM_PROFILE_LOADING_EVENT, handleLoading);

    return () => {
      window.removeEventListener(CRM_PROFILE_LOADING_EVENT, handleLoading);
    };
  }, []);

  // The arriving page clears the pending state by rendering the contact that
  // was asked for. This timer only covers a navigation that never lands, so a
  // spinner cannot be left running forever.
  useEffect(() => {
    if (!pendingProfile) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setPendingProfile(null);
    }, NAVIGATION_FALLBACK_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingProfile]);

  const visiblePendingProfile =
    pendingProfile?.contactId === selectedContactId ? null : pendingProfile;
  const shouldShowPending = Boolean(visiblePendingProfile);

  if (!children && !shouldShowPending) {
    return null;
  }

  return (
    <div
      className="crm-profile-transition-shell"
      data-loading={shouldShowPending ? "true" : undefined}
      ref={shellRef}
    >
      {children}
      {shouldShowPending ? (
        <div
          aria-live="polite"
          className={
            children
              ? "crm-profile-loading-overlay"
              : "panel crm-profile-panel crm-profile-loading-panel"
          }
        >
          <div className="crm-profile-loading-card">
            <span aria-hidden="true" className="settings-submit-spinner" />
            <div>
              <strong>Opening profile</strong>
              <span>
                {visiblePendingProfile?.label ?? "Loading contact details..."}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
