import {
  createPaymentRequestCheckoutLink,
  createStripeConnectOnboardingLink,
} from "../../../../lib/payments/accounts";
import { getPaymentsOverviewData } from "../../../../lib/payments/queries";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import { getWorkspaceGeneralSettings } from "../../../../lib/workspace/general-settings";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export async function GET(request: Request) {
  try {
    const { supabase, workspace } = await requireMobileWorkspaceContext(request);

    return Response.json(await getPaymentsOverviewData(supabase, workspace.id));
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } = await requireMobileWorkspaceContext(request);
    const body = objectValue(await request.json().catch(() => null));
    const operation = textValue(body.operation);
    const amountCents = Math.round(numberValue(body.amountCents));
    const description = textValue(body.description);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

    if (!appUrl) {
      throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
    }

    if (operation === "connect_stripe") {
      const generalSettings = await getWorkspaceGeneralSettings(supabase, workspace.id);
      const businessName =
        generalSettings.businessProfile.businessName || workspace.name;
      const email = user.email ?? generalSettings.businessProfile.publicEmail;

      if (!email) {
        throw new Error("Add an account email before connecting Stripe payments.");
      }

      const url = await createStripeConnectOnboardingLink({
        businessName,
        email,
        generalSettings,
        supabase: createServiceSupabaseClient(),
        workspaceId: workspace.id,
      });

      return Response.json({ url });
    }

    if (!description || amountCents < 50) {
      throw new Error("Add a description and an amount of at least 50 cents.");
    }

    const result = await createPaymentRequestCheckoutLink({
      amountCents,
      cancelUrl: `${appUrl}/payments?engine_message=Payment%20link%20draft%20cancelled.`,
      contactId: textValue(body.contactId),
      currency: textValue(body.currency),
      description,
      dueAt: textValue(body.dueAt),
      metadata: {
        source: "kyro_mobile_api",
      },
      successUrl: `${appUrl}/payments?engine_message=Payment%20received.`,
      supabase: createServiceSupabaseClient(),
      userId: user.id,
      workspaceId: workspace.id,
    });

    return Response.json({
      paymentRequestId: result.id,
      providerCheckoutSessionId: result.providerCheckoutSessionId,
      url: result.paymentUrl,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
