"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  searchSettings,
  type SettingsSearchEntry,
} from "./settings-search-catalog";

type SettingsSearchProps = {
  currentHref: string;
  includeDeveloper: boolean;
  onNavigate: (href: string) => void;
  onPrefetch: (href: string) => void;
};

export function SettingsSearch({
  currentHref,
  includeDeveloper,
  onNavigate,
  onPrefetch,
}: Readonly<SettingsSearchProps>) {
  const router = useRouter();
  const resultsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const results = useMemo(
    () => searchSettings(query, { includeDeveloper, limit: 8 }),
    [includeDeveloper, query],
  );
  const hasQuery = query.trim().length > 0;
  const showResults = open && hasQuery;

  function resetSearch() {
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function selectResult(result: SettingsSearchEntry) {
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    onNavigate(result.href);
  }

  function handleResultClick(
    event: MouseEvent<HTMLAnchorElement>,
    result: SettingsSearchEntry,
  ) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }

    selectResult(result);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!showResults || results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = activeIndex >= results.length - 1 ? 0 : activeIndex + 1;
      setActiveIndex(nextIndex);
      resultRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex >= 0 ? activeIndex : 0];

      if (result) {
        selectResult(result);
        router.push(result.href);
      }
    }
  }

  return (
    <div className="settings-search" onBlur={handleBlur}>
      <label className="sr-only" htmlFor={`${resultsId}-input`}>
        Search settings
      </label>
      <div className="settings-search-input-wrap">
        <input
          aria-autocomplete="list"
          aria-controls={resultsId}
          aria-expanded={showResults}
          autoComplete="off"
          id={`${resultsId}-input`}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search settings..."
          ref={inputRef}
          role="combobox"
          type="search"
          value={query}
        />
        {hasQuery ? (
          <button
            aria-label="Clear settings search"
            className="settings-search-clear"
            onClick={resetSearch}
            type="button"
          >
            x
          </button>
        ) : null}
      </div>

      {showResults ? (
        <div
          aria-label="Settings search results"
          className="settings-search-results"
          id={resultsId}
          role="listbox"
        >
          {results.length > 0 ? (
            results.map((result, index) => (
              <Link
                aria-current={result.href === currentHref ? "page" : undefined}
                className={
                  index === activeIndex
                    ? "settings-search-result active"
                    : "settings-search-result"
                }
                href={result.href}
                key={result.id}
                onClick={(event) => handleResultClick(event, result)}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => {
                  setActiveIndex(index);
                  onPrefetch(result.href);
                }}
                prefetch={false}
                ref={(element) => {
                  resultRefs.current[index] = element;
                }}
                role="option"
              >
                <span className="settings-search-result-path">
                  {result.group}
                </span>
                <strong>{result.title}</strong>
                <span>{result.description}</span>
              </Link>
            ))
          ) : (
            <div className="settings-search-empty" role="status">
              No matching settings found.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
