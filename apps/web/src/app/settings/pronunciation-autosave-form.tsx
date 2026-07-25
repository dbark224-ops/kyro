"use client";

import {
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useTransition,
} from "react";

type PronunciationAutosaveFormProps = Readonly<{
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
}>;

const SERIALIZED_FIELDS = [
  "entryId",
  "phrase",
  "pronunciationHint",
  "category",
  "aliases",
] as const;

function formSnapshot(form: HTMLFormElement) {
  const formData = new FormData(form);

  return SERIALIZED_FIELDS.map((field) => `${field}:${formData.get(field) ?? ""}`).join(
    "\u001f",
  );
}

function shouldAutosave(event: SyntheticEvent<HTMLFormElement>) {
  const target = event.target;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

export function PronunciationAutosaveForm({
  action,
  children,
  className,
}: PronunciationAutosaveFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedSnapshotRef = useRef<string>("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (formRef.current) {
      lastSavedSnapshotRef.current = formSnapshot(formRef.current);
    }
  }, []);

  const autosave = useCallback(() => {
    const form = formRef.current;

    if (!form) {
      return;
    }

    const snapshot = formSnapshot(form);

    if (snapshot === lastSavedSnapshotRef.current || !form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    lastSavedSnapshotRef.current = snapshot;

    startTransition(() => {
      void action(formData).catch(() => {
        lastSavedSnapshotRef.current = "";
      });
    });
  }, [action]);

  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    if (shouldAutosave(event)) {
      autosave();
    }
  }

  function handleChange(event: FormEvent<HTMLFormElement>) {
    if (event.target instanceof HTMLSelectElement) {
      autosave();
    }
  }

  return (
    <form
      action={action}
      className={className}
      onBlur={handleBlur}
      onChange={handleChange}
      ref={formRef}
    >
      {children}
    </form>
  );
}
