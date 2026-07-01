import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createKyroUserBillingSetupIntent } from "../../../../lib/billing/kyro-user-billing";
import {
  buildKyroEmailVerificationRedirectUrl,
  friendlyEmailVerificationSendError,
  isSupabaseEmailConfirmed,
  markKyroEmailVerificationStarted,
  sendKyroEmailVerification,
} from "../../../../lib/auth/email-verification";
import { getAuthCallbackUrl } from "../../../../lib/app-url";
import {
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
} from "../../../../lib/crm/identity";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import { createWorkspaceBootstrap } from "../../../../lib/workspace/bootstrap";
import {
  isOperatingCountry,
  operatingCountryPhoneRegion,
} from "../../../../lib/workspace/operating-countries";

export const dynamic = "force-dynamic";

type CreateAccountPayload = {
  businessLocation?: string;
  businessName?: string;
  confirmEmail?: string;
  confirmPassword?: string;
  country?: string;
  email?: string;
  firstName?: string;
  industry?: string;
  lastName?: string;
  mobileCountry?: string;
  mobileNumber?: string;
  password?: string;
  postcode?: string;
  serviceArea?: string;
  timeZone?: string;
  trialAcknowledged?: string;
};

type ValidatedCreateAccountPayload =
  | { error: string }
  | {
      input: {
        businessLocation: string;
        businessName: string;
        country: string;
        email: string;
        firstName: string;
        industry: string;
        lastName: string;
        mobileCountry: string;
        mobileNumber: string;
        normalizedMobileNumber: string;
        name: string;
        password: string;
        postcode: string;
        serviceArea: string;
        timeZone: string;
      };
    };

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeZone(value: unknown) {
  const timeZone = textValue(value) || "UTC";

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
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

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message, ok: false }, { status });
}

async function verifySignupIdentityAvailable(input: {
  email: string;
  mobileCountry: string;
  mobileNumber: string;
}) {
  const normalizedEmail = normalizeContactEmail(input.email);
  const phoneRegion = operatingCountryPhoneRegion(input.mobileCountry);
  const normalizedPhone = normalizeContactPhoneForRegion(
    input.mobileNumber,
    phoneRegion,
  );

  if (!normalizedEmail) {
    return "Enter a valid email address.";
  }

  if (!normalizedPhone) {
    return "Enter a valid mobile number.";
  }

  const serviceSupabase = createServiceSupabaseClient();
  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await serviceSupabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return "Kyro could not verify account details right now. Please try again shortly.";
    }

    const users = data.users ?? [];

    for (const user of users) {
      const existingEmail = normalizeContactEmail(user.email);

      if (existingEmail && existingEmail === normalizedEmail) {
        return "That email is already attached to a Kyro account. Sign in instead, or use a different email.";
      }

      const phoneMatch = signupPhoneCandidates(user).some((candidate) => {
        const normalizedCandidate = normalizeContactPhoneForRegion(
          candidate,
          phoneRegion,
        );
        return normalizedCandidate === normalizedPhone;
      });

      if (phoneMatch) {
        return "That mobile number is already attached to a Kyro account. Use a different number, or contact support if this is your account.";
      }
    }

    if (users.length < perPage) {
      break;
    }
  }

  return null;
}

function validatePayload(
  payload: CreateAccountPayload,
): ValidatedCreateAccountPayload {
  const email = textValue(payload.email);
  const confirmEmail = textValue(payload.confirmEmail);
  const password = textValue(payload.password);
  const confirmPassword = textValue(payload.confirmPassword);
  const firstName = textValue(payload.firstName);
  const lastName = textValue(payload.lastName);
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const mobileNumber = textValue(payload.mobileNumber);
  const businessName = textValue(payload.businessName);
  const businessLocation = textValue(payload.businessLocation);
  const country = textValue(payload.country);
  const industry = textValue(payload.industry);
  const mobileCountry = textValue(payload.mobileCountry);
  const postcode = textValue(payload.postcode);
  const serviceArea = textValue(payload.serviceArea);
  const timeZone = normalizeTimeZone(payload.timeZone);
  const trialAcknowledged = textValue(payload.trialAcknowledged);

  if (!email || !confirmEmail || !password) {
    return { error: "Email and password are required." };
  }

  if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
    return { error: "Email addresses must match." };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords must match." };
  }

  if (!firstName || !lastName) {
    return { error: "First name and last name are required." };
  }

  if (!mobileNumber) {
    return { error: "Mobile number is required." };
  }

  if (!isOperatingCountry(mobileCountry)) {
    return { error: "Choose the mobile number country." };
  }

  const normalizedMobileNumber = normalizeContactPhoneForRegion(
    mobileNumber,
    operatingCountryPhoneRegion(mobileCountry),
  );

  if (!normalizedMobileNumber) {
    return { error: "Enter a valid mobile number." };
  }

  if (!businessName || !industry || !businessLocation) {
    return { error: "Business name, industry, and location are required." };
  }

  if (!isOperatingCountry(country)) {
    return { error: "Choose the country this workspace operates in." };
  }

  if (trialAcknowledged !== "yes") {
    return {
      error:
        "Confirm the two-week trial and billing acknowledgement to continue.",
    };
  }

  return {
    input: {
      businessLocation,
      businessName,
      country,
      email,
      firstName,
      industry,
      lastName,
      mobileCountry,
      mobileNumber,
      normalizedMobileNumber,
      name,
      password,
      postcode,
      serviceArea,
      timeZone,
    },
  };
}

export async function POST(request: Request) {
  const payload = (await request
    .json()
    .catch(() => null)) as CreateAccountPayload | null;

  if (!payload) {
    return errorResponse("Invalid signup request.");
  }

  const validated = validatePayload(payload);

  if (!("input" in validated)) {
    return errorResponse(validated.error);
  }

  const input = validated.input;
  const duplicateError = await verifySignupIdentityAvailable({
    email: input.email,
    mobileCountry: input.mobileCountry,
    mobileNumber: input.mobileNumber,
  });

  if (duplicateError) {
    return errorResponse(duplicateError, 409);
  }

  const authCallbackUrl = getAuthCallbackUrl(request.headers.get("origin"));
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        kyroBusinessCountry: input.country,
        kyroBusinessLocation: input.businessLocation,
        kyroBusinessName: input.businessName,
        kyroBusinessPostcode: input.postcode,
        kyroBusinessServiceArea: input.serviceArea,
        kyroMobileCountry: input.mobileCountry,
        kyroMobileNumber: input.normalizedMobileNumber,
        kyroIndustry: input.industry,
        kyroTrialAcknowledgedAt: new Date().toISOString(),
        firstName: input.firstName,
        first_name: input.firstName,
        full_name: input.name,
        lastName: input.lastName,
        last_name: input.lastName,
        name: input.name,
        phone: input.normalizedMobileNumber,
      },
      emailRedirectTo: authCallbackUrl,
    },
  });

  if (error) {
    return errorResponse(friendlySignupError(error.message), 400);
  }

  if (!data.user) {
    return errorResponse(
      "Kyro could not create the account. Please try again.",
    );
  }

  if (data.user.identities && data.user.identities.length === 0) {
    return errorResponse(
      "That email is already attached to a Kyro account. Sign in instead, or use a different email.",
      409,
    );
  }

  const bootstrapSupabase = data.session
    ? supabase
    : createServiceSupabaseClient();
  let workspace;

  try {
    workspace = await createWorkspaceBootstrap(
      bootstrapSupabase,
      data.user as User,
      {
        businessLocation: input.businessLocation,
        businessName: input.businessName,
        country: input.country,
        industry: input.industry,
        postcode: input.postcode,
        publicEmail: input.email,
        publicPhoneNumber: input.normalizedMobileNumber,
        serviceArea: input.serviceArea,
        timeZone: input.timeZone,
      },
    );
  } catch (bootstrapError) {
    return errorResponse(
      bootstrapError instanceof Error
        ? bootstrapError.message
        : "Workspace setup failed.",
      500,
    );
  }

  try {
    const setup = await createKyroUserBillingSetupIntent({
      supabase: bootstrapSupabase,
      user: data.user as User,
      workspace,
    });
    const serviceSupabase = createServiceSupabaseClient();
    let verificationEmailWarning: string | null = null;

    try {
      await markKyroEmailVerificationStarted({
        serviceSupabase,
        user: data.user as User,
      });
    } catch (verificationError) {
      return errorResponse(
        verificationError instanceof Error
          ? verificationError.message
          : "Email verification setup failed.",
        500,
      );
    }

    if (data.session) {
      const { error: verificationEmailError } = await sendKyroEmailVerification(
        {
          email: input.email,
          fallbackOrigin: request.headers.get("origin"),
          nativeConfirmationRequired: !isSupabaseEmailConfirmed(
            data.user as User,
          ),
          supabase,
        },
      );

      if (verificationEmailError) {
        verificationEmailWarning = friendlyEmailVerificationSendError(
          verificationEmailError.message,
        );
      }
    }

    return NextResponse.json({
      clientSecret: setup.clientSecret,
      email: input.email,
      ok: true,
      publishableKey: setup.publishableKey,
      redirectAfterSetup: data.session
        ? "/dashboard?engine_message=Billing%20method%20saved.%20Your%20two-week%20trial%20has%20started."
        : "/sign-in?message=Email%20verified.%20Sign%20in%20to%20open%20your%20Kyro%20workspace.",
      requiresEmailVerification: true,
      setupIntentId: setup.setupIntentId,
      trialEndsAt: setup.trialEndsAt,
      verificationEmailWarning,
      verificationRedirectUrl: buildKyroEmailVerificationRedirectUrl({
        fallbackOrigin: request.headers.get("origin"),
      }),
      workspaceId: workspace.id,
    });
  } catch (billingError) {
    return errorResponse(
      billingError instanceof Error
        ? billingError.message
        : "Billing setup failed.",
      500,
    );
  }
}
