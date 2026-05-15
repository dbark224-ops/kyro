"use server";

import { createServerSupabaseClient } from "../../lib/supabase/server";
import { createWorkspaceBootstrap, getPrimaryWorkspace } from "../../lib/workspace/bootstrap";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithError(message: string): never {
  redirect(`/onboarding?error=${encodeURIComponent(message)}`);
}

export async function bootstrapWorkspaceAction(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const existingWorkspace = await getPrimaryWorkspace(supabase);

  if (existingWorkspace) {
    redirect("/");
  }

  const businessName = formString(formData, "businessName");
  const industry = formString(formData, "industry");
  const serviceArea = formString(formData, "serviceArea");

  if (!businessName) {
    redirectWithError("Business name is required.");
  }

  try {
    await createWorkspaceBootstrap(supabase, user, {
      businessName,
      industry,
      serviceArea
    });
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Workspace bootstrap failed.");
  }

  revalidatePath("/", "layout");
  redirect("/");
}
