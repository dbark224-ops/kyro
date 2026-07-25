import { DashboardConsole } from "./dashboard-console";
import { DashboardTour } from "./dashboard-tour";
import { AppFrame } from "../components/app-frame";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import type { AssistantThreadState } from "../../lib/assistant/types";
import { isKyroEmailVerified } from "../../lib/auth/email-verification";
import { getDashboardCommandCenterData } from "../../lib/dashboard/queries";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";

export const dynamic = "force-dynamic";

function buildWelcomeState(
  threadState: AssistantThreadState,
): AssistantThreadState {
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
  const generalSettings = await getWorkspaceGeneralSettings(
    supabase,
    workspace.id,
  );
  const [data, threadState] = await Promise.all([
    getDashboardCommandCenterData(
      supabase,
      workspace,
      generalSettings.timeZone,
    ),
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
        emailVerified={isKyroEmailVerified(user)}
        initialAssistantState={buildWelcomeState(threadState)}
        timeZone={generalSettings.timeZone}
        userEmail={user.email ?? ""}
      />
      <DashboardTour />
    </AppFrame>
  );
}
