"use client";

import {
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type AutosaveResult = {
  message?: string;
  ok: boolean;
  savedAt?: string;
};

type InboundEmailAutosaveFormProps = Readonly<{
  action: (formData: FormData) => Promise<AutosaveResult>;
  children: ReactNode;
  className?: string;
}>;

type AutosaveStatus = "idle" | "saving" | "saved" | "error";

const TEXT_INPUT_TYPES = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
]);

function serializedForm(form: HTMLFormElement) {
  const formData = new FormData(form);

  return Array.from(formData.entries())
    .map(([key, value]) => {
      if (value instanceof File) {
        return `${key}:file:${value.name}:${value.size}:${value.type}`;
      }

      return `${key}:${value}`;
    })
    .sort()
    .join("\u001f");
}

function isAutosaveTarget(target: EventTarget) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function isDebouncedTarget(target: EventTarget) {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type))
  );
}

export function InboundEmailAutosaveForm({
  action,
  children,
  className,
}: InboundEmailAutosaveFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedSnapshotRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef<{
    formData: FormData;
    snapshot: string;
  } | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [message, setMessage] = useState("Saved automatically");

  useEffect(() => {
    if (formRef.current) {
      lastSavedSnapshotRef.current = serializedForm(formRef.current);
    }
  }, []);

  const runSave = useCallback(
    async function runQueuedSave(snapshot: string, formData: FormData) {
      if (savingRef.current) {
        queuedSaveRef.current = { formData, snapshot };
        return;
      }

      savingRef.current = true;
      setStatus("saving");
      setMessage("Saving...");

      try {
        const result = await action(formData);

        if (result.ok) {
          lastSavedSnapshotRef.current = snapshot;
          setStatus("saved");
          setMessage("Saved automatically");
        } else {
          setStatus("error");
          setMessage(result.message || "Could not save changes");
        }
      } catch {
        setStatus("error");
        setMessage("Could not save changes");
      } finally {
        savingRef.current = false;

        const queuedSave = queuedSaveRef.current;
        queuedSaveRef.current = null;

        if (
          queuedSave &&
          queuedSave.snapshot !== lastSavedSnapshotRef.current
        ) {
          void runQueuedSave(queuedSave.snapshot, queuedSave.formData);
        }
      }
    },
    [action],
  );

  const autosave = useCallback(() => {
    const form = formRef.current;

    if (!form || !form.checkValidity()) {
      return;
    }

    const snapshot = serializedForm(form);

    if (snapshot === lastSavedSnapshotRef.current) {
      return;
    }

    void runSave(snapshot, new FormData(form));
  }, [runSave]);

  const scheduleAutosave = useCallback(
    (delayMs: number) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(() => {
        autosave();
      }, delayMs);
    },
    [autosave],
  );

  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    if (!isAutosaveTarget(event.target)) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    autosave();
  }

  function handleChange(event: FormEvent<HTMLFormElement>) {
    if (!isAutosaveTarget(event.target)) {
      return;
    }

    scheduleAutosave(isDebouncedTarget(event.target) ? 700 : 0);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    autosave();
  }

  return (
    <form
      className={className}
      onBlur={handleBlur}
      onChange={handleChange}
      onSubmit={handleSubmit}
      ref={formRef}
    >
      {children}
      <div className="settings-autosave-status-row" aria-live="polite">
        <span className={`settings-autosave-status ${status}`}>{message}</span>
      </div>
    </form>
  );
}
