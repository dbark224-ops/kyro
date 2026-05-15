"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type IdleWindow = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
};

const PREFETCH_STAGGER_MS = 140;

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
    const routesToPrefetch = routes.filter((route) => route !== activeHref);

    const prefetchRoutes = () => {
      routesToPrefetch.forEach((route, index) => {
        const timeout = window.setTimeout(() => {
          if (!cancelled) {
            router.prefetch(route);
          }
        }, index * PREFETCH_STAGGER_MS);

        timeouts.push(timeout);
      });
    };

    const idleHandle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(prefetchRoutes, { timeout: 1800 })
      : undefined;
    const fallbackTimeout = idleHandle
      ? undefined
      : window.setTimeout(prefetchRoutes, 700);

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
