"use client";

import { type ReactNode, useState } from "react";

type PronunciationEntryExpanderProps = Readonly<{
  children: ReactNode;
  count: number;
}>;

export function PronunciationEntryExpander({
  children,
  count,
}: PronunciationEntryExpanderProps) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        className="pronunciation-entry-expander-button"
        onClick={() => setExpanded(true)}
        type="button"
      >
        Show {count} more
      </button>
    );
  }

  return (
    <>
      <div className="pronunciation-entry-list nested">{children}</div>
      <button
        className="pronunciation-entry-expander-button"
        onClick={() => setExpanded(false)}
        type="button"
      >
        Collapse
      </button>
    </>
  );
}
