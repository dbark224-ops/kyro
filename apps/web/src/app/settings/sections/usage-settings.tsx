import Link from "next/link";
import {
  InfoBubble,
} from "../info-bubble";
import {
  UsageLedgerModal,
} from "../usage-ledger-modal";
import {
  formatLabel,
} from "../shared";
import {
  type DisplayCurrencySettings,
  formatDisplayMoney,
} from "../../../lib/billing/display-currency";
import {
  type UsageBreakdownRow,
  type UsageReport,
  usageWindows,
} from "../../../lib/usage/queries";
import {
  usageWindowHref,
} from "../settings-navigation";
/**
 * The Usage section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function modelUsageDescription(row: UsageBreakdownRow) {
  const model = row.model.toLowerCase();
  const service = row.service.toLowerCase();

  if (service === "realtime" || model.includes("realtime")) {
    return "Used for Kyro's live voice assistant: low-latency spoken conversations, audio/text tokens, cached context, and voice tool calls.";
  }

  if (
    service === "speech_to_text" ||
    model.includes("transcribe") ||
    model.includes("whisper")
  ) {
    return "Used when Kyro turns recorded or uploaded audio into text before it can answer or take action.";
  }

  if (service === "text_to_speech" || model.includes("tts")) {
    return "Used for generated voice playback and pronunciation previews when Kyro reads text aloud outside the live realtime session.";
  }

  if (service === "web_search") {
    return "Used when Kyro searches the internet to answer with current information. Search calls can also add model-token cost when result content is used.";
  }

  if (model.includes("gpt-5.6") || model.includes("gpt-5")) {
    return "Kyro's OpenAI reasoning model family for assistant replies, settings help, email drafting, document/template edits, classification, and tool-aware work.";
  }

  if (model.includes("gpt-4.1")) {
    return "Kyro's older OpenAI text model family for assistant replies, drafting, classification, and tool-aware work.";
  }

  if (model === "n/a") {
    return "This is a provider or delivery event rather than a model-generated AI response.";
  }

  return "Used for AI work routed through this provider/model. The task breakdown above shows what business activity created the charge.";
}

export function UsageSettingsDetail({
  activeWindow,
  displayCurrencySettings,
  usageReport,
}: Readonly<{
  activeWindow: string;
  displayCurrencySettings: DisplayCurrencySettings;
  usageReport: UsageReport;
}>) {
  return (
    <>
      <section className="usage-summary-strip" aria-label="Usage metrics">
        <nav
          className="filter-bar usage-window-filter"
          aria-label="Usage date range"
        >
          {usageWindows.map((window) => (
            <Link
              className={
                activeWindow === window.value
                  ? "filter-pill active"
                  : "filter-pill"
              }
              href={usageWindowHref(window.value)}
              key={window.value}
              prefetch={false}
            >
              {window.label}
            </Link>
          ))}
        </nav>
        <div className="usage-summary-actions">
          <div className="usage-charge-summary">
            <span>Usage charge</span>
            <strong>
              {formatDisplayMoney(
                usageReport.totals.customerCharge,
                usageReport.totals.currency,
                displayCurrencySettings,
              )}
            </strong>
          </div>
          <UsageLedgerModal
            displayCurrencySettings={displayCurrencySettings}
            rows={usageReport.ledger}
          />
        </div>
      </section>

      <div className="usage-grid compact">
        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Breakdown</p>
              <h2>Usage by task</h2>
            </div>
          </div>
          {usageReport.taskBreakdown.length > 0 ? (
            <div className="usage-table">
              <div
                className="usage-row usage-row-three heading"
                aria-hidden="true"
              >
                <span>Task</span>
                <span>Events</span>
                <span>Usage charge</span>
              </div>
              {usageReport.taskBreakdown.map((row) => (
                <div className="usage-row usage-row-three" key={row.key}>
                  <div className="usage-breakdown-copy">
                    <strong>{row.label}</strong>
                    <span>{row.description}</span>
                  </div>
                  <span>{row.events}</span>
                  <span>
                    {formatDisplayMoney(
                      row.customerCharge,
                      row.currency,
                      displayCurrencySettings,
                    )}
                  </span>
                </div>
              ))}
              <div className="usage-row usage-row-three usage-total-row">
                <div className="usage-breakdown-copy">
                  <strong>Total</strong>
                  <span>All metered task usage in this range.</span>
                </div>
                <span>{usageReport.totals.events}</span>
                <span>
                  {formatDisplayMoney(
                    usageReport.totals.customerCharge,
                    usageReport.totals.currency,
                    displayCurrencySettings,
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="empty-copy">
              No metered usage in this date range yet.
            </p>
          )}
        </article>

        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Technical breakdown</p>
              <h2>Provider and model</h2>
            </div>
          </div>
          {usageReport.providerBreakdown.length > 0 ? (
            <div className="usage-table">
              <div
                className="usage-row usage-row-three heading"
                aria-hidden="true"
              >
                <span>Provider / model</span>
                <span>Events</span>
                <span>Usage charge</span>
              </div>
              {usageReport.providerBreakdown.map((row) => (
                <div className="usage-row usage-row-three" key={row.key}>
                  <div>
                    <span className="usage-breakdown-info-title">
                      <strong>
                        {row.model === "n/a"
                          ? row.provider
                          : `${row.provider} / ${row.model}`}
                      </strong>
                      <InfoBubble
                        label={`What ${row.model === "n/a" ? row.provider : row.model} is used for`}
                      >
                        {modelUsageDescription(row)}
                      </InfoBubble>
                    </span>
                    <span>{formatLabel(row.service)}</span>
                  </div>
                  <span>{row.events}</span>
                  <span>
                    {formatDisplayMoney(
                      row.customerCharge,
                      row.currency,
                      displayCurrencySettings,
                    )}
                  </span>
                </div>
              ))}
              <div className="usage-row usage-row-three usage-total-row">
                <div className="usage-breakdown-copy">
                  <strong>Total</strong>
                  <span>All provider and model usage in this range.</span>
                </div>
                <span>{usageReport.totals.events}</span>
                <span>
                  {formatDisplayMoney(
                    usageReport.totals.customerCharge,
                    usageReport.totals.currency,
                    displayCurrencySettings,
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="empty-copy">
              No metered usage in this date range yet.
            </p>
          )}
        </article>
      </div>
    </>
  );
}
