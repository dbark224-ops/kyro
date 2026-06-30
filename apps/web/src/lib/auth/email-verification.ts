import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getPublicAppUrl } from "../app-url";
import { createServiceSupabaseClient } from "../supabase/service";

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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function authEmailFromAddress() {
  return (
    process.env.KYRO_AUTH_EMAIL_FROM?.trim() ||
    process.env.AUTH_EMAIL_FROM?.trim() ||
    process.env.WAITLIST_NOTIFICATION_FROM?.trim() ||
    "Kyro <onboarding@resend.dev>"
  );
}

function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || "";
}

function buildKyroVerificationEmail({
  actionLink,
  email,
}: {
  actionLink: string;
  email: string;
}) {
  const escapedActionLink = escapeHtml(actionLink);
  const escapedEmail = escapeHtml(email);
  const logoUrl = escapeHtml(`${getPublicAppUrl()}/brand/kyro-email-logo.png`);
  const text = [
    "Verify your Kyro email",
    "",
    `Confirm ${email} so Kyro can unlock your workspace settings.`,
    "",
    actionLink,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#05070d;color:#f8fbff;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070d;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0d1018;border:1px solid #273244;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 30px 8px;">
                <img src="${logoUrl}" width="180" height="90" alt="Kyro" style="display:block;width:180px;height:auto;border:0;outline:none;text-decoration:none;">
              </td>
            </tr>
            <tr>
              <td style="padding:10px 30px 0;">
                <p style="margin:0 0 8px;color:#EC368D;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Email verification</p>
                <h1 style="margin:0;color:#f8fbff;font-size:28px;line-height:1.1;">Finish setting up Kyro</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 30px 0;">
                <p style="margin:0;color:#b7c2d5;font-size:15px;line-height:1.55;">
                  Confirm <strong style="color:#f8fbff;">${escapedEmail}</strong> so Kyro can unlock your workspace settings and keep your account protected.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 30px 8px;">
                <a href="${escapedActionLink}" style="display:inline-block;background:#EC368D;color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 20px;font-size:14px;font-weight:800;">Verify email address</a>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 30px 26px;">
                <p style="margin:0;color:#7f8da3;font-size:12px;line-height:1.5;">
                  If the button does not work, copy and paste this link into your browser:<br>
                  <a href="${escapedActionLink}" style="color:#51E5FF;word-break:break-all;">${escapedActionLink}</a>
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:560px;margin:14px 0 0;color:#657287;font-size:12px;line-height:1.45;">
            If you did not request this, you can ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, text };
}

async function sendBrandedKyroVerificationEmail({
  actionLink,
  email,
}: {
  actionLink: string;
  email: string;
}) {
  const apiKey = resendApiKey();

  if (!apiKey) {
    return false;
  }

  const { html, text } = buildKyroVerificationEmail({ actionLink, email });
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: authEmailFromAddress(),
      html,
      subject: "Verify your Kyro email",
      text,
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Resend verification email failed with ${response.status}: ${responseText}`,
    );
  }

  return true;
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

  if (resendApiKey()) {
    const serviceSupabase = createServiceSupabaseClient();
    const { data: linkData, error: linkError } =
      await serviceSupabase.auth.admin.generateLink({
        email,
        options: { redirectTo: emailRedirectTo },
        type: "magiclink",
      });

    if (!linkError && linkData.properties?.action_link) {
      const brandedSent = await sendBrandedKyroVerificationEmail({
        actionLink: linkData.properties.action_link,
        email,
      });

      if (brandedSent) {
        return { data: null, error: null };
      }
    }

    if (linkError) {
      console.warn("Kyro could not generate a branded verification link.", {
        message: linkError.message,
        name: linkError.name,
        status: linkError.status,
      });
    }
  }

  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: false,
    },
  });
}
