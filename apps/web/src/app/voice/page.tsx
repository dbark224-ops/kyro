import { AppFrame } from "../components/app-frame";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import { getAssistantRouteMetrics } from "../../lib/assistant/route-metrics";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { RealtimeVoiceConsole } from "./realtime-voice-console";
import type { AssistantThreadState } from "../../lib/assistant/types";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
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
      "Realtime voice mode is ready. Tap the mic, speak naturally, and Kyro will answer using the same CRM context as the Assistant.",
    createdAt: new Date().toISOString(),
    id: "voice-welcome",
    role: "assistant",
  };
  const initialState: AssistantThreadState =
    threadState.messages.length > 0
      ? threadState
      : { ...threadState, messages: [welcomeMessage] };

  return (
    <AppFrame active="Voice">
      <div className="voice-page-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{workspace.name}</p>
            <h1>Voice</h1>
          </div>
          <div className="topbar-right">
            <section className="metric-grid" aria-label="Voice context metrics">
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

        <RealtimeVoiceConsole initialState={initialState} />
      </div>
    </AppFrame>
  );
}
