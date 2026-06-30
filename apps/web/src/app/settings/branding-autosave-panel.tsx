"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

const BRANDING_FIELD_NAMES = new Set([
  "businessBrandAccentColor",
  "businessBrandPrimaryColor",
  "businessBrandStyle",
  "businessProfileLogoFile",
  "businessProfileLogoUrl",
]);

type BrandingAutosavePanelProps = Readonly<{
  children: ReactNode;
}>;

function isBrandingTarget(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
  ) {
    return false;
  }

  return BRANDING_FIELD_NAMES.has(target.name);
}

export function BrandingAutosavePanel({
  children,
}: BrandingAutosavePanelProps) {
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    const form = target.form;

    if (!form) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch("/api/settings/business-profile-branding", {
      body: new FormData(form),
      method: "POST",
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.error(
        error instanceof Error
          ? error.message
          : "Unable to autosave branding settings.",
      );
    });
  }, []);

  const scheduleSave = useCallback(
    (
      target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      delayMs: number,
    ) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => save(target), delayMs);
    },
    [save],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLDivElement>) => {
      if (!isBrandingTarget(event.target)) {
        return;
      }

      const target = event.target;
      const immediate =
        target instanceof HTMLInputElement && target.type === "file";

      scheduleSave(target, immediate ? 0 : 650);
    },
    [scheduleSave],
  );

  const handleInput = useCallback(
    (event: FormEvent<HTMLDivElement>) => {
      if (!isBrandingTarget(event.target)) {
        return;
      }

      scheduleSave(event.target, 650);
    },
    [scheduleSave],
  );

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      abortRef.current?.abort();
    },
    [],
  );

  return (
    <div onChange={handleChange} onInput={handleInput}>
      {children}
    </div>
  );
}
