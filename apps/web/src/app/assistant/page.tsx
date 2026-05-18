import { AssistantConsole } from "./assistant-console";
import { AppFrame } from "../components/app-frame";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import { getAssistantRouteMetrics } from "../../lib/assistant/route-metrics";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import type { AssistantThreadState } from "../../lib/assistant/types";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const metricsPromise = getAssistantRouteMetrics(supabase, workspace.id);
  const threadStatePromise = getAssistantThreadState({
    supabase,
    user,
    workspace,
  });
  const [metrics, threadState] = await Promise.all([
    metricsPromise,
    threadStatePromise,
  ]);

  const { contactCount, needsReply, readyQuotes } = metrics;
  const welcomeMessage: AssistantThreadState["messages"][number] = {
    content:
      "I am connected to Kyro's CRM data and the assistant model. Ask me about work queue, quotes, customers, or creating a draft document.",
    createdAt: new Date().toISOString(),
    id: "assistant-welcome",
    links: [
      { href: "/inbox", label: "Inbox", meta: `${needsReply} need reply` },
      {
        href: "/documents",
        label: "Documents",
        meta: `${readyQuotes} ready quotes`,
      },
    ],
    role: "assistant",
  };
  const initialState: AssistantThreadState =
    threadState.messages.length > 0
      ? threadState
      : { ...threadState, messages: [welcomeMessage] };

  return (
    <AppFrame active="Assistant">
      <div className="assistant-page-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{workspace.name}</p>
            <h1>Assistant</h1>
          </div>
          <div className="topbar-right">
            <section
              className="metric-grid"
              aria-label="Assistant context metrics"
            >
              <article className="metric-card cyan">
                <p>Inbox</p>
                <strong>{needsReply}</strong>
                <span>Need reply</span>
              </article>
              <article className="metric-card purple">
                <p>Quotes</p>
                <strong>{readyQuotes}</strong>
                <span>Ready to send</span>
              </article>
              <article className="metric-card pink">
                <p>Contacts</p>
                <strong>{contactCount}</strong>
                <span>Profiles indexed</span>
              </article>
            </section>
          </div>
        </header>

        <section className="assistant-page-grid">
          <AssistantConsole initialState={initialState} />
        </section>
      </div>
    </AppFrame>
  );
}
