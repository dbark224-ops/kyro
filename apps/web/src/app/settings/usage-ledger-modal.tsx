"use client";

import type { UsageLedgerRow } from "../../lib/usage/queries";
import {
  convertDisplayMoney,
  formatDisplayMoney,
  type DisplayCurrencySettings,
} from "../../lib/billing/display-currency";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function csvDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function usageLedgerCsv(
  rows: UsageLedgerRow[],
  displayCurrencySettings: DisplayCurrencySettings,
) {
  const headers = [
    "Created at",
    "User",
    "Task",
    "Usage type",
    "Provider",
    "Model",
    "Quantity",
    "Unit",
    "Display usage charge",
    "Display currency",
    "Stored usage charge",
    "Stored currency",
    "Display exchange rate",
    "Display rate provider",
    "Source",
    "Source detail",
    "Source path",
  ];
  const body = rows.map((row) => {
    const displayMoney = convertDisplayMoney(
      row.customerCharge,
      row.currency,
      displayCurrencySettings,
    );

    return [
      csvDate(row.createdAt),
      row.userName,
      row.taskLabel,
      formatLabel(row.usageType),
      row.provider,
      row.model,
      row.quantity,
      row.unit,
      displayMoney?.amount.toFixed(8) ?? "",
      displayMoney?.currency ?? "",
      row.customerCharge.toFixed(8),
      row.currency,
      displayMoney?.exchangeRate.toFixed(8) ?? "",
      displayCurrencySettings.exchangeRateProvider,
      row.sourceLabel,
      row.sourceMeta ?? "",
      row.sourceHref ?? "",
    ]
      .map(csvCell)
      .join(",");
  });

  return [headers.map(csvCell).join(","), ...body].join("\n");
}

function usageLedgerFilename() {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");

  return `kyro-usage-ledger-${stamp}.csv`;
}

export function UsageLedgerModal({
  displayCurrencySettings,
  rows,
}: Readonly<{
  displayCurrencySettings: DisplayCurrencySettings;
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

  const handleExportCsv = () => {
    const blob = new Blob(["\ufeff", usageLedgerCsv(rows, displayCurrencySettings)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = usageLedgerFilename();
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

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
              <div className="usage-ledger-modal-actions">
                <button
                  className="usage-ledger-export-button"
                  disabled={rows.length === 0}
                  onClick={handleExportCsv}
                  type="button"
                >
                  Export CSV
                </button>
                <button
                  className="settings-close-button"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
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
                        {formatDisplayMoney(
                          row.customerCharge,
                          row.currency,
                          displayCurrencySettings,
                        )}
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
