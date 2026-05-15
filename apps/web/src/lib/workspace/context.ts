import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../supabase/server";
import { getPrimaryWorkspace } from "./bootstrap";

export async function requireWorkspaceContext() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    redirect("/onboarding");
  }

  return {
    supabase,
    user,
    workspace
  };
}

