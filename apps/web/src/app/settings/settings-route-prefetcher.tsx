"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function SettingsRoutePrefetcher({
  hrefs,
}: Readonly<{
  hrefs: string[];
}>) {
  const router = useRouter();

  useEffect(() => {
    const uniqueHrefs = Array.from(new Set(hrefs)).filter(Boolean);

    if (!uniqueHrefs.length || typeof window === "undefined") {
      return undefined;
    }

    const idleWindow = window as IdleWindow;
    const prefetch = () => {
      uniqueHrefs.forEach((href, index) => {
        window.setTimeout(() => router.prefetch(href), index * 40);
      });
    };

    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(prefetch, { timeout: 1200 });

      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(prefetch, 250);

    return () => window.clearTimeout(handle);
  }, [hrefs, router]);

  return null;
}
