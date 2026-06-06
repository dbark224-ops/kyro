import { AppFrame } from "../components/app-frame";
import {
  REPORT_CHANNELS,
  REPORT_DIRECTIONS,
  REPORT_TIMEFRAMES,
  REPORT_TYPES,
  buildWorkspaceReport,
  getReportContactOptions,
  parseReportFilters,
  reportSearchParams,
} from "../../lib/reports/data";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import Link from "next/link";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function dateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  return value;
}

function reportTypeDescription(value: string) {
  return (
    REPORT_TYPES.find((reportType) => reportType.value === value)?.description ??
    ""
  );
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const filters = parseReportFilters(query);
  const [contacts, report] = await Promise.all([
    getReportContactOptions(supabase, workspace.id),
    buildWorkspaceReport(supabase, workspace, filters),
  ]);
  const previewParams = reportSearchParams(filters).toString();
  const printHref = `/reports/print?${previewParams}`;
  const pdfHref = `/reports/pdf?${previewParams}`;

  return (
    <AppFrame active="Reports">
      <header className="topbar page-topbar-tight reports-topbar">
        <div>
          <h1>Reports</h1>
        </div>
        <div className="topbar-right">
          <section className="metric-grid" aria-label="Report metrics">
            <article className="metric-card cyan">
              <p>Reports</p>
              <strong>{REPORT_TYPES.length}</strong>
              <span>Available</span>
            </article>
            <article className="metric-card purple">
              <p>Rows</p>
              <strong>
                {report.sections.reduce(
                  (total, section) => total + section.rows.length,
                  0,
                )}
              </strong>
              <span>In preview</span>
            </article>
            <article className="metric-card pink">
              <p>Period</p>
              <strong>{report.period.label.split(" ")[0]}</strong>
              <span>{report.period.label}</span>
            </article>
          </section>
        </div>
      </header>

      <section className="reports-workspace">
        <aside className="reports-control-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Report builder</p>
              <h2>Choose data and timeframe</h2>
            </div>
          </div>

          <form className="reports-form" action="/reports">
            <label>
              <span>Report</span>
              <select name="type" defaultValue={filters.type}>
                {REPORT_TYPES.map((reportType) => (
                  <option key={reportType.value} value={reportType.value}>
                    {reportType.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="reports-hint">
              {reportTypeDescription(filters.type)}
            </p>

            <label>
              <span>Timeframe</span>
              <select name="timeframe" defaultValue={filters.timeframe}>
                {REPORT_TIMEFRAMES.map((timeframe) => (
                  <option key={timeframe.value} value={timeframe.value}>
                    {timeframe.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="reports-date-grid">
              <label>
                <span>Start date</span>
                <input
                  name="start"
                  type="date"
                  defaultValue={dateInputValue(filters.start)}
                />
              </label>
              <label>
                <span>End date</span>
                <input
                  name="end"
                  type="date"
                  defaultValue={dateInputValue(filters.end)}
                />
              </label>
            </div>

            <label>
              <span>Contact</span>
              <select name="contactId" defaultValue={filters.contactId ?? ""}>
                <option value="">All contacts</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name ??
                      contact.company ??
                      contact.email ??
                      contact.phone ??
                      "Unnamed contact"}
                  </option>
                ))}
              </select>
            </label>

            <div className="reports-date-grid">
              <label>
                <span>Direction</span>
                <select name="direction" defaultValue={filters.direction}>
                  {REPORT_DIRECTIONS.map((direction) => (
                    <option key={direction.value} value={direction.value}>
                      {direction.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Channel</span>
                <select name="channel" defaultValue={filters.channel}>
                  {REPORT_CHANNELS.map((channel) => (
                    <option key={channel.value} value={channel.value}>
                      {channel.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button className="primary-button full-width" type="submit">
              Generate report
            </button>
          </form>

          <div className="reports-suggestions">
            <p className="eyebrow">Useful report types</p>
            {REPORT_TYPES.slice(0, 5).map((reportType) => (
              <Link
                href={`/reports?${reportSearchParams({
                  ...filters,
                  type: reportType.value,
                }).toString()}`}
                key={reportType.value}
                prefetch={false}
              >
                <strong>{reportType.label}</strong>
                <span>{reportType.description}</span>
              </Link>
            ))}
          </div>
        </aside>

        <article className="reports-preview-panel">
          <div className="reports-preview-header">
            <div>
              <p className="eyebrow">PDF preview</p>
              <h2>{report.title}</h2>
              <span>{report.subtitle}</span>
            </div>
            <div className="reports-preview-actions">
              <Link
                className="secondary-button compact"
                href={printHref}
                target="_blank"
                prefetch={false}
              >
                Print
              </Link>
              <Link
                className="secondary-button compact"
                href={pdfHref}
                prefetch={false}
              >
                Download PDF
              </Link>
            </div>
          </div>

          <div className="reports-summary-grid">
            {report.summaryCards.map((card) => (
              <div className="reports-summary-card" key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                {card.detail ? <small>{card.detail}</small> : null}
              </div>
            ))}
          </div>

          <iframe
            className="reports-preview-frame"
            src={printHref}
            title={`${report.title} preview`}
          />
        </article>
      </section>
    </AppFrame>
  );
}
