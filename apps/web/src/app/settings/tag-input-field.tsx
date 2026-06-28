"use client";

import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion } from "../../lib/addresses/types";

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
  autocompleteType,
  defaultValue,
  name,
  placeholder,
}: Readonly<{
  ariaLabel: string;
  autoSubmit?: boolean;
  autocompleteType?: "cities" | "regions";
  defaultValue?: string | null;
  name: string;
  placeholder?: string;
}>) {
  const [tags, setTags] = useState(() => splitTags(defaultValue));
  const [draft, setDraft] = useState("");
  const [submitVersion, setSubmitVersion] = useState(0);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [suggestionStatus, setSuggestionStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const sessionTokenRef = useRef(crypto.randomUUID());

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

  useEffect(() => {
    if (!autocompleteType) {
      return;
    }

    const query = draft.trim();
    const controller = new AbortController();
    const timeout = window.setTimeout(
      async () => {
        if (query.length < 3) {
          setSuggestions([]);
          setSuggestionsOpen(false);
          setSuggestionStatus("idle");
          setSuggestionMessage("");
          return;
        }

        setSuggestionStatus("loading");
        setSuggestionMessage("");

        try {
          const params = new URLSearchParams({
            q: query,
            sessionToken: sessionTokenRef.current,
            type: autocompleteType,
          });
          const response = await fetch(
            `/api/addresses/autocomplete?${params}`,
            {
              signal: controller.signal,
            },
          );
          const payload = (await response.json()) as {
            data?: AddressSuggestion[];
            error?: string;
          };

          if (!response.ok) {
            throw new Error(payload.error ?? "Unable to search places.");
          }

          setSuggestions(payload.data ?? []);
          setSuggestionsOpen(Boolean(payload.data?.length));
          setSuggestionStatus("idle");
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          setSuggestions([]);
          setSuggestionsOpen(false);
          setSuggestionStatus("error");
          setSuggestionMessage(
            error instanceof Error
              ? error.message
              : "Place search is unavailable.",
          );
        }
      },
      query.length < 3 ? 0 : 250,
    );

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [autocompleteType, draft]);

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

  function chooseSuggestion(suggestion: AddressSuggestion) {
    const selected =
      suggestion.mainText || suggestion.description || suggestion.secondaryText;

    if (selected) {
      addTags(selected);
    }

    setSuggestions([]);
    setSuggestionsOpen(false);
    setSuggestionStatus("idle");
    setSuggestionMessage("");
    sessionTokenRef.current = crypto.randomUUID();
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
          onChange={(event) => {
            setDraft(event.target.value);
            setSuggestionMessage("");
          }}
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
        {suggestionStatus === "loading" ? (
          <span className="settings-tag-spinner" aria-hidden="true" />
        ) : null}
        {suggestionsOpen ? (
          <span
            className="address-autocomplete-menu settings-tag-suggestion-menu"
            role="listbox"
          >
            {suggestions.map((suggestion) => (
              <button
                aria-selected={false}
                key={suggestion.placeId}
                onClick={() => chooseSuggestion(suggestion)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                <strong>{suggestion.mainText}</strong>
                {suggestion.secondaryText ? (
                  <small>{suggestion.secondaryText}</small>
                ) : null}
              </button>
            ))}
            <span className="address-autocomplete-attribution">
              Powered by Google
            </span>
          </span>
        ) : null}
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
      {suggestionMessage ? (
        <small className="address-autocomplete-message">
          {suggestionMessage}
        </small>
      ) : null}
    </div>
  );
}
