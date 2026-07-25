"use server";

import { createServerSupabaseClient } from "../../lib/supabase/server";
import { createKyroUserBillingSetupUrl } from "../../lib/billing/kyro-user-billing";
import { createWorkspaceBootstrap, getPrimaryWorkspace } from "../../lib/workspace/bootstrap";
import { isOperatingCountry } from "../../lib/workspace/operating-countries";
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
  const country = formString(formData, "country");
  const industry = formString(formData, "industry");
  const postcode = formString(formData, "postcode");
  const serviceArea = formString(formData, "serviceArea");

  if (!businessName) {
    redirectWithError("Business name is required.");
  }

  if (!isOperatingCountry(country)) {
    redirectWithError("Choose the country this workspace operates in.");
  }

  let workspace;

  try {
    workspace = await createWorkspaceBootstrap(supabase, user, {
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

  let billingSetupUrl = "";

  try {
    billingSetupUrl = await createKyroUserBillingSetupUrl({
      cancelPath:
        "/settings?section=usage&panel=payment-method&engine_message=Billing%20setup%20cancelled.%20You%20can%20finish%20it%20here%20before%20your%20trial%20ends.",
      successPath:
        "/dashboard?engine_message=Billing%20method%20saved.%20Your%20two-week%20trial%20has%20started.",
      supabase,
      user,
      workspace,
    });
  } catch (error) {
    redirect(
      `/settings?section=usage&panel=payment-method&engine_error=${encodeURIComponent(
        error instanceof Error ? error.message : "Billing setup failed.",
      )}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(billingSetupUrl);
}
