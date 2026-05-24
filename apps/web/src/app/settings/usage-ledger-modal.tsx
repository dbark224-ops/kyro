"use client";

import type { UsageLedgerRow } from "../../lib/usage/queries";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatMoney(value: number, currency: string) {
  const maximumFractionDigits =
    Math.abs(value) > 0 && Math.abs(value) < 1 ? 6 : 2;

  return new Intl.NumberFormat("en", {
    currency,
    maximumFractionDigits,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function UsageLedgerModal({
  rows,
}: Readonly<{
  rows: UsageLedgerRow[];
}>) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        className="usage-ledger-open-button"
        disabled={rows.length === 0}
        onClick={() => setOpen(true)}
        type="button"
      >
        View usage ledger
        <span>({rows.length} events)</span>
      </button>

      {open ? (
        <div
          className="usage-ledger-modal-backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className="usage-ledger-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="usage-ledger-modal-header">
              <div>
                <p className="eyebrow">Ledger</p>
                <h2 id={titleId}>Usage events</h2>
                <p>
                  A detailed event log for billing exports and invoice checks.
                </p>
              </div>
              <button
                className="settings-close-button"
                onClick={() => setOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            {rows.length > 0 ? (
              <div className="usage-ledger-modal-list">
                {rows.map((row) => (
                  <article className="usage-ledger-row" key={row.id}>
                    <div className="usage-ledger-main">
                      {row.sourceHref ? (
                        <Link href={row.sourceHref} prefetch={false}>
                          {row.sourceLabel}
                        </Link>
                      ) : (
                        <strong>{row.sourceLabel}</strong>
                      )}
                      <span>
                        {row.taskLabel} - {formatLabel(row.usageType)}
                      </span>
                      {row.sourceMeta ? <p>{row.sourceMeta}</p> : null}
                    </div>
                    <div className="usage-ledger-meta">
                      <span>{row.userName}</span>
                      <span>
                        {formatNumber(row.quantity)} {row.unit}
                      </span>
                      <strong>
                        {formatMoney(row.customerCharge, row.currency)}
                      </strong>
                      <time>{formatDateTime(row.createdAt)}</time>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-copy">
                No usage events have been recorded for this range.
              </p>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
