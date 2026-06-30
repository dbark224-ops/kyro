"use client";

import { useFormStatus } from "react-dom";

export function ManualSyncSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className="secondary-button compact manual-sync-submit-button"
      disabled={pending}
      type="submit"
    >
      {pending ? (
        <span className="settings-submit-spinner" aria-hidden="true" />
      ) : null}
      {pending ? "Checking inbox..." : "Check inbox now"}
    </button>
  );
}
