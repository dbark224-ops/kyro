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
import { normalizeContactPhoneForRegion } from "../../../../lib/crm/identity";
import {
  reserveSignupBootstrap,
  updateSignupBootstrap,
} from "../../../../lib/auth/signup-bootstrap";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import { createWorkspaceBootstrap } from "../../../../lib/workspace/bootstrap";
import {
  isOperatingCountry,
  operatingCountryPhoneRegion,
} from "../../../../lib/workspace/operating-countries";
import { consumeApiRateLimit } from "../../../../lib/security/rate-limit";

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
  normalizedMobileNumber: string;
  payload: Record<string, unknown>;
}) {
  const serviceSupabase = createServiceSupabaseClient();
  const reservation = await reserveSignupBootstrap(serviceSupabase, {
    email: input.email,
    payload: input.payload,
    phone: input.normalizedMobileNumber,
  });

  const error =
    reservation.conflict === "email"
      ? "That email is already attached to a Kyro account. Sign in instead, or use a different email."
      : reservation.conflict === "phone"
        ? "That mobile number is already attached to a Kyro account. Use a different number, or contact support if this is your account."
        : reservation.conflict === "recoverable"
          ? "Your Kyro account has already been started. Sign in to resume setup; Kyro will restore any missing workspace steps automatically."
          : null;

  return { error, reservationId: reservation.id, serviceSupabase };
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
  let rateLimit;

  try {
    rateLimit = await consumeApiRateLimit({
      headers: request.headers,
      identifier: input.email,
      maxRequests: 5,
      route: "auth.create_account",
      windowSeconds: 15 * 60,
    });
  } catch (rateLimitError) {
    console.error(
      "Unable to enforce account-creation rate limit",
      rateLimitError,
    );
    return errorResponse("Kyro could not start signup right now.", 503);
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many signup attempts. Please wait a few minutes.",
        ok: false,
      },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      },
    );
  }

  let signupReservation;

  try {
    signupReservation = await verifySignupIdentityAvailable({
      email: input.email,
      normalizedMobileNumber: input.normalizedMobileNumber,
      payload: {
        businessLocation: input.businessLocation,
        businessName: input.businessName,
        country: input.country,
        firstName: input.firstName,
        industry: input.industry,
        lastName: input.lastName,
        postcode: input.postcode,
        serviceArea: input.serviceArea,
        timeZone: input.timeZone,
      },
    });
  } catch (reservationError) {
    console.error("Unable to reserve signup identity", reservationError);
    return errorResponse(
      "Kyro could not verify account details right now. Please try again shortly.",
      503,
    );
  }

  if (signupReservation.error || !signupReservation.reservationId) {
    return errorResponse(
      signupReservation.error ?? "Kyro could not reserve this signup.",
      409,
    );
  }

  const signupRecordId = signupReservation.reservationId;
  const serviceSupabase = signupReservation.serviceSupabase;

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
        kyroTimeZone: input.timeZone,
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

  await updateSignupBootstrap(serviceSupabase, {
    authUserId: data.user.id,
    recordId: signupRecordId,
    stage: "auth_created",
    status: "auth_created",
  }).catch((trackingError) => {
    console.error("Unable to record signup Auth stage", trackingError);
  });

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
    await updateSignupBootstrap(serviceSupabase, {
      authUserId: data.user.id,
      recordId: signupRecordId,
      stage: "workspace_created",
      status: "workspace_created",
      workspaceId: workspace.id,
    });
  } catch (bootstrapError) {
    await updateSignupBootstrap(serviceSupabase, {
      authUserId: data.user.id,
      error:
        bootstrapError instanceof Error
          ? bootstrapError.message
          : "Workspace setup failed.",
      recordId: signupRecordId,
      stage: "workspace_bootstrap_failed",
      status: "failed",
    }).catch(() => undefined);
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
    let verificationEmailWarning: string | null = null;

    try {
      await markKyroEmailVerificationStarted({
        serviceSupabase,
        user: data.user as User,
      });
    } catch (verificationError) {
      verificationEmailWarning =
        verificationError instanceof Error
          ? verificationError.message
          : "Email verification setup needs to be resumed.";
      console.error(
        "Unable to record email verification start during signup",
        verificationError,
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

    await updateSignupBootstrap(serviceSupabase, {
      authUserId: data.user.id,
      recordId: signupRecordId,
      stage: "ready_for_payment_method",
      status: "complete",
      workspaceId: workspace.id,
    });

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
    const message =
      billingError instanceof Error
        ? billingError.message
        : "Billing setup failed.";

    await updateSignupBootstrap(serviceSupabase, {
      authUserId: data.user.id,
      error: message,
      recordId: signupRecordId,
      stage: "billing_setup_pending",
      status: "billing_pending",
      workspaceId: workspace.id,
    }).catch(() => undefined);

    return NextResponse.json(
      {
        email: input.email,
        ok: true,
        recoveryUrl: `/sign-in?message=${encodeURIComponent(
          "Your account is ready. Sign in to resume payment setup in Usage and billing.",
        )}`,
        setupDeferred: true,
        workspaceId: workspace.id,
      },
      { status: 202 },
    );
  }
}
