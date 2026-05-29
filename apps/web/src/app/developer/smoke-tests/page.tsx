import Link from "next/link";
import { AppFrame } from "../../components/app-frame";
import {
  type DeveloperHealthStatus,
  loadDeveloperSystemHealth,
  smokeChecksFromSystemHealth,
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
    return "Check first";
  }

  return "Blocked";
}

function overallStatus(statuses: DeveloperHealthStatus[]): DeveloperHealthStatus {
  if (statuses.includes("error")) {
    return "error";
  }

  if (statuses.includes("warning")) {
    return "warning";
  }

  return "ok";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export default async function SmokeTestsPage() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const health = await loadDeveloperSystemHealth({ supabase, user, workspace });
  const smokeChecks = smokeChecksFromSystemHealth(health);
  const status = overallStatus(smokeChecks.map((check) => check.status));

  return (
    <AppFrame active="Developer">
      <header className="topbar">
        <div>
          <p className="eyebrow">Developer</p>
          <h1>Smoke test checklist</h1>
        </div>
        <div className="row-actions">
          <Link className="secondary-button compact" href="/developer">
            Developer home
          </Link>
          <Link className="secondary-button compact" href="/developer/system-health">
            System health
          </Link>
        </div>
      </header>

      <section className="panel developer-smoke-intro">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Safe checks</p>
            <h2>{workspace.name}</h2>
          </div>
          <span className={`pill ${statusClass(status)}`}>{statusLabel(status)}</span>
        </div>
        <p className="panel-copy">
          This page is a builder runbook. It does not create records by itself;
          it checks whether the supporting tables, storage, providers, and cron
          seams are ready, then points you to the safest manual flow to test.
        </p>
        <div className="detail-list developer-smoke-meta">
          <div>
            <span>Generated</span>
            <strong>{formatDate(health.generatedAt)}</strong>
          </div>
          <div>
            <span>Private file bucket</span>
            <strong>{health.storageBucket}</strong>
          </div>
          <div>
            <span>Operational issues</span>
            <strong>{health.recentIssues.length}</strong>
          </div>
        </div>
      </section>

      <section className="developer-smoke-grid">
        {smokeChecks.map((check) => (
          <article className={`panel developer-smoke-card ${check.status}`} key={check.id}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Smoke test</p>
                <h2>{check.title}</h2>
              </div>
              <span className={`pill ${statusClass(check.status)}`}>
                {statusLabel(check.status)}
              </span>
            </div>
            <p className="panel-copy">{check.summary}</p>
            {check.detail ? <p className="empty-copy">{check.detail}</p> : null}
            <ol className="developer-smoke-steps">
              {check.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {check.href ? (
              <Link className="secondary-button compact link-button" href={check.href}>
                Open test surface
              </Link>
            ) : null}
          </article>
        ))}
      </section>
    </AppFrame>
  );
}
