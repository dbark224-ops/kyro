import { AppFrame } from "../components/app-frame";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import { getAssistantRouteMetrics } from "../../lib/assistant/route-metrics";
import { getVapiInternalVoiceSession } from "../../lib/assistant/vapi-internal";
import type { AssistantThreadState } from "../../lib/assistant/types";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { VapiVoiceConsole } from "./vapi-voice-console";

export const dynamic = "force-dynamic";

type VapiVoicePageProps = {
  searchParams?: Promise<{
    contactId?: string;
    embed?: string;
    engine_error?: string;
    engine_message?: string;
  }>;
};

export default async function VapiVoicePage({ searchParams }: VapiVoicePageProps) {
  const query = await searchParams;
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
  const session = await getVapiInternalVoiceSession({
    supabase,
    threadState,
    user,
    workspace,
  });

  const { contactCount, needsReply, readyQuotes } = metrics;
  const welcomeMessage: AssistantThreadState["messages"][number] = {
    content:
      "Vapi voice mode is ready for testing. It uses the Vapi browser runtime while still saving turns into the main Kyro Assistant thread.",
    createdAt: new Date().toISOString(),
    id: "vapi-voice-welcome",
    model: "vapi-web",
    provider: "vapi",
    role: "assistant",
  };
  const initialState: AssistantThreadState =
    threadState.messages.length > 0
      ? threadState
      : { ...threadState, messages: [welcomeMessage] };

  const console = (
    <VapiVoiceConsole
      initialPreviewEngineError={query?.engine_error}
      initialPreviewEngineMessage={query?.engine_message}
      initialPreviewTarget={
        query?.contactId
          ? {
              href: `/contacts/${query.contactId}`,
              title: "Contact",
            }
          : null
      }
      initialState={initialState}
      session={session}
    />
  );

  if (query?.embed === "1") {
    return <div className="dashboard-vapi-embed-shell">{console}</div>;
  }

  return (
    <AppFrame active="Vapi Voice">
      <div className="voice-page-shell">
        <header className="topbar voice-topbar">
          <div>
            <p className="eyebrow">{workspace.name}</p>
            <h1>Vapi Voice</h1>
          </div>
          <div className="topbar-right">
            <section className="metric-grid" aria-label="Vapi voice context metrics">
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

        {console}
      </div>
    </AppFrame>
  );
}
