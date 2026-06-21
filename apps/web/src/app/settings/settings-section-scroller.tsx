"use client";

import { useEffect } from "react";

export function SettingsSectionScroller({
  targetId,
}: Readonly<{ targetId: string | null }>) {
  useEffect(() => {
    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) {
        return;
      }

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [targetId]);

  return null;
}
