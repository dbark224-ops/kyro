"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

type SettingsSubmitButtonProps = Readonly<{
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  name?: string;
  pendingLabel?: string;
  value?: string;
}>;

export function SettingsSubmitButton({
  children,
  className = "primary-button compact",
  disabled = false,
  name,
  pendingLabel = "Saving...",
  value,
}: SettingsSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={`settings-submit-button ${className}`}
      disabled={disabled || pending}
      name={name}
      type="submit"
      value={value}
    >
      {pending ? (
        <>
          <span aria-hidden="true" className="settings-submit-spinner" />
          <span>{pendingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
