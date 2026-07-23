"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  canRunBackgroundPrefetch,
  claimBackgroundPrefetchLease,
} from "../components/background-prefetch";

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const MAX_IDLE_SETTINGS_PREFETCH_ROUTES = 3;
const SETTINGS_PREFETCH_STAGGER_MS = 220;
const prefetchedSettingsRoutes = new Set<string>();

export function SettingsRoutePrefetcher({
  activeHref,
  hrefs,
}: Readonly<{
  activeHref?: string;
  hrefs: string[];
}>) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const timeouts: number[] = [];
    const idleWindow = window as IdleWindow;
    const uniqueHrefs = Array.from(new Set(hrefs))
      .filter((href) => href && href !== activeHref)
      .filter((href) => !prefetchedSettingsRoutes.has(href))
      .slice(0, MAX_IDLE_SETTINGS_PREFETCH_ROUTES);

    if (!uniqueHrefs.length || !canRunBackgroundPrefetch()) {
      return undefined;
    }

    const prefetch = () => {
      if (
        cancelled ||
        !canRunBackgroundPrefetch() ||
        !claimBackgroundPrefetchLease()
      ) {
        return;
      }

      uniqueHrefs.forEach((href, index) => {
        const timeout = window.setTimeout(() => {
          if (cancelled || !canRunBackgroundPrefetch()) {
            return;
          }

          prefetchedSettingsRoutes.add(href);
          try {
            router.prefetch(href);
          } catch {
            prefetchedSettingsRoutes.delete(href);
          }
        }, index * SETTINGS_PREFETCH_STAGGER_MS);

        timeouts.push(timeout);
      });
    };

    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(prefetch, { timeout: 1500 });

      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
        timeouts.forEach((timeout) => window.clearTimeout(timeout));
      };
    }

    const handle = window.setTimeout(prefetch, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [activeHref, hrefs, router]);

  return null;
}
