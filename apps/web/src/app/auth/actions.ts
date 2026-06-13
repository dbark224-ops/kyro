"use server";

import { createServerSupabaseClient } from "../../lib/supabase/server";
import { createWorkspaceBootstrap } from "../../lib/workspace/bootstrap";
import { isOperatingCountry } from "../../lib/workspace/operating-countries";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function safeRedirectPath(path: string, fallback: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }

  return path;
}

export async function signInAction(formData: FormData) {
  const email = formString(formData, "email");
  const password = formString(formData, "password");

  if (!email || !password) {
    redirectWithError("/sign-in", "Email and password are required.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirectWithError("/sign-in", error.message);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUpAction(formData: FormData) {
  const email = formString(formData, "email");
  const confirmEmail = formString(formData, "confirmEmail");
  const password = formString(formData, "password");
  const confirmPassword = formString(formData, "confirmPassword");
  const name = formString(formData, "name");
  const mobileNumber = formString(formData, "mobileNumber");
  const businessName = formString(formData, "businessName");
  const businessLocation = formString(formData, "businessLocation");
  const country = formString(formData, "country");
  const industry = formString(formData, "industry");
  const postcode = formString(formData, "postcode");
  const serviceArea = formString(formData, "serviceArea");
  const trialAcknowledged = formString(formData, "trialAcknowledged");
  const failurePath = safeRedirectPath(
    formString(formData, "failurePath"),
    "/sign-in",
  );

  if (!email || !confirmEmail || !password) {
    redirectWithError(failurePath, "Email and password are required.");
  }

  if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
    redirectWithError(failurePath, "Email addresses must match.");
  }

  if (password !== confirmPassword) {
    redirectWithError(failurePath, "Passwords must match.");
  }

  if (!name) {
    redirectWithError(failurePath, "Your name is required.");
  }

  if (!mobileNumber) {
    redirectWithError(failurePath, "Mobile number is required.");
  }

  if (!businessName || !industry || !businessLocation) {
    redirectWithError(
      failurePath,
      "Business name, industry, and location are required.",
    );
  }

  if (trialAcknowledged !== "yes") {
    redirectWithError(
      failurePath,
      "Confirm the two-week trial and billing acknowledgement to continue.",
    );
  }

  if (!isOperatingCountry(country)) {
    redirectWithError(
      failurePath,
      "Choose the country this workspace operates in.",
    );
  }

  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        kyroBusinessCountry: country,
        kyroBusinessLocation: businessLocation,
        kyroBusinessName: businessName,
        kyroBusinessPostcode: postcode,
        kyroBusinessServiceArea: serviceArea,
        kyroMobileNumber: mobileNumber,
        kyroIndustry: industry,
        kyroTrialAcknowledgedAt: new Date().toISOString(),
        name,
        phone: mobileNumber,
      },
      emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
    },
  });

  if (error) {
    redirectWithError(failurePath, error.message);
  }

  if (data.session && data.user) {
    try {
      await createWorkspaceBootstrap(supabase, data.user, {
        businessLocation,
        businessName,
        country,
        industry,
        postcode,
        publicEmail: email,
        publicPhoneNumber: mobileNumber,
        serviceArea,
      });
    } catch (bootstrapError) {
      redirectWithError(
        failurePath,
        bootstrapError instanceof Error
          ? bootstrapError.message
          : "Workspace setup failed.",
      );
    }
  } else {
    redirect(
      `/sign-in?message=${encodeURIComponent(
        "Check your email to finish creating your Kyro workspace.",
      )}`,
    );
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
