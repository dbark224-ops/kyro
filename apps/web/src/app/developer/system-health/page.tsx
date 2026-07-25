import Link from "next/link";
import { AppFrame } from "../../components/app-frame";
import {
  type DeveloperHealthCheck,
  type DeveloperHealthSection,
  type DeveloperHealthStatus,
  loadDeveloperSystemHealth,
} from "../../../lib/developer/system-health";
import { requireWorkspaceContext } from "../../../lib/workspace/context";

export const dynamic = "force-dynamic";

function statusClass(status: DeveloperHealthStatus) {
  return status === "ok" ? "success" : "warning";
}

function statusLabel(status: DeveloperHealthStatus) {
  if (status === "ok") {
    return "Ready";
  }

  if (status === "warning") {
    return "Check";
  }

  return "Action needed";
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function sectionStatus(section: DeveloperHealthSection): DeveloperHealthStatus {
  if (section.checks.some((check) => check.status === "error")) {
    return "error";
  }

  if (section.checks.some((check) => check.status === "warning")) {
    return "warning";
  }

  return "ok";
}

function countChecks(checks: DeveloperHealthCheck[]) {
  return checks.reduce(
    (current, check) => ({
      error: current.error + (check.status === "error" ? 1 : 0),
      ok: current.ok + (check.status === "ok" ? 1 : 0),
      warning: current.warning + (check.status === "warning" ? 1 : 0),
    }),
    { error: 0, ok: 0, warning: 0 },
  );
}

function HealthCheckRow({ check }: Readonly<{ check: DeveloperHealthCheck }>) {
  const content = (
    <>
      <span className={`developer-status-dot ${check.status}`} aria-hidden="true" />
      <div>
        <strong>{check.title}</strong>
        <span>{check.summary}</span>
        {check.detail ? <small>{check.detail}</small> : null}
      </div>
      <span className={`pill ${statusClass(check.status)}`}>
        {statusLabel(check.status)}
      </span>
    </>
  );

  if (check.href) {
    return (
      <Link className="developer-health-row link-row" href={check.href}>
        {content}
      </Link>
    );
  }

  return <div className="developer-health-row">{content}</div>;
}

export default async function SystemHealthPage() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const health = await loadDeveloperSystemHealth({ supabase, user, workspace });
  const allChecks = [
    ...health.sections.flatMap((section) => section.checks),
    ...health.tableChecks,
  ];
  const counts = countChecks(allChecks);

  return (
    <AppFrame active="Developer">
      <header className="topbar">
        <div>
          <p className="eyebrow">Developer</p>
          <h1>System health</h1>
        </div>
        <div className="row-actions">
          <Link className="secondary-button compact" href="/developer">
            Developer home
          </Link>
          <Link className="secondary-button compact" href="/developer/smoke-tests">
            Smoke tests
          </Link>
        </div>
      </header>

      <section className="outbox-summary-strip developer-health-summary">
        <div>
          <span>Ready</span>
          <strong>{counts.ok}</strong>
        </div>
        <div>
          <span>Check</span>
          <strong>{counts.warning}</strong>
        </div>
        <div>
          <span>Action needed</span>
          <strong>{counts.error}</strong>
        </div>
        <div>
          <span>Bucket</span>
          <strong>{health.storageBucket}</strong>
        </div>
      </section>

      <section className="developer-health-layout">
        <div className="developer-health-main">
          {health.sections.map((section) => {
            const status = sectionStatus(section);

            return (
              <article className="panel developer-health-card" key={section.id}>
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">{section.eyebrow}</p>
                    <h2>{section.title}</h2>
                  </div>
                  <span className={`pill ${statusClass(status)}`}>
                    {statusLabel(status)}
                  </span>
                </div>
                <div className="developer-health-list">
                  {section.checks.map((check) => (
                    <HealthCheckRow check={check} key={check.id} />
                  ))}
                </div>
              </article>
            );
          })}

          <article className="panel developer-health-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Supabase Data API</p>
                <h2>Required table checks</h2>
              </div>
              <span className="pill">{health.tableChecks.length} tables</span>
            </div>
            <div className="developer-table-checks">
              {health.tableChecks.map((check) => (
                <HealthCheckRow check={check} key={check.id} />
              ))}
            </div>
          </article>
        </div>

        <aside className="side-stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Workspace</p>
                <h2>{health.workspaceName}</h2>
              </div>
            </div>
            <div className="detail-list">
              <div>
                <span>Generated</span>
                <strong>{formatDate(health.generatedAt)}</strong>
              </div>
              <div>
                <span>Private storage bucket</span>
                <strong>{health.storageBucket}</strong>
              </div>
              <div>
                <span>Recent operational issues</span>
                <strong>{health.recentIssues.length}</strong>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Failures</p>
                <h2>Latest issues</h2>
              </div>
            </div>
            <div className="developer-issue-list">
              {health.recentIssues.length > 0 ? (
                health.recentIssues.map((issue) => {
                  const body = (
                    <>
                      <div>
                        <strong>{issue.title}</strong>
                        <span>{issue.context}</span>
                      </div>
                      <small>{issue.detail}</small>
                      <time>{formatDate(issue.occurredAt)}</time>
                    </>
                  );

                  return issue.href ? (
                    <Link className="developer-issue-row" href={issue.href} key={`${issue.title}-${issue.occurredAt}`}>
                      {body}
                    </Link>
                  ) : (
                    <div className="developer-issue-row" key={`${issue.title}-${issue.occurredAt}`}>
                      {body}
                    </div>
                  );
                })
              ) : (
                <p className="empty-copy">No failed outbox, event, action, or provider rows found.</p>
              )}
            </div>
          </article>
        </aside>
      </section>
    </AppFrame>
  );
}
