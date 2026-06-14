"use server";

import { createServerSupabaseClient } from "../../lib/supabase/server";
import { createServiceSupabaseClient } from "../../lib/supabase/service";
import { createKyroUserBillingSetupUrl } from "../../lib/billing/kyro-user-billing";
import {
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
} from "../../lib/crm/identity";
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

function friendlySignupError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Kyro has temporarily hit the verification email limit for this address. Check your inbox first, or wait a few minutes before trying again.";
  }

  if (
    normalized.includes("already") ||
    normalized.includes("registered") ||
    normalized.includes("exists")
  ) {
    return "That email is already attached to a Kyro account. Sign in instead, or use a different email.";
  }

  return message;
}

function safeRedirectPath(path: string, fallback: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }

  return path;
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function signupPhoneCandidates(user: {
  phone?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  return [
    user.phone ?? "",
    metadataString(user.user_metadata, "kyroMobileNumber"),
    metadataString(user.user_metadata, "phone"),
    metadataString(user.user_metadata, "mobileNumber"),
    metadataString(user.user_metadata, "mobile"),
    metadataString(user.user_metadata, "publicPhoneNumber"),
  ].filter(Boolean);
}

async function verifySignupIdentityAvailable(input: {
  country: string;
  email: string;
  failurePath: string;
  mobileNumber: string;
}) {
  const normalizedEmail = normalizeContactEmail(input.email);
  const normalizedPhone = normalizeContactPhoneForRegion(
    input.mobileNumber,
    input.country,
  );

  if (!normalizedEmail) {
    redirectWithError(input.failurePath, "Enter a valid email address.");
  }

  if (!normalizedPhone) {
    redirectWithError(input.failurePath, "Enter a valid mobile number.");
  }

  let serviceSupabase;

  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch {
    redirectWithError(
      input.failurePath,
      "Kyro could not verify account details right now. Please try again shortly.",
    );
  }

  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await serviceSupabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      redirectWithError(
        input.failurePath,
        "Kyro could not verify account details right now. Please try again shortly.",
      );
    }

    const users = data.users ?? [];

    for (const user of users) {
      const existingEmail = normalizeContactEmail(user.email);

      if (existingEmail && existingEmail === normalizedEmail) {
        redirectWithError(
          input.failurePath,
          "That email is already attached to a Kyro account. Sign in instead, or use a different email.",
        );
      }

      const phoneMatch = signupPhoneCandidates(user).some((candidate) => {
        const normalizedCandidate = normalizeContactPhoneForRegion(
          candidate,
          input.country,
        );
        return normalizedCandidate === normalizedPhone;
      });

      if (phoneMatch) {
        redirectWithError(
          input.failurePath,
          "That mobile number is already attached to a Kyro account. Use a different number, or contact support if this is your account.",
        );
      }
    }

    if (users.length < perPage) {
      break;
    }
  }
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

  await verifySignupIdentityAvailable({
    country,
    email,
    failurePath,
    mobileNumber,
  });

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
    redirectWithError(failurePath, friendlySignupError(error.message));
  }

  if (data.user && data.user.identities && data.user.identities.length === 0) {
    redirectWithError(
      failurePath,
      "That email is already attached to a Kyro account. Sign in instead, or use a different email.",
    );
  }

  if (data.session && data.user) {
    let workspace;
    let billingSetupUrl = "";

    try {
      workspace = await createWorkspaceBootstrap(supabase, data.user, {
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

    try {
      billingSetupUrl = await createKyroUserBillingSetupUrl({
        cancelPath:
          "/settings?section=usage&panel=payment-method&engine_message=Billing%20setup%20cancelled.%20You%20can%20finish%20it%20here%20before%20your%20trial%20ends.",
        successPath:
          "/dashboard?engine_message=Billing%20method%20saved.%20Your%20two-week%20trial%20has%20started.",
        supabase,
        user: data.user,
        workspace,
      });
    } catch (billingError) {
      const message =
        billingError instanceof Error
          ? billingError.message
          : "Billing setup failed.";
      redirect(
        `/settings?section=usage&panel=payment-method&engine_error=${encodeURIComponent(
          message,
        )}`,
      );
    }

    revalidatePath("/", "layout");
    redirect(billingSetupUrl);
  } else {
    redirect(
      `/sign-in?message=${encodeURIComponent(
        "Check your email to verify the account. After verification, Kyro will open secure card setup for your two-week trial.",
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
