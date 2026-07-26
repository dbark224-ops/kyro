import Link from "next/link";
import {
  formatDate,
  formatLabel,
} from "../shared";
import {
  type InboundEmailDecisionItem,
  type InboundEmailOperationalSummary,
  type InboundEmailSyncHistoryItem,
} from "../../../lib/integrations/inbound-email-settings";
/**
 * The inbound email operations section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function pluralCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function syncRunSummary(run: InboundEmailSyncHistoryItem) {
  const parts = [
    `${run.fetchedMessages} fetched`,
    `${run.promotedMessages} promoted`,
    `${run.observedMessages} observed`,
  ];

  if (run.duplicates > 0) {
    parts.push(pluralCount(run.duplicates, "duplicate"));
  }

  if (run.needsReconnect > 0) {
    parts.push(`${run.needsReconnect} reconnect`);
  }

  if (run.errors > 0) {
    parts.push(`${run.errors} error${run.errors === 1 ? "" : "s"}`);
  }

  if (run.skippedBySchedule > 0) {
    parts.push(`${run.skippedBySchedule} schedule skip`);
  }

  return parts.join(" - ");
}

export function syncRunTone(run: InboundEmailSyncHistoryItem) {
  if (run.errors > 0 || run.needsReconnect > 0) {
    return "warning";
  }

  if (run.promotedMessages > 0) {
    return "promoted";
  }

  return "observed";
}

export function inboundDecisionTone(decision: InboundEmailDecisionItem) {
  if (decision.stage === "promoted") {
    return "promoted";
  }

  if (decision.status !== "processed") {
    return "warning";
  }

  return "observed";
}

export function inboundDecisionLabel(decision: InboundEmailDecisionItem) {
  if (decision.stage === "promoted") {
    return "Promoted";
  }

  if (decision.category) {
    return formatLabel(decision.category);
  }

  return formatLabel(decision.status);
}

export function InboundEmailOperationsPanel({
  showTrace,
  summary,
  timeZone,
}: Readonly<{
  showTrace: boolean;
  summary: InboundEmailOperationalSummary;
  timeZone: string;
}>) {
  const recordCount = summary.syncRuns.length + summary.decisions.length;

  return (
    <section className="email-sync-ops-panel">
      <div className="panel-heading compact-panel-heading">
        <div>
          <p className="eyebrow">Inbound trace</p>
          <h3>Sync runs and decisions</h3>
          <p>Review recent polling and email-classification history.</p>
        </div>
        <div className="email-sync-ops-actions">
          <span className="pill">{recordCount} records</span>
          <Link
            className="secondary-button compact"
            href="/settings?section=integrations&inboundTrace=1"
          >
            Open trace log
          </Link>
        </div>
      </div>

      <div className="email-sync-ops-summary">
        <span>{summary.syncRuns.length} sync runs</span>
        <span>{summary.decisions.length} email decisions</span>
      </div>

      {showTrace ? (
        <InboundEmailTraceModal summary={summary} timeZone={timeZone} />
      ) : null}
    </section>
  );
}

export function InboundEmailTraceModal({
  summary,
  timeZone,
}: Readonly<{
  summary: InboundEmailOperationalSummary;
  timeZone: string;
}>) {
  const recordCount = summary.syncRuns.length + summary.decisions.length;

  return (
    <div className="sender-rules-modal-backdrop email-sync-ops-modal-backdrop">
      <section
        aria-labelledby="inbound-trace-title"
        aria-modal="true"
        className="sender-rules-modal email-sync-ops-modal"
        role="dialog"
      >
        <div className="sender-rules-modal-header">
          <div>
            <p className="eyebrow">Inbound trace</p>
            <h3 id="inbound-trace-title">Recent sync runs and decisions</h3>
            <p>
              Read-only operational history for polling runs and provider email
              classification decisions.
            </p>
          </div>
          <div className="sender-rules-modal-actions">
            <span className="pill">{recordCount} records</span>
            <Link
              className="secondary-button compact"
              href="/settings?section=integrations"
            >
              Close
            </Link>
          </div>
        </div>

        <div className="sender-rules-modal-body email-sync-ops-modal-body">
          <div className="email-sync-ops-grid">
            <article className="email-sync-ops-card">
              <div className="email-sync-ops-heading">
                <strong>Sync runs</strong>
                <span>Last {summary.syncRuns.length}</span>
              </div>
              {summary.syncRuns.length > 0 ? (
                <div className="email-sync-ops-list">
                  {summary.syncRuns.map((run) => (
                    <div className="email-sync-ops-row" key={run.id}>
                      <span className={`email-sync-dot ${syncRunTone(run)}`} />
                      <div>
                        <strong>{formatLabel(run.trigger)}</strong>
                        <span>{syncRunSummary(run)}</span>
                      </div>
                      <time dateTime={run.createdAt}>
                        {formatDate(run.createdAt, timeZone)}
                      </time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">No sync runs recorded yet.</p>
              )}
            </article>

            <article className="email-sync-ops-card">
              <div className="email-sync-ops-heading">
                <strong>Email decisions</strong>
                <span>Last {summary.decisions.length}</span>
              </div>
              {summary.decisions.length > 0 ? (
                <div className="email-sync-ops-list">
                  {summary.decisions.map((decision) => (
                    <div className="email-sync-ops-row" key={decision.id}>
                      <span
                        className={`email-sync-dot ${inboundDecisionTone(
                          decision,
                        )}`}
                      />
                      <div>
                        <strong>{decision.subject}</strong>
                        <span>
                          {inboundDecisionLabel(decision)} -{" "}
                          {decision.providerUsed
                            ? formatLabel(decision.providerUsed)
                            : "No classifier"}
                        </span>
                      </div>
                      <time
                        dateTime={decision.processedAt ?? decision.createdAt}
                      >
                        {formatDate(
                          decision.processedAt ?? decision.createdAt,
                          timeZone,
                        )}
                      </time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">
                  No inbound email decisions recorded yet.
                </p>
              )}
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
