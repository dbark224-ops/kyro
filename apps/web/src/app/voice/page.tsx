import { AppFrame } from "../components/app-frame";
import { getConversationWorkflowCounts } from "../../lib/crm/queries";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { VoiceConsole } from "./voice-console";
import type { AssistantThreadState } from "../../lib/assistant/types";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const [conversationCounts, readyQuotesResult, contactsResult] = await Promise.all([
    getConversationWorkflowCounts(supabase, workspace.id),
    supabase
      .from("quote_drafts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "ready"),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
  ]);

  if (readyQuotesResult.error) {
    throw new Error(`Unable to count ready quote drafts: ${readyQuotesResult.error.message}`);
  }

  if (contactsResult.error) {
    throw new Error(`Unable to count contacts: ${contactsResult.error.message}`);
  }

  const needsReply = conversationCounts.needsReply;
  const readyQuotes = readyQuotesResult.count ?? 0;
  const contactCount = contactsResult.count ?? 0;
  const initialState: AssistantThreadState = await getAssistantThreadState({
    supabase,
    user,
    welcomeMessage: {
      content:
        "Voice mode is ready. Hold the button, speak naturally, and Kyro will answer back using the same CRM context as the Assistant.",
      createdAt: new Date().toISOString(),
      id: "voice-welcome",
      role: "assistant",
    },
    workspace,
  });

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

        <VoiceConsole initialState={initialState} />
      </div>
    </AppFrame>
  );
}
