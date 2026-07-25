import { AppFrame } from "../../components/app-frame";
import {
  assistantToolRegistry,
  assistantToolRegistrySummary,
} from "../../../lib/assistant/tool-registry";

export const dynamic = "force-dynamic";

function formatLabel(value: string) {
  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AssistantToolsPage() {
  const summary = assistantToolRegistrySummary();

  return (
    <AppFrame active="Developer">
      <header className="topbar">
        <div>
          <p className="eyebrow">Assistant admin</p>
          <h1>Tool registry</h1>
        </div>
      </header>

      <section className="content-grid developer-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Review</p>
              <h2>Production tools and UI cards</h2>
            </div>
            <span className="pill">{summary.total} tools</span>
          </div>

          <div className="metric-grid compact">
            <article className="metric-card cyan">
              <p>Active</p>
              <strong>{summary.active}</strong>
              <span>Available now</span>
            </article>
            <article className="metric-card purple">
              <p>Approval</p>
              <strong>{summary.approval_gated}</strong>
              <span>User/policy gated</span>
            </article>
            <article className="metric-card pink">
              <p>Providers</p>
              <strong>{summary.provider_needed}</strong>
              <span>Needs integration</span>
            </article>
          </div>

          <div className="tool-registry-list">
            {assistantToolRegistry.map((tool) => (
              <article className="tool-registry-row" key={tool.id}>
                <div>
                  <p className="eyebrow">{tool.category}</p>
                  <h3>{tool.label}</h3>
                  <p>{tool.permission}</p>
                  <small>{tool.notes}</small>
                </div>
                <div className="tool-registry-meta">
                  <span>{tool.provider}</span>
                  <span>{formatLabel(tool.approval)}</span>
                  <span>{formatLabel(tool.risk)} risk</span>
                  <span className="pill">{formatLabel(tool.status)}</span>
                </div>
                <div className="tool-registry-tags">
                  <div className="module-list">
                    {tool.surfaces.map((surface) => (
                      <span key={surface}>{surface}</span>
                    ))}
                  </div>
                  <div className="module-list">
                    {tool.uiBlocks.length > 0 ? (
                      tool.uiBlocks.map((block) => (
                        <span key={block}>{block}</span>
                      ))
                    ) : (
                      <span>No UI block</span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </article>
      </section>
    </AppFrame>
  );
}
