"use client";

import { useState } from "react";

function splitTags(value: string | null | undefined) {
  const seen = new Set<string>();

  return (value ?? "")
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

export function TagInputField({
  ariaLabel,
  defaultValue,
  name,
  placeholder,
}: Readonly<{
  ariaLabel: string;
  defaultValue?: string | null;
  name: string;
  placeholder?: string;
}>) {
  const [tags, setTags] = useState(() => splitTags(defaultValue));
  const [draft, setDraft] = useState("");

  function addTags(rawValue = draft) {
    const nextTags = splitTags(rawValue);

    if (!nextTags.length) {
      setDraft("");
      return;
    }

    setTags((currentTags) => {
      const seen = new Set(currentTags.map((tag) => tag.toLowerCase()));
      const merged = [...currentTags];

      for (const tag of nextTags) {
        const key = tag.toLowerCase();

        if (!seen.has(key)) {
          seen.add(key);
          merged.push(tag);
        }
      }

      return merged;
    });
    setDraft("");
  }

  function removeTag(tagToRemove: string) {
    setTags((currentTags) =>
      currentTags.filter((tag) => tag !== tagToRemove),
    );
  }

  return (
    <div className="settings-tag-field">
      <input name={name} type="hidden" value={tags.join(", ")} />
      <div className="settings-tag-list">
        {tags.map((tag) => (
          <button
            className="settings-tag-pill"
            key={tag}
            onClick={() => removeTag(tag)}
            type="button"
          >
            <span>{tag}</span>
            <span aria-hidden="true">x</span>
          </button>
        ))}
        <input
          aria-label={ariaLabel}
          onBlur={() => addTags()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const shouldCommitTag =
              event.key === "Enter" ||
              event.key === "," ||
              event.key === "Tab";

            if (shouldCommitTag) {
              event.preventDefault();
              addTags();
            }

            if (event.key === "Backspace" && !draft && tags.length) {
              setTags((currentTags) => currentTags.slice(0, -1));
            }
          }}
          placeholder={tags.length ? "Add another..." : placeholder}
          value={draft}
        />
      </div>
    </div>
  );
}
