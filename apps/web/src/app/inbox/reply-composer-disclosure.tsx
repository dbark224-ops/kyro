"use client";

import { useState, type ReactNode } from "react";

export function ReplyComposerDisclosure({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`conversation-reply-disclosure${open ? " is-open" : ""}`}
    >
      <button
        aria-expanded={open}
        className="conversation-reply-trigger"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span>{label}</span>
        <svg
          aria-hidden="true"
          fill="none"
          height="16"
          viewBox="0 0 24 24"
          width="16"
        >
          <path
            d="m9 18 6-6-6-6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </button>
      {open ? (
        <div className="conversation-reply-editor">{children}</div>
      ) : null}
    </div>
  );
}
