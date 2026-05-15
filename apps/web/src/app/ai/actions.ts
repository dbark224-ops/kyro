"use server";

import { runStubAiTriage } from "../../lib/ai/triage";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function redirectWithAiError(message: string): never {
  redirect(`/?engine_error=${encodeURIComponent(message)}`);
}

export async function runStubAiTriageAction() {
  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    await runStubAiTriage(supabase, user, workspace.id);
  } catch (error) {
    redirectWithAiError(error instanceof Error ? error.message : "Unable to run AI triage.");
  }

  revalidatePath("/");
  redirect("/?engine_message=AI triage recorded route, run, usage, action, and audit logs.");
}

