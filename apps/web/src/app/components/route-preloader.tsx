"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  canRunBackgroundPrefetch,
  claimBackgroundPrefetchLease,
  forgetPrefetched,
  hasPrefetched,
  markPrefetched,
} from "./background-prefetch";

type IdleWindow = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
};

const PREFETCH_STAGGER_MS = 220;
const MAX_IDLE_PREFETCH_ROUTES = 3;

/**
 * Warms a handful of destinations once the page has gone quiet.
 *
 * Runs off requestIdleCallback, so it cannot lengthen the load of the screen
 * you are already looking at -- it only starts once the browser has nothing
 * better to do. It also refuses on a slow or metered connection, on a hidden
 * tab, and when another tab already holds the lease.
 *
 * Used for the main nav, and for the first few rows of the inbox and CRM lists
 * so that clicking down a list is warm rather than only the row you happened
 * to hover.
 */
export function RoutePreloader({
  activeHref,
  limit = MAX_IDLE_PREFETCH_ROUTES,
  routes,
}: Readonly<{
  activeHref?: string;
  limit?: number;
  routes: string[];
}>) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const timeouts: number[] = [];
    const idleWindow = window as IdleWindow;
    const routesToPrefetch = Array.from(new Set(routes))
      .filter((route) => route !== activeHref && !hasPrefetched(route))
      .slice(0, Math.max(0, limit));

    if (routesToPrefetch.length === 0 || !canRunBackgroundPrefetch()) {
      return;
    }

    const prefetchRoutes = () => {
      if (
        cancelled ||
        !canRunBackgroundPrefetch() ||
        !claimBackgroundPrefetchLease()
      ) {
        return;
      }

      routesToPrefetch.forEach((route, index) => {
        const timeout = window.setTimeout(() => {
          if (!cancelled && canRunBackgroundPrefetch()) {
            markPrefetched(route);
            try {
              router.prefetch(route);
            } catch {
              forgetPrefetched(route);
            }
          }
        }, index * PREFETCH_STAGGER_MS);

        timeouts.push(timeout);
      });
    };

    const idleHandle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(prefetchRoutes, { timeout: 1500 })
      : undefined;
    const fallbackTimeout = idleHandle
      ? undefined
      : window.setTimeout(prefetchRoutes, 900);

    return () => {
      cancelled = true;

      if (idleHandle && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }

      if (fallbackTimeout) {
        window.clearTimeout(fallbackTimeout);
      }

      for (const timeout of timeouts) {
        window.clearTimeout(timeout);
      }
    };
  }, [activeHref, limit, router, routes]);

  return null;
}
