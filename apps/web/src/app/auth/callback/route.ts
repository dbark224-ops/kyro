import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { markKyroEmailVerified } from "../../../lib/auth/email-verification";
import { createServiceSupabaseClient } from "../../../lib/supabase/service";
import { ensureWorkspaceBootstrapForUser } from "../../../lib/workspace/bootstrap";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const tokenType = requestUrl.searchParams.get("type");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (code || (tokenHash && tokenType)) {
    const supabase = await createServerSupabaseClient();
    const authResult = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash ?? "",
          type: tokenType as EmailOtpType,
        });

    if (authResult.error) {
      return NextResponse.redirect(
        new URL(
          `/sign-in?error=${encodeURIComponent(authResult.error.message)}`,
          requestUrl.origin,
        ),
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      try {
        await markKyroEmailVerified({
          serviceSupabase: createServiceSupabaseClient(),
          user,
        });
      } catch (error) {
        return NextResponse.redirect(
          new URL(
            `/settings?section=general&engine_error=${encodeURIComponent(
              error instanceof Error
                ? error.message
                : "Email verification could not be saved.",
            )}`,
            requestUrl.origin,
          ),
        );
      }

      try {
        await ensureWorkspaceBootstrapForUser(supabase, user);
      } catch (error) {
        return NextResponse.redirect(
          new URL(
            `/onboarding?error=${encodeURIComponent(
              error instanceof Error
                ? error.message
                : "Workspace setup failed.",
            )}`,
            requestUrl.origin,
          ),
        );
      }
    }
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
