import { NextResponse } from "next/server";
import {
  friendlyEmailVerificationSendError,
  isSupabaseEmailConfirmed,
  sendKyroEmailVerification,
} from "../../../../lib/auth/email-verification";
import { normalizeContactEmail } from "../../../../lib/crm/identity";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import { consumeApiRateLimit } from "../../../../lib/security/rate-limit";

export const dynamic = "force-dynamic";

type ResendVerificationPayload = {
  email?: string;
};

async function findUserByEmail(email: string) {
  const serviceSupabase = createServiceSupabaseClient();
  const normalizedEmail = normalizeContactEmail(email);
  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await serviceSupabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(error.message);
    }

    const user = (data.users ?? []).find(
      (candidate) => normalizeContactEmail(candidate.email) === normalizedEmail,
    );

    if (user) {
      return user;
    }

    if ((data.users ?? []).length < perPage) {
      break;
    }
  }

  return null;
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | ResendVerificationPayload
    | null;
  const email = normalizeContactEmail(payload?.email);

  if (!email) {
    return NextResponse.json(
      { error: "Enter the email address to verify.", ok: false },
      { status: 400 },
    );
  }

  let rateLimit;

  try {
    rateLimit = await consumeApiRateLimit({
      headers: request.headers,
      identifier: email,
      maxRequests: 4,
      route: "auth.resend_verification",
      windowSeconds: 15 * 60,
    });
  } catch (rateLimitError) {
    console.error(
      "Unable to enforce verification-email rate limit",
      rateLimitError,
    );
    return NextResponse.json(
      { error: "Kyro could not send verification right now.", ok: false },
      { status: 503 },
    );
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Please wait a few minutes before requesting another email.",
        ok: false,
      },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      },
    );
  }

  let user;

  try {
    user = await findUserByEmail(email);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Kyro could not check that account right now.",
        ok: false,
      },
      { status: 500 },
    );
  }

  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await sendKyroEmailVerification({
    email,
    fallbackOrigin: request.headers.get("origin"),
    nativeConfirmationRequired: !isSupabaseEmailConfirmed(user),
    supabase,
  });

  if (error) {
    return NextResponse.json(
      { error: friendlyEmailVerificationSendError(error.message), ok: false },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
