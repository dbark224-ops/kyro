"use client";

import { useEffect, useRef, useState } from "react";

const SCALE_KEY = "kyro:text-scale";
const SCALE_STEPS = [0.92, 1, 1.08, 1.16] as const;

function closestScale(value: number) {
  return SCALE_STEPS.reduce((closest, step) =>
    Math.abs(step - value) < Math.abs(closest - value) ? step : closest,
  );
}

function applyTextScale(scale: number) {
  document.documentElement.style.setProperty("--kyro-root-font-size", `${16 * scale}px`);
  document.documentElement.dataset.textScale = String(scale);
}

function getStoredTextScale() {
  if (typeof window === "undefined") {
    return 1;
  }

  const storedScale = Number(window.localStorage.getItem(SCALE_KEY));

  return Number.isFinite(storedScale) ? closestScale(storedScale) : 1;
}

export function TextScaleControl() {
  const hasLoadedStoredScaleRef = useRef(false);
  const [scale, setScale] = useState<number>(1);

  useEffect(() => {
    const storedScale = getStoredTextScale();

    applyTextScale(storedScale);
    window.queueMicrotask(() => {
      hasLoadedStoredScaleRef.current = true;
      setScale(storedScale);
    });
  }, []);

  useEffect(() => {
    if (!hasLoadedStoredScaleRef.current) {
      return;
    }

    applyTextScale(scale);
  }, [scale]);

  function updateScale(direction: "down" | "up") {
    const currentIndex = SCALE_STEPS.findIndex((step) => step === closestScale(scale));
    const nextIndex =
      direction === "up"
        ? Math.min(SCALE_STEPS.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    const nextScale = SCALE_STEPS[nextIndex];

    setScale(nextScale);
    window.localStorage.setItem(SCALE_KEY, String(nextScale));
  }

  return (
    <div className="text-scale-control" aria-label="Text size dev control">
      <button
        aria-label="Decrease text size"
        disabled={scale === SCALE_STEPS[0]}
        onClick={() => updateScale("down")}
        type="button"
      >
        A-
      </button>
      <span suppressHydrationWarning>{Math.round(scale * 100)}%</span>
      <button
        aria-label="Increase text size"
        disabled={scale === SCALE_STEPS[SCALE_STEPS.length - 1]}
        onClick={() => updateScale("up")}
        type="button"
      >
        A+
      </button>
    </div>
  );
}
