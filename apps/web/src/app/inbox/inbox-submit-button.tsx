"use client";

import { useFormStatus } from "react-dom";

type InboxSubmitButtonProps = {
  className?: string;
  label: string;
  pendingLabel?: string;
};

export function InboxSubmitButton({
  className = "primary-button compact",
  label,
  pendingLabel = label,
}: InboxSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={`${className} inbox-submit-button`}
      disabled={pending}
      type="submit"
    >
      {pending ? (
        <span aria-hidden="true" className="settings-submit-spinner" />
      ) : null}
      {pending ? pendingLabel : label}
    </button>
  );
}
