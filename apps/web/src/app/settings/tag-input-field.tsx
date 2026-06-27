"use client";

import { useEffect, useRef, useState } from "react";

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
  autoSubmit = false,
  defaultValue,
  name,
  placeholder,
}: Readonly<{
  ariaLabel: string;
  autoSubmit?: boolean;
  defaultValue?: string | null;
  name: string;
  placeholder?: string;
}>) {
  const [tags, setTags] = useState(() => splitTags(defaultValue));
  const [draft, setDraft] = useState("");
  const [submitVersion, setSubmitVersion] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoSubmit || submitVersion === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const form = fieldRef.current?.closest("form");

      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [autoSubmit, submitVersion, tags]);

  function queueAutoSubmit() {
    if (autoSubmit) {
      setSubmitVersion((current) => current + 1);
    }
  }

  function addTags(rawValue = draft) {
    const nextTags = splitTags(rawValue);

    if (!nextTags.length) {
      setDraft("");
      return;
    }

    const seen = new Set(tags.map((tag) => tag.toLowerCase()));
    const newTags = nextTags.filter((tag) => {
      const key = tag.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

    setDraft("");

    if (!newTags.length) {
      return;
    }

    setTags([...tags, ...newTags]);
    queueAutoSubmit();
  }

  function removeTag(tagToRemove: string) {
    if (!tags.includes(tagToRemove)) {
      return;
    }

    setTags(tags.filter((tag) => tag !== tagToRemove));
    queueAutoSubmit();
  }

  return (
    <div className="settings-tag-field" ref={fieldRef}>
      <input name={name} type="hidden" value={tags.join(", ")} />
      <div className="settings-tag-list">
        <input
          aria-label={ariaLabel}
          onBlur={() => addTags()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const shouldCommitTag =
              event.key === "Enter" || event.key === "," || event.key === "Tab";

            if (shouldCommitTag) {
              event.preventDefault();
              addTags();
            }

            if (event.key === "Backspace" && !draft && tags.length) {
              setTags(tags.slice(0, -1));
              queueAutoSubmit();
            }
          }}
          placeholder={tags.length ? "Add another..." : placeholder}
          value={draft}
        />
        {tags.length ? (
          <div className="settings-tag-pill-list">
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
