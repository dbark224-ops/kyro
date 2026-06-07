import { createServerSupabaseClient } from "../../../lib/supabase/server";
import {
  createWorkspaceBootstrap,
  getPrimaryWorkspace,
} from "../../../lib/workspace/bootstrap";
import { NextResponse, type NextRequest } from "next/server";

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];

  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.exchangeCodeForSession(code);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
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
