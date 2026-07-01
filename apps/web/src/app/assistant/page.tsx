import { AssistantConsole } from "./assistant-console";
import { AppFrame } from "../components/app-frame";
import { getAssistantExternalActivity } from "../../lib/assistant/external-activity";
import { getAssistantPromptSuggestionState } from "../../lib/assistant/prompt-suggestions";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import { getAssistantRouteMetrics } from "../../lib/assistant/route-metrics";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { getContactProfile } from "../../lib/crm/queries";
import { developerAccessEnabled } from "../../lib/auth/developer-access";
import type {
  AssistantResourcePreview,
  AssistantThreadState,
} from "../../lib/assistant/types";

export const dynamic = "force-dynamic";

type AssistantPageProps = {
  searchParams?: Promise<{
    contactId?: string;
    engine_error?: string;
    engine_message?: string;
    threadId?: string;
  }>;
};

function profileTitle(
  profile: Extract<AssistantResourcePreview, { type: "contact" }>["profile"],
) {
  return (
    profile.contact.name ??
    profile.contact.company ??
    profile.contact.email ??
    profile.contact.phone ??
    "Contact"
  );
}

export default async function AssistantPage({
  searchParams,
}: AssistantPageProps) {
  const query = await searchParams;
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const activityPromise = getAssistantExternalActivity(supabase, workspace.id);
  const metricsPromise = getAssistantRouteMetrics(supabase, workspace.id);
  const promptSuggestionsPromise = getAssistantPromptSuggestionState({
    supabase,
    userId: user.id,
    workspaceId: workspace.id,
  });
  const selectedContactId = query?.contactId?.trim() ?? "";
  const selectedContactProfilePromise = selectedContactId
    ? getContactProfile(supabase, workspace.id, selectedContactId)
    : Promise.resolve(null);
  const threadStatePromise = getAssistantThreadState({
    threadId: query?.threadId,
    supabase,
    user,
    workspace,
  });
  const [
    activityItems,
    metrics,
    promptSuggestions,
    selectedContactProfile,
    threadState,
  ] =
    await Promise.all([
      activityPromise,
      metricsPromise,
      promptSuggestionsPromise,
      selectedContactProfilePromise,
      threadStatePromise,
    ]);

  const { contactCount, needsReply, readyQuotes } = metrics;
  const welcomeMessage: AssistantThreadState["messages"][number] = {
    content:
      "I am connected to Kyro's CRM data, help manual, and assistant model. Ask me about the work queue, quotes, customers, settings, or how to use Kyro.",
    createdAt: new Date().toISOString(),
    id: "assistant-welcome",
    links: [
      { href: "/inbox", label: "Inbox", meta: `${needsReply} need reply` },
      {
        href: "/files",
        label: "Files",
        meta: `${readyQuotes} ready quotes`,
      },
    ],
    role: "assistant",
  };
  const initialState: AssistantThreadState =
    threadState.messages.length > 0
      ? threadState
      : { ...threadState, messages: [welcomeMessage] };
  const initialPreview: AssistantResourcePreview | null = selectedContactProfile
    ? {
        href: `/contacts/${selectedContactProfile.contact.id}`,
        profile: selectedContactProfile,
        title: profileTitle(selectedContactProfile),
        type: "contact",
      }
    : null;

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
          <AssistantConsole
            externalActivityItems={activityItems}
            initialPreviewEngineError={query?.engine_error}
            initialPreviewEngineMessage={query?.engine_message}
            initialPreview={initialPreview}
            initialState={initialState}
            isDeveloperAccount={developerAccessEnabled(user)}
            promptSuggestions={promptSuggestions.visibleSuggestions}
          />
        </section>
      </div>
    </AppFrame>
  );
}
