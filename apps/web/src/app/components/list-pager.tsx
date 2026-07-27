import { SmartPrefetchLink } from "./smart-prefetch-link";

/**
 * Page back and forward, at the top of a list rather than the bottom.
 *
 * It used to sit under the rows, which put "Next" in the bottom-right corner
 * -- the same corner the Ask Kyro button floats in. On a full page of results
 * the control you need most was the one covered up.
 *
 * Arrows rather than "Previous" and "Next" because it now shares a row with
 * the search and sort controls, and two more word-buttons there read as three
 * competing actions instead of one quiet pager.
 *
 * Renders nothing for a single page: a pager that cannot page is furniture.
 */
export function ListPager({
  currentPage,
  hrefForPage,
  label,
  totalPages,
}: Readonly<{
  currentPage: number;
  hrefForPage: (page: number) => string;
  /** Names the list for screen readers, e.g. "Inbox". */
  label: string;
  totalPages: number;
}>) {
  if (totalPages <= 1) {
    return null;
  }

  const atStart = currentPage <= 1;
  const atEnd = currentPage >= totalPages;

  return (
    <nav aria-label={`${label} pagination`} className="list-pager">
      <SmartPrefetchLink
        aria-disabled={atStart}
        aria-label="Previous page"
        className={atStart ? "list-pager-step disabled" : "list-pager-step"}
        href={hrefForPage(Math.max(1, currentPage - 1))}
      >
        <span aria-hidden="true">&#8249;</span>
      </SmartPrefetchLink>
      <span className="list-pager-label">
        {currentPage} / {totalPages}
      </span>
      <SmartPrefetchLink
        aria-disabled={atEnd}
        aria-label="Next page"
        className={atEnd ? "list-pager-step disabled" : "list-pager-step"}
        href={hrefForPage(Math.min(totalPages, currentPage + 1))}
      >
        <span aria-hidden="true">&#8250;</span>
      </SmartPrefetchLink>
    </nav>
  );
}
