import { createServerSupabaseClient } from "../../../lib/supabase/server";
import {
  createKyroUserBillingSetupUrl,
  getKyroUserBillingOverview,
} from "../../../lib/billing/kyro-user-billing";
import { markKyroEmailVerified } from "../../../lib/auth/email-verification";
import { createServiceSupabaseClient } from "../../../lib/supabase/service";
import {
  createWorkspaceBootstrap,
  getPrimaryWorkspace,
} from "../../../lib/workspace/bootstrap";
import { NextResponse, type NextRequest } from "next/server";

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
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.exchangeCodeForSession(code);
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

      let workspace = await getPrimaryWorkspace(supabase);
      const businessName = metadataString(
        user.user_metadata,
        "kyroBusinessName",
      );
      const trialAcknowledgedAt = metadataString(
        user.user_metadata,
        "kyroTrialAcknowledgedAt",
      );

      if (!workspace && businessName) {
        try {
          workspace = await createWorkspaceBootstrap(supabase, user, {
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

      if (workspace && businessName && trialAcknowledgedAt) {
        try {
          const billingOverview = await getKyroUserBillingOverview(
            supabase,
            workspace.id,
          );

          if (billingOverview.setupReady) {
            return NextResponse.redirect(new URL(next, requestUrl.origin));
          }

          const billingSetupUrl = await createKyroUserBillingSetupUrl({
            cancelPath:
              "/settings?section=usage&panel=payment-method&engine_message=Billing%20setup%20cancelled.%20You%20can%20finish%20it%20here%20before%20your%20trial%20ends.",
            successPath:
              "/dashboard?engine_message=Billing%20method%20saved.%20Your%20two-week%20trial%20has%20started.",
            supabase,
            user,
            workspace,
          });

          return NextResponse.redirect(billingSetupUrl);
        } catch (error) {
          return NextResponse.redirect(
            new URL(
              `/settings?section=usage&panel=payment-method&engine_error=${encodeURIComponent(
                error instanceof Error ? error.message : "Billing setup failed.",
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
