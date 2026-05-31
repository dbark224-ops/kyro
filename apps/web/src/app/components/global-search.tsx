"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const abortRef = useRef<AbortController | null>(null);
  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length >= 2;
  const displayedResults = canSearch ? results : [];
  const displayedError = canSearch ? error : null;
  const displayedIsLoading = canSearch && isLoading;
  const firstHref = displayedResults[0]?.href;

  useEffect(() => {
    if (!canSearch) {
      abortRef.current?.abort();
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

        if (firstHref) {
          setIsOpen(false);
          router.push(firstHref);
        }
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
            if (event.key === "Escape") {
              setIsOpen(false);
              event.currentTarget.blur();
            }
          }}
          placeholder="Search Kyro..."
          value={query}
        />
      </div>

      {isOpen && canSearch ? (
        <div className="global-search-results">
          <div className="global-search-status">{statusText}</div>
          {displayedResults.map((result) => {
            const timestamp = formatTimestamp(result.timestamp);

            return (
              <Link
                className="global-search-result"
                href={result.href}
                key={result.id}
                onClick={() => setIsOpen(false)}
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
