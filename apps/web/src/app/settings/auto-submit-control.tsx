"use client";

import { useCallback, useRef } from "react";
import type { ChangeEvent, ReactNode } from "react";

const TEXT_LIKE_INPUT_TYPES = new Set([
  "email",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

type AutoSubmitControlProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

export function AutoSubmitControl({
  children,
  className,
}: AutoSubmitControlProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((event: ChangeEvent<HTMLDivElement>) => {
    const target = event.target;

    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }

    if (
      target instanceof HTMLInputElement &&
      TEXT_LIKE_INPUT_TYPES.has(target.type)
    ) {
      return;
    }

    const form = target.form;

    if (!form) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      form.requestSubmit();
    }, target instanceof HTMLInputElement && target.type === "number" ? 500 : 0);
  }, []);

  return (
    <div className={className} onChange={handleChange}>
      {children}
    </div>
  );
}
