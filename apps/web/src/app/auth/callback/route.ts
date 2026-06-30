import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { markKyroEmailVerified } from "../../../lib/auth/email-verification";
import { createServiceSupabaseClient } from "../../../lib/supabase/service";
import {
  createWorkspaceBootstrap,
  getPrimaryWorkspace,
} from "../../../lib/workspace/bootstrap";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];

  return typeof value === "string" ? value.trim() : "";
}

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

      const workspace = await getPrimaryWorkspace(supabase);
      const businessName = metadataString(
        user.user_metadata,
        "kyroBusinessName",
      );

      if (!workspace && businessName) {
        try {
          await createWorkspaceBootstrap(supabase, user, {
            businessLocation: metadataString(
              user.user_metadata,
              "kyroBusinessLocation",
            ),
            businessName,
            country: metadataString(user.user_metadata, "kyroBusinessCountry"),
            industry: metadataString(user.user_metadata, "kyroIndustry"),
            postcode: metadataString(user.user_metadata, "kyroBusinessPostcode"),
            publicEmail: user.email ?? undefined,
            publicPhoneNumber: metadataString(
              user.user_metadata,
              "kyroMobileNumber",
            ),
            serviceArea: metadataString(
              user.user_metadata,
              "kyroBusinessServiceArea",
            ),
          });
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
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
