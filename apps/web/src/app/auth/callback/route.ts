import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { markKyroEmailVerified } from "../../../lib/auth/email-verification";
import { createServiceSupabaseClient } from "../../../lib/supabase/service";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        new URL(
          `/settings?section=general&engine_error=${encodeURIComponent(
            "Email verification failed. Try sending a new verification email.",
          )}`,
          requestUrl.origin,
        ),
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await markKyroEmailVerified({
        serviceSupabase: createServiceSupabaseClient(),
        user,
      });
    }
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}

function safeNextPath(value: string | null) {
  if (!value?.startsWith("/")) {
    return "/";
  }

  if (value.startsWith("//")) {
    return "/";
  }

  return value;
}
