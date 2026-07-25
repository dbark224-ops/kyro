"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path
        d="M13.1 5.7A5.5 5.5 0 1 0 13.4 9M13.1 2.8v2.9h-2.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function InboxRefreshButton() {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  return (
    <button
      aria-busy={isRefreshing}
      aria-label="Refresh inbox"
      className="inbox-refresh-button"
      disabled={isRefreshing}
      onClick={() => startRefresh(() => router.refresh())}
      title="Refresh inbox"
      type="button"
    >
      <span className={isRefreshing ? "inbox-refresh-icon-spinning" : undefined}>
        <RefreshIcon />
      </span>
    </button>
  );
}
