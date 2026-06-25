"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type IdleWindow = Window & {
  navigator: Navigator & {
    connection?: {
      effectiveType?: string;
      saveData?: boolean;
    };
  };
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const MAX_IDLE_SETTINGS_PREFETCH_ROUTES = 5;
const SETTINGS_PREFETCH_STAGGER_MS = 180;
const prefetchedSettingsRoutes = new Set<string>();

function shouldSkipPrefetch(idleWindow: IdleWindow) {
  const connection = idleWindow.navigator.connection;

  return (
    connection?.saveData === true ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g"
  );
}

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

    if (!uniqueHrefs.length || shouldSkipPrefetch(idleWindow)) {
      return undefined;
    }

    const prefetch = () => {
      uniqueHrefs.forEach((href, index) => {
        const timeout = window.setTimeout(() => {
          if (cancelled) {
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
      const handle = idleWindow.requestIdleCallback(prefetch, { timeout: 1800 });

      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
        timeouts.forEach((timeout) => window.clearTimeout(timeout));
      };
    }

    const handle = window.setTimeout(prefetch, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [activeHref, hrefs, router]);

  return null;
}
