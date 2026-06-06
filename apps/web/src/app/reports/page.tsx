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

function hasReportGenerationRequest(
  query: Record<string, string | string[] | undefined> | undefined,
) {
  return Boolean(query?.generate);
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const filters = parseReportFilters(query);
  const shouldGenerateReport = hasReportGenerationRequest(query);
  const [contacts, report] = await Promise.all([
    getReportContactOptions(supabase, workspace.id),
    shouldGenerateReport
      ? buildWorkspaceReport(supabase, workspace, filters)
      : Promise.resolve(null),
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
      </header>

      <section className="reports-workspace">
        <section className="reports-control-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Report builder</p>
              <h2>Choose data and timeframe</h2>
            </div>
          </div>

          <form className="reports-form" action="/reports">
            <input name="generate" type="hidden" value="1" />

            <label className="reports-form-field wide">
              <span>Report</span>
              <select name="type" defaultValue={filters.type}>
                {REPORT_TYPES.map((reportType) => (
                  <option key={reportType.value} value={reportType.value}>
                    {reportType.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="reports-form-field">
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

            <label className="reports-form-field wide">
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

            <button className="primary-button reports-generate-button" type="submit">
              Generate report
            </button>

            <p className="reports-hint wide">
              {reportTypeDescription(filters.type)}
            </p>
          </form>
        </section>

        {report ? (
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
        ) : null}
      </section>
    </AppFrame>
  );
}
