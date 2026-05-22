"use client";

import { useFormStatus } from "react-dom";

export function ManualSyncSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-live="polite"
      className="secondary-button compact"
      disabled={pending}
      type="submit"
    >
      {pending ? "Checking inbox..." : "Check inbox now"}
    </button>
  );
}
