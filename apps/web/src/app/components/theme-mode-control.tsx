"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "kyro:theme-mode";
const THEME_MODES = ["light", "system", "dark"] as const;

type ThemeMode = (typeof THEME_MODES)[number];

function isThemeMode(value: string | null): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}

function applyThemeMode(mode: ThemeMode) {
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
    return;
  }

  document.documentElement.dataset.theme = mode;
}

function storedThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  const storedMode = window.localStorage.getItem(THEME_KEY);

  return isThemeMode(storedMode) ? storedMode : "system";
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="12" rx="2" width="18" x="3" y="4" />
      <path d="M8 20h8M10 16v4M14 16v4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 14.6A7.8 7.8 0 0 1 9.4 4 8.4 8.4 0 1 0 20 14.6Z" />
    </svg>
  );
}

function modeIcon(mode: ThemeMode) {
  if (mode === "light") {
    return <SunIcon />;
  }

  if (mode === "dark") {
    return <MoonIcon />;
  }

  return <SystemIcon />;
}

export function ThemeModeControl() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const storedMode = storedThemeMode();

    applyThemeMode(storedMode);
    window.queueMicrotask(() => {
      setMode(storedMode);
    });
  }, []);

  function updateMode(nextMode: ThemeMode) {
    setMode(nextMode);
    applyThemeMode(nextMode);
    window.localStorage.setItem(THEME_KEY, nextMode);
  }

  return (
    <div className="theme-mode-control" aria-label="Colour mode">
      {THEME_MODES.map((themeMode) => (
        <button
          aria-label={
            themeMode === "light"
              ? "Use light mode"
              : themeMode === "dark"
                ? "Use dark mode"
                : "Use system colour mode"
          }
          aria-pressed={mode === themeMode}
          className={mode === themeMode ? "active" : undefined}
          key={themeMode}
          onClick={() => updateMode(themeMode)}
          title={
            themeMode === "light"
              ? "Light"
              : themeMode === "dark"
                ? "Dark"
                : "System"
          }
          type="button"
        >
          {modeIcon(themeMode)}
        </button>
      ))}
    </div>
  );
}
