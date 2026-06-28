import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getPublicAppUrl } from "../app-url";

export const KYRO_EMAIL_VERIFICATION_STARTED_AT =
  "kyroEmailVerificationStartedAt";
export const KYRO_EMAIL_VERIFIED_AT = "kyroEmailVerifiedAt";

type UserWithConfirmationFields = User & {
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
};

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function isSupabaseEmailConfirmed(user: User) {
  const confirmationUser = user as UserWithConfirmationFields;

  return Boolean(
    confirmationUser.email_confirmed_at || confirmationUser.confirmed_at,
  );
}

export function kyroEmailVerificationStartedAt(user: User) {
  return metadataString(user.app_metadata, KYRO_EMAIL_VERIFICATION_STARTED_AT);
}

export function kyroEmailVerifiedAt(user: User) {
  return metadataString(user.app_metadata, KYRO_EMAIL_VERIFIED_AT);
}

export function isKyroEmailVerified(user: User) {
  if (kyroEmailVerifiedAt(user)) {
    return true;
  }

  if (kyroEmailVerificationStartedAt(user)) {
    return false;
  }

  return isSupabaseEmailConfirmed(user);
}

export function buildKyroEmailVerificationRedirectUrl({
  fallbackOrigin,
  nextPath = "/dashboard?engine_message=Email%20verified.%20Welcome%20to%20Kyro.",
}: {
  fallbackOrigin?: string | null;
  nextPath?: string;
}) {
  const callbackUrl = new URL("/auth/callback", getPublicAppUrl(fallbackOrigin));

  callbackUrl.searchParams.set("next", nextPath);

  return callbackUrl.toString();
}

export async function markKyroEmailVerificationStarted({
  serviceSupabase,
  user,
}: {
  serviceSupabase: SupabaseClient;
  user: User;
}) {
  const appMetadata = metadataRecord(user.app_metadata);

  if (!metadataString(appMetadata, KYRO_EMAIL_VERIFICATION_STARTED_AT)) {
    appMetadata[KYRO_EMAIL_VERIFICATION_STARTED_AT] =
      new Date().toISOString();
  }

  const { error } = await serviceSupabase.auth.admin.updateUserById(user.id, {
    app_metadata: appMetadata,
  });

  if (error) {
    throw new Error(`Unable to mark email verification pending: ${error.message}`);
  }
}

export async function markKyroEmailVerified({
  serviceSupabase,
  user,
}: {
  serviceSupabase: SupabaseClient;
  user: User;
}) {
  const appMetadata: Record<string, unknown> = {
    ...metadataRecord(user.app_metadata),
    [KYRO_EMAIL_VERIFIED_AT]: new Date().toISOString(),
  };

  if (!metadataString(appMetadata, KYRO_EMAIL_VERIFICATION_STARTED_AT)) {
    appMetadata[KYRO_EMAIL_VERIFICATION_STARTED_AT] =
      appMetadata[KYRO_EMAIL_VERIFIED_AT];
  }

  const { error } = await serviceSupabase.auth.admin.updateUserById(user.id, {
    app_metadata: appMetadata,
  });

  if (error) {
    throw new Error(`Unable to mark email verified: ${error.message}`);
  }
}

export function friendlyEmailVerificationSendError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Kyro has temporarily hit the verification email limit for this address. Check your inbox first, or wait a few minutes before trying again.";
  }

  if (normalized.includes("not authorized")) {
    return "Supabase could not send to this address. Production email needs custom SMTP enabled.";
  }

  return message;
}

export async function sendKyroEmailVerification({
  email,
  fallbackOrigin,
  nativeConfirmationRequired,
  nextPath,
  supabase,
}: {
  email: string;
  fallbackOrigin?: string | null;
  nativeConfirmationRequired: boolean;
  nextPath?: string;
  supabase: SupabaseClient;
}) {
  const emailRedirectTo = buildKyroEmailVerificationRedirectUrl({
    fallbackOrigin,
    nextPath,
  });

  if (nativeConfirmationRequired) {
    return supabase.auth.resend({
      email,
      options: { emailRedirectTo },
      type: "signup",
    });
  }

  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: false,
    },
  });
}
