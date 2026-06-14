import { NextResponse } from "next/server";
import {
  KYRO_BILLING_SETUP_FLOW,
  markKyroUserBillingSetupIntentComplete,
} from "../../../../../lib/billing/kyro-user-billing";
import { retrieveStripeSetupIntent } from "../../../../../lib/payments/stripe";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

type CompleteCardPayload = {
  setupIntentId?: string;
  workspaceId?: string;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message, ok: false }, { status });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | CompleteCardPayload
    | null;
  const setupIntentId = textValue(payload?.setupIntentId);
  const workspaceId = textValue(payload?.workspaceId);

  if (!setupIntentId || !workspaceId) {
    return errorResponse("Missing card setup confirmation details.");
  }

  const setupIntent = await retrieveStripeSetupIntent(setupIntentId);

  if (setupIntent.status !== "succeeded") {
    return errorResponse("Stripe has not confirmed the saved card yet.", 409);
  }

  const supabase = createServiceSupabaseClient();
  const metadata =
    setupIntent && "metadata" in setupIntent && setupIntent.metadata
      ? (setupIntent.metadata as Record<string, unknown>)
      : {};

  if (
    textValue(metadata.flow) &&
    textValue(metadata.flow) !== KYRO_BILLING_SETUP_FLOW
  ) {
    return errorResponse("Stripe setup intent does not belong to Kyro billing.", 403);
  }

  if (textValue(metadata.workspaceId) && textValue(metadata.workspaceId) !== workspaceId) {
    return errorResponse("Stripe setup intent does not match this workspace.", 403);
  }

  await markKyroUserBillingSetupIntentComplete({
    customerId:
      typeof setupIntent.customer === "string" ? setupIntent.customer : null,
    paymentMethodId:
      typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : null,
    setupIntentId,
    supabase,
    workspaceId,
  });

  await supabase.from("events").upsert(
    {
      idempotency_key: `stripe.setup_intent.client.${setupIntentId}`,
      payload: {
        flow: KYRO_BILLING_SETUP_FLOW,
        stripeCustomerId:
          typeof setupIntent.customer === "string" ? setupIntent.customer : null,
        stripeSetupIntentId: setupIntentId,
      },
      processed_at: new Date().toISOString(),
      source: "stripe.client",
      status: "processed",
      type: "billing.setup.completed",
      workspace_id: workspaceId,
    },
    { ignoreDuplicates: true, onConflict: "idempotency_key" },
  );

  return NextResponse.json({ ok: true });
}
