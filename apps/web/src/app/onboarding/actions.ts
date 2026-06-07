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
    redirect("/dashboard");
  }

  const businessName = formString(formData, "businessName");
  const businessLocation = formString(formData, "businessLocation");
  const country = formString(formData, "country") || "Australia";
  const industry = formString(formData, "industry");
  const postcode = formString(formData, "postcode");
  const serviceArea = formString(formData, "serviceArea");

  if (!businessName) {
    redirectWithError("Business name is required.");
  }

  try {
    await createWorkspaceBootstrap(supabase, user, {
      businessLocation,
      businessName,
      country,
      industry,
      postcode,
      publicEmail: user.email ?? undefined,
      serviceArea
    });
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Workspace bootstrap failed.");
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
