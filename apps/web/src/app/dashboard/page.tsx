import { DashboardConsole } from "./dashboard-console";
import { AppFrame } from "../components/app-frame";
import { getAssistantPromptSuggestionState } from "../../lib/assistant/prompt-suggestions";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import type { AssistantThreadState } from "../../lib/assistant/types";
import { getDashboardCommandCenterData } from "../../lib/dashboard/queries";
import { requireWorkspaceContext } from "../../lib/workspace/context";

export const dynamic = "force-dynamic";

function buildWelcomeState(threadState: AssistantThreadState): AssistantThreadState {
  if (threadState.messages.length > 0) {
    return threadState;
  }

  return {
    ...threadState,
    messages: [
      {
        content:
          "Good morning. I can help with work queue triage, contacts, documents, settings, and quick CRM lookups directly from the dashboard.",
        createdAt: new Date().toISOString(),
        id: "dashboard-assistant-welcome",
        role: "assistant",
      },
    ],
  };
}

export default async function DashboardPage() {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const [data, promptSuggestions, threadState] = await Promise.all([
    getDashboardCommandCenterData(supabase, workspace),
    getAssistantPromptSuggestionState({
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    }),
    getAssistantThreadState({
      supabase,
      user,
      workspace,
    }),
  ]);

  return (
    <AppFrame active="Dashboard">
      <DashboardConsole
        data={data}
        initialAssistantState={buildWelcomeState(threadState)}
        promptSuggestions={promptSuggestions.visibleSuggestions}
      />
    </AppFrame>
  );
}
