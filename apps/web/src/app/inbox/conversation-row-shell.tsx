"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { deleteConversationAction } from "./actions";

function TrashIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

/**
 * The row, and its own delete button, inside one form.
 *
 * Deleting is a server action followed by a redirect, so the row sat there
 * looking untouched for about three seconds -- long enough to press it again,
 * and long enough to doubt it had registered at all.
 *
 * `useFormStatus` has to be read from inside the form, which is why the row
 * body lives in here rather than the row simply being handed a button.
 */
function RowBody({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { pending } = useFormStatus();

  return (
    <div
      className="conversation-row-shell"
      data-removing={pending ? "true" : undefined}
    >
      {children}
      <button
        aria-label="Move conversation to Deleted"
        className="conversation-delete-button"
        disabled={pending}
        title="Move to Deleted"
        type="submit"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

export function ConversationRowShell({
  children,
  conversationId,
  redirectTo,
}: Readonly<{
  children: ReactNode;
  conversationId: string;
  redirectTo: string;
}>) {
  return (
    /**
     * Driven by the form's own pending state rather than a flag set on click.
     * A sticky flag would leave the row hidden if the delete failed; this
     * clears itself the moment the action settles, so a failure puts the row
     * back rather than losing it until a refresh.
     */
    <form action={deleteConversationAction} className="conversation-row-form">
      <input name="conversationId" type="hidden" value={conversationId} />
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <RowBody>{children}</RowBody>
    </form>
  );
}
