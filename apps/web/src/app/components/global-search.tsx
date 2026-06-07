"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GlobalSearchResult = {
  description: string | null;
  href: string;
  id: string;
  label: string;
  meta: string;
  timestamp: string | null;
  type: string;
};

const SEARCH_CACHE = new Map<string, GlobalSearchResult[]>();
const SEARCH_CACHE_LIMIT = 30;

function pruneSearchCache() {
  while (SEARCH_CACHE.size > SEARCH_CACHE_LIMIT) {
    const oldestKey = SEARCH_CACHE.keys().next().value as string | undefined;

    if (!oldestKey) {
      return;
    }

    SEARCH_CACHE.delete(oldestKey);
  }
}

function resultDomId(id: string) {
  return `global-search-result-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function formatType(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length >= 2;
  const displayedResults = canSearch ? results : [];
  const displayedError = canSearch ? error : null;
  const displayedIsLoading = canSearch && isLoading;
  const selectedResult =
    selectedIndex >= 0 ? displayedResults[selectedIndex] : displayedResults[0];

  const navigateToResult = useCallback(
    (result: GlobalSearchResult | undefined) => {
      if (!result) {
        return;
      }

      setIsOpen(false);
      router.push(result.href);
    },
    [router],
  );

  useEffect(() => {
    if (!canSearch) {
      abortRef.current?.abort();
      setSelectedIndex(-1);
      return;
    }

    const cacheKey = trimmedQuery.toLowerCase();
    const cached = SEARCH_CACHE.get(cacheKey);
    const timeout = window.setTimeout(
      () => {
        if (cached) {
          setResults(cached);
          setError(null);
          setIsLoading(false);
          setIsOpen(true);
          return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);
        setError(null);

        fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`, {
          credentials: "same-origin",
          signal: controller.signal,
        })
          .then(async (response) => {
            const payload = (await response.json()) as {
              data?: GlobalSearchResult[];
              error?: string;
            };

            if (!response.ok) {
              throw new Error(payload.error ?? "Search failed.");
            }

            return payload.data ?? [];
          })
          .then((nextResults) => {
            SEARCH_CACHE.set(cacheKey, nextResults);
            pruneSearchCache();
            setResults(nextResults);
            setIsOpen(true);
          })
          .catch((searchError: unknown) => {
            if (searchError instanceof DOMException && searchError.name === "AbortError") {
              return;
            }

            setResults([]);
            setError(searchError instanceof Error ? searchError.message : "Search failed.");
            setIsOpen(true);
          })
          .finally(() => {
            if (abortRef.current === controller) {
              setIsLoading(false);
            }
          });
      },
      cached ? 0 : 180,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [canSearch, trimmedQuery]);

  useEffect(() => {
    if (!canSearch || displayedResults.length === 0) {
      setSelectedIndex(-1);
      return;
    }

    setSelectedIndex(0);
  }, [canSearch, displayedResults.length, trimmedQuery]);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      const isTyping =
        target?.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select";
      const isCommandK =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const isSlashFocus = event.key === "/" && !isTyping;

      if (!isCommandK && !isSlashFocus) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();

      if (canSearch) {
        setIsOpen(true);
      }
    }

    window.addEventListener("keydown", handleGlobalShortcut);

    return () => {
      window.removeEventListener("keydown", handleGlobalShortcut);
    };
  }, [canSearch]);

  const statusText = useMemo(() => {
    if (!canSearch) {
      return "Type at least 2 characters.";
    }

    if (displayedIsLoading) {
      return "Searching...";
    }

    if (displayedError) {
      return displayedError;
    }

    if (displayedResults.length === 0) {
      return "No matches found.";
    }

    return `${displayedResults.length} result${displayedResults.length === 1 ? "" : "s"}`;
  }, [canSearch, displayedError, displayedIsLoading, displayedResults.length]);

  return (
    <form
      className="global-search"
      onSubmit={(event) => {
        event.preventDefault();
        navigateToResult(selectedResult);
      }}
      role="search"
    >
      <label className="sr-only" htmlFor="global-workspace-search">
        Search Kyro
      </label>
      <div className="global-search-input-wrap">
        <span aria-hidden="true" className="global-search-symbol">
          /
        </span>
        <input
          autoComplete="off"
          aria-activedescendant={
            isOpen && selectedResult ? resultDomId(selectedResult.id) : undefined
          }
          aria-controls="global-search-results"
          aria-expanded={isOpen && canSearch}
          id="global-workspace-search"
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 120);
          }}
          onChange={(event) => {
            const nextQuery = event.target.value;

            setQuery(nextQuery);
            setIsOpen(nextQuery.trim().length >= 2);
          }}
          onFocus={() => {
            if (canSearch) {
              setIsOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();

              if (!isOpen) {
                setIsOpen(true);
              }

              setSelectedIndex((current) =>
                displayedResults.length > 0
                  ? (current + 1 + displayedResults.length) %
                    displayedResults.length
                  : -1,
              );
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();

              if (!isOpen) {
                setIsOpen(true);
              }

              setSelectedIndex((current) =>
                displayedResults.length > 0
                  ? (current - 1 + displayedResults.length) %
                    displayedResults.length
                  : -1,
              );
              return;
            }

            if (event.key === "Enter" && isOpen && selectedResult) {
              event.preventDefault();
              navigateToResult(selectedResult);
              return;
            }

            if (event.key === "Escape") {
              setIsOpen(false);
              event.currentTarget.blur();
            }
          }}
          placeholder="Search Kyro..."
          ref={inputRef}
          value={query}
        />
      </div>

      {isOpen && canSearch ? (
        <div className="global-search-results" id="global-search-results" role="listbox">
          <div className="global-search-status">{statusText}</div>
          {displayedResults.map((result, index) => {
            const timestamp = formatTimestamp(result.timestamp);
            const isSelected = index === selectedIndex;

            return (
              <Link
                aria-selected={isSelected}
                className={`global-search-result${isSelected ? " active" : ""}`}
                href={result.href}
                id={resultDomId(result.id)}
                key={result.id}
                onClick={() => setIsOpen(false)}
                onMouseEnter={() => setSelectedIndex(index)}
                role="option"
              >
                <span className="global-search-result-type">
                  {formatType(result.type)}
                </span>
                <span className="global-search-result-main">
                  <strong>{result.label}</strong>
                  {timestamp ? <small>{timestamp}</small> : null}
                </span>
                {result.meta ? (
                  <span className="global-search-result-meta">{result.meta}</span>
                ) : null}
                {result.description ? (
                  <span className="global-search-result-description">
                    {result.description}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </form>
  );
}
