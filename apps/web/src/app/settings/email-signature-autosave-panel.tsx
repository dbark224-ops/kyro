"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type ReactNode,
} from "react";

const AUTOSAVE_CHECKBOX_NAMES = new Set(["useSeparateAiSignature"]);

type EmailSignatureAutosavePanelProps = Readonly<{
  children: ReactNode;
}>;

export function EmailSignatureAutosavePanel({
  children,
}: EmailSignatureAutosavePanelProps) {
  const abortRef = useRef<AbortController | null>(null);

  const save = useCallback((target: HTMLInputElement) => {
    const form = target.form;

    if (!form) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch("/api/settings/email-signatures", {
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
          : "Unable to autosave email signatures.",
      );
    });
  }, []);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLDivElement>) => {
      const target = event.target;

      if (
        !(target instanceof HTMLInputElement) ||
        target.type !== "checkbox" ||
        !AUTOSAVE_CHECKBOX_NAMES.has(target.name)
      ) {
        return;
      }

      save(target);
    },
    [save],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  return <div onChange={handleChange}>{children}</div>;
}
