import { NextResponse } from "next/server";
import {
  friendlyEmailVerificationSendError,
  isSupabaseEmailConfirmed,
  sendKyroEmailVerification,
} from "../../../../lib/auth/email-verification";
import { normalizeContactEmail } from "../../../../lib/crm/identity";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

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
    nextPath:
      "/dashboard?engine_message=Email%20verified.%20Welcome%20to%20Kyro.",
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
