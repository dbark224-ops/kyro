"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  canRunBackgroundPrefetch,
  claimBackgroundPrefetchLease,
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
const prefetchedRoutes = new Set<string>();

export function RoutePreloader({
  activeHref,
  routes,
}: Readonly<{
  activeHref?: string;
  routes: string[];
}>) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const timeouts: number[] = [];
    const idleWindow = window as IdleWindow;
    const routesToPrefetch = Array.from(new Set(routes))
      .filter((route) => route !== activeHref && !prefetchedRoutes.has(route))
      .slice(0, MAX_IDLE_PREFETCH_ROUTES);

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
            prefetchedRoutes.add(route);
            try {
              router.prefetch(route);
            } catch {
              prefetchedRoutes.delete(route);
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
  }, [activeHref, router, routes]);

  return null;
}
