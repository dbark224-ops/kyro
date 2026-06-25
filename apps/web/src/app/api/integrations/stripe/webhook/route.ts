import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import {
  getStripeConfig,
  getStripeWebhookSecrets,
  verifyStripeWebhookSignature,
  STRIPE_PROVIDER,
} from "../../../../../lib/payments/stripe";
import {
  KYRO_BILLING_SETUP_FLOW,
  markKyroUserBillingSetupComplete,
  markKyroUserBillingSetupIntentComplete,
} from "../../../../../lib/billing/kyro-user-billing";
import { reconcileKyroInvoicePaymentIntent } from "../../../../../lib/billing/kyro-billing-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StripeWebhookEvent = {
  data?: {
    object?: Record<string, unknown>;
  };
  id?: string;
  type?: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown) {
  return value === true;
}

function stripeAccountStatus(account: Record<string, unknown>) {
  const chargesEnabled = boolValue(account.charges_enabled);
  const payoutsEnabled = boolValue(account.payouts_enabled);
  const detailsSubmitted = boolValue(account.details_submitted);

  if (chargesEnabled && payoutsEnabled && detailsSubmitted) {
    return "active";
  }

  if (detailsSubmitted) {
    return "restricted";
  }

  return "onboarding";
}

async function recordPaymentEvent({
  event,
  paymentRequestId,
  status,
  supabase,
  workspaceId,
}: {
  event: Required<Pick<StripeWebhookEvent, "id" | "type">> & StripeWebhookEvent;
  paymentRequestId?: string | null;
  status: "processed" | "ignored" | "failed";
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  workspaceId: string;
}) {
  await supabase.from("payment_events").upsert(
    {
      payment_request_id: paymentRequestId ?? null,
      payload: event,
      processed_at: new Date().toISOString(),
      provider: STRIPE_PROVIDER,
      provider_event_id: event.id,
      provider_event_type: event.type,
      status,
      workspace_id: workspaceId,
    },
    { ignoreDuplicates: true, onConflict: "provider,provider_event_id" },
  );
}

async function handleAccountUpdated(
  event: Required<Pick<StripeWebhookEvent, "id" | "type">> & StripeWebhookEvent,
) {
  const account = event.data?.object ?? {};
  const accountId = textValue(account.id);

  if (!accountId) {
    return;
  }

  const supabase = createServiceSupabaseClient();
  const { data: row, error } = await supabase
    .from("workspace_payment_accounts")
    .select("id,workspace_id")
    .eq("provider", STRIPE_PROVIDER)
    .eq("provider_account_id", accountId)
    .maybeSingle();

  if (error || !row) {
    return;
  }

  const chargesEnabled = boolValue(account.charges_enabled);
  const payoutsEnabled = boolValue(account.payouts_enabled);
  const detailsSubmitted = boolValue(account.details_submitted);
  const status = stripeAccountStatus(account);

  await supabase
    .from("workspace_payment_accounts")
    .update({
      charges_enabled: chargesEnabled,
      country_code: textValue(account.country),
      details_submitted: detailsSubmitted,
      metadata: {
        stripeAccountLastEvent: event.id,
      },
      onboarded_at:
        status === "active" ? new Date().toISOString() : null,
      payouts_enabled: payoutsEnabled,
      status,
    })
    .eq("id", row.id);

  await recordPaymentEvent({
    event,
    status: "processed",
    supabase,
    workspaceId: row.workspace_id,
  });
}

async function handleCheckoutSessionCompleted(
  event: Required<Pick<StripeWebhookEvent, "id" | "type">> & StripeWebhookEvent,
) {
  const session = event.data?.object ?? {};
  const sessionId = textValue(session.id);

  if (!sessionId) {
    return;
  }

  const supabase = createServiceSupabaseClient();
  const metadata =
    session.metadata && typeof session.metadata === "object"
      ? (session.metadata as Record<string, unknown>)
      : {};

  if (textValue(metadata.flow) === KYRO_BILLING_SETUP_FLOW) {
    const workspaceId = textValue(metadata.workspaceId);

    if (!workspaceId) {
      return;
    }

    await markKyroUserBillingSetupComplete({
      checkoutSessionId: sessionId,
      customerId: textValue(session.customer),
      eventId: event.id,
      setupIntentId: textValue(session.setup_intent),
      supabase,
      workspaceId,
    });

    await supabase.from("events").insert({
      idempotency_key: `stripe.${event.id}`,
      payload: {
        flow: KYRO_BILLING_SETUP_FLOW,
        providerCheckoutSessionId: sessionId,
        stripeCustomerId: textValue(session.customer),
        stripeSetupIntentId: textValue(session.setup_intent),
      },
      processed_at: new Date().toISOString(),
      source: "stripe.webhook",
      status: "processed",
      type: "billing.setup.completed",
      workspace_id: workspaceId,
    });

    return;
  }

  const { data: requestRow, error } = await supabase
    .from("payment_requests")
    .select("id,workspace_id,status")
    .eq("provider", STRIPE_PROVIDER)
    .eq("provider_checkout_session_id", sessionId)
    .maybeSingle();

  if (error || !requestRow) {
    return;
  }

  const paid =
    textValue(session.payment_status)?.toLowerCase() === "paid" ||
    textValue(session.status)?.toLowerCase() === "complete";
  const paymentIntentId = textValue(session.payment_intent);

  await supabase
    .from("payment_requests")
    .update({
      paid_at: paid ? new Date().toISOString() : null,
      provider_payment_intent_id: paymentIntentId,
      status: paid ? "paid" : "sent",
    })
    .eq("id", requestRow.id);

  await recordPaymentEvent({
    event,
    paymentRequestId: requestRow.id,
    status: "processed",
    supabase,
    workspaceId: requestRow.workspace_id,
  });

  await supabase.from("events").insert({
    idempotency_key: `stripe.${event.id}`,
    payload: {
      paymentRequestId: requestRow.id,
      providerCheckoutSessionId: sessionId,
      providerPaymentIntentId: paymentIntentId,
      status: paid ? "paid" : "sent",
    },
    processed_at: new Date().toISOString(),
    source: "stripe.webhook",
    status: "processed",
    type: "payment.checkout.completed",
    workspace_id: requestRow.workspace_id,
  });
}

async function handlePaymentIntentStatus(
  event: Required<Pick<StripeWebhookEvent, "id" | "type">> & StripeWebhookEvent,
) {
  const paymentIntent = event.data?.object ?? {};
  const paymentIntentId = textValue(paymentIntent.id);

  if (!paymentIntentId) {
    return;
  }

  const supabase = createServiceSupabaseClient();
  const reconciledKyroInvoice = await reconcileKyroInvoicePaymentIntent({
    eventId: event.id,
    eventType: event.type,
    paymentIntent,
    supabase,
  });

  if (reconciledKyroInvoice) {
    const metadata =
      paymentIntent.metadata && typeof paymentIntent.metadata === "object"
        ? (paymentIntent.metadata as Record<string, unknown>)
        : {};
    const workspaceId = textValue(metadata.workspaceId);

    if (workspaceId) {
      await supabase.from("events").upsert(
        {
          idempotency_key: `stripe.${event.id}`,
          payload: {
            flow: "kyro_user_billing_invoice",
            invoiceId: textValue(metadata.invoiceId),
            providerPaymentIntentId: paymentIntentId,
            status:
              event.type === "payment_intent.succeeded"
                ? "paid"
                : "payment_failed",
          },
          processed_at: new Date().toISOString(),
          source: "stripe.webhook",
          status: "processed",
          type:
            event.type === "payment_intent.succeeded"
              ? "billing.invoice.paid"
              : "billing.invoice.payment_failed",
          workspace_id: workspaceId,
        },
        { ignoreDuplicates: true, onConflict: "idempotency_key" },
      );
    }

    return;
  }

  const { data: requestRow, error } = await supabase
    .from("payment_requests")
    .select("id,workspace_id")
    .eq("provider", STRIPE_PROVIDER)
    .eq("provider_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (error || !requestRow) {
    return;
  }

  const failed = event.type === "payment_intent.payment_failed";

  await supabase
    .from("payment_requests")
    .update({
      failed_at: failed ? new Date().toISOString() : null,
      paid_at: failed ? null : new Date().toISOString(),
      status: failed ? "failed" : "paid",
    })
    .eq("id", requestRow.id);

  await recordPaymentEvent({
    event,
    paymentRequestId: requestRow.id,
    status: "processed",
    supabase,
    workspaceId: requestRow.workspace_id,
  });
}

async function handleSetupIntentSucceeded(
  event: Required<Pick<StripeWebhookEvent, "id" | "type">> & StripeWebhookEvent,
) {
  const setupIntent = event.data?.object ?? {};
  const setupIntentId = textValue(setupIntent.id);
  const metadata =
    setupIntent.metadata && typeof setupIntent.metadata === "object"
      ? (setupIntent.metadata as Record<string, unknown>)
      : {};

  if (!setupIntentId || textValue(metadata.flow) !== KYRO_BILLING_SETUP_FLOW) {
    return;
  }

  const workspaceId = textValue(metadata.workspaceId);

  if (!workspaceId) {
    return;
  }

  const supabase = createServiceSupabaseClient();

  await markKyroUserBillingSetupIntentComplete({
    customerId: textValue(setupIntent.customer),
    paymentMethodId: textValue(setupIntent.payment_method),
    setupIntentId,
    supabase,
    workspaceId,
  });

  await supabase.from("events").upsert(
    {
      idempotency_key: `stripe.${event.id}`,
      payload: {
        flow: KYRO_BILLING_SETUP_FLOW,
        stripeCustomerId: textValue(setupIntent.customer),
        stripeSetupIntentId: setupIntentId,
      },
      processed_at: new Date().toISOString(),
      source: "stripe.webhook",
      status: "processed",
      type: "billing.setup.completed",
      workspace_id: workspaceId,
    },
    { ignoreDuplicates: true, onConflict: "idempotency_key" },
  );
}

async function handleStripeEvent(event: StripeWebhookEvent) {
  if (!event.id || !event.type) {
    return;
  }

  const typedEvent = event as Required<Pick<StripeWebhookEvent, "id" | "type">> &
    StripeWebhookEvent;

  if (typedEvent.type === "account.updated") {
    await handleAccountUpdated(typedEvent);
  } else if (typedEvent.type === "checkout.session.completed") {
    await handleCheckoutSessionCompleted(typedEvent);
  } else if (
    typedEvent.type === "payment_intent.succeeded" ||
    typedEvent.type === "payment_intent.payment_failed"
  ) {
    await handlePaymentIntentStatus(typedEvent);
  } else if (typedEvent.type === "setup_intent.succeeded") {
    await handleSetupIntentSucceeded(typedEvent);
  }
}

export async function GET() {
  const config = getStripeConfig();

  return NextResponse.json({
    configured: config.configured,
    endpoint: "stripe_webhook",
    ok: true,
    provider: STRIPE_PROVIDER,
    webhookConfigured: config.webhookConfigured,
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const webhookSecrets = getStripeWebhookSecrets();

  if (webhookSecrets.length === 0) {
    return NextResponse.json(
      { error: "Stripe webhook secret is not configured." },
      { status: 500 },
    );
  }

  const signatureHeader = request.headers.get("stripe-signature");
  const signatureValid = webhookSecrets.some((webhookSecret) =>
    verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret),
  );

  if (!signatureValid) {
    return NextResponse.json(
      { error: "Invalid Stripe signature." },
      { status: 400 },
    );
  }

  let event: StripeWebhookEvent;

  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch (error) {
    console.error("Unable to parse Stripe webhook payload", error);

    return NextResponse.json(
      { error: "Invalid Stripe payload." },
      { status: 400 },
    );
  }

  try {
    await handleStripeEvent(event);
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      error,
      eventId: event.id,
      eventType: event.type,
    });

    return NextResponse.json({
      processed: false,
      received: true,
    });
  }

  return NextResponse.json({ received: true });
}
