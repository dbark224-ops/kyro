import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createStripeAccountLink,
  createStripeCheckoutSession,
  createStripeExpressAccount,
  getStripeConfig,
  stripeWebhookUrl,
  STRIPE_PROVIDER,
} from "./stripe";
import { operatingCountryPhoneRegion } from "../workspace/operating-countries";
import type { WorkspaceGeneralSettings } from "../workspace/general-settings";

type PaymentAccountRow = {
  charges_enabled: boolean;
  country_code: string | null;
  default_currency: string;
  details_submitted: boolean;
  id: string;
  onboarding_url: string | null;
  payouts_enabled: boolean;
  provider: string;
  provider_account_id: string | null;
  status: string;
  updated_at: string;
  workspace_id: string;
};

export type WorkspaceStripePaymentOverview = {
  account: PaymentAccountRow | null;
  configured: boolean;
  migrationReady: boolean;
  webhookConfigured: boolean;
  webhookUrl: string | null;
};

function tableMissing(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("schema cache")
  );
}

function stripeCountryFromSettings(settings: WorkspaceGeneralSettings) {
  return (
    operatingCountryPhoneRegion(settings.businessProfile.operatingCountry) ??
    settings.defaultPhoneRegion ??
    "AU"
  );
}

function defaultCurrencyForCountry(country: string) {
  if (country === "US") return "USD";
  if (country === "GB") return "GBP";
  if (country === "CA") return "CAD";
  if (country === "NZ") return "NZD";

  return "AUD";
}

export async function getWorkspaceStripePaymentOverview(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceStripePaymentOverview> {
  const config = getStripeConfig();
  const { data, error } = await supabase
    .from("workspace_payment_accounts")
    .select(
      "id,workspace_id,provider,provider_account_id,status,charges_enabled,payouts_enabled,details_submitted,default_currency,country_code,onboarding_url,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", STRIPE_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (tableMissing(error)) {
      return {
        account: null,
        configured: config.configured,
        migrationReady: false,
        webhookConfigured: config.webhookConfigured,
        webhookUrl: stripeWebhookUrl(),
      };
    }

    throw new Error(`Unable to load Stripe payment account: ${error.message}`);
  }

  return {
    account: data as PaymentAccountRow | null,
    configured: config.configured,
    migrationReady: true,
    webhookConfigured: config.webhookConfigured,
    webhookUrl: stripeWebhookUrl(),
  };
}

export async function createStripeConnectOnboardingLink({
  businessName,
  email,
  generalSettings,
  supabase,
  workspaceId,
}: {
  businessName: string;
  email: string;
  generalSettings: WorkspaceGeneralSettings;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const config = getStripeConfig();

  if (!config.appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
  }

  const country = stripeCountryFromSettings(generalSettings);
  const defaultCurrency = defaultCurrencyForCountry(country);
  const { data: existing, error: existingError } = await supabase
    .from("workspace_payment_accounts")
    .select("id,provider_account_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", STRIPE_PROVIDER)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to load Stripe payment account: ${existingError.message}`,
    );
  }

  const accountId =
    existing?.provider_account_id ??
    (
      await createStripeExpressAccount({
        businessName,
        country,
        email,
      })
    ).id;

  const now = new Date().toISOString();
  const accountPayload = {
    charges_enabled: false,
    country_code: country,
    default_currency: defaultCurrency,
    details_submitted: false,
    metadata: {
      businessName,
      createdThrough: "kyro_settings",
    },
    onboarding_url: null,
    payouts_enabled: false,
    provider: STRIPE_PROVIDER,
    provider_account_id: accountId,
    status: "onboarding",
    updated_at: now,
    workspace_id: workspaceId,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from("workspace_payment_accounts")
      .update(accountPayload)
      .eq("id", existing.id);

    if (error) {
      throw new Error(`Unable to update Stripe payment account: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from("workspace_payment_accounts")
      .insert(accountPayload);

    if (error) {
      throw new Error(`Unable to create Stripe payment account: ${error.message}`);
    }
  }

  const accountLink = await createStripeAccountLink({
    accountId,
    refreshUrl: `${config.appUrl}/settings?section=integrations`,
    returnUrl: `${config.appUrl}/settings?section=integrations&engine_message=Stripe%20payments%20setup%20saved.`,
  });

  await supabase
    .from("workspace_payment_accounts")
    .update({ onboarding_url: accountLink.url })
    .eq("workspace_id", workspaceId)
    .eq("provider", STRIPE_PROVIDER);

  return accountLink.url;
}

export async function createPaymentRequestCheckoutLink({
  amountCents,
  cancelUrl,
  contactId,
  conversationId,
  currency,
  description,
  dueAt,
  metadata,
  quoteDraftId,
  successUrl,
  supabase,
  userId,
  workspaceId,
}: {
  amountCents: number;
  cancelUrl: string;
  contactId?: string | null;
  conversationId?: string | null;
  currency?: string | null;
  description: string;
  dueAt?: string | null;
  metadata?: Record<string, string>;
  quoteDraftId?: string | null;
  successUrl: string;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const config = getStripeConfig();
  const { data: account, error: accountError } = await supabase
    .from("workspace_payment_accounts")
    .select("provider_account_id,default_currency,status,charges_enabled")
    .eq("workspace_id", workspaceId)
    .eq("provider", STRIPE_PROVIDER)
    .maybeSingle();

  if (accountError) {
    throw new Error(`Unable to load Stripe payment account: ${accountError.message}`);
  }

  if (!account?.provider_account_id || account.status !== "active") {
    throw new Error("Stripe payments are not active for this workspace yet.");
  }

  const normalizedCurrency =
    (currency || account.default_currency || "AUD").trim().toUpperCase();
  const { data: requestRow, error: insertError } = await supabase
    .from("payment_requests")
    .insert({
      amount_cents: amountCents,
      contact_id: contactId ?? null,
      conversation_id: conversationId ?? null,
      created_by: userId,
      currency: normalizedCurrency,
      description,
      due_at: dueAt ?? null,
      metadata: metadata ?? {},
      provider: STRIPE_PROVIDER,
      provider_account_id: account.provider_account_id,
      quote_draft_id: quoteDraftId ?? null,
      status: "draft",
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Unable to create payment request: ${insertError.message}`);
  }

  const session = await createStripeCheckoutSession({
    accountId: account.provider_account_id,
    amountCents,
    cancelUrl,
    currency: normalizedCurrency,
    description,
    metadata: {
      ...(metadata ?? {}),
      paymentRequestId: requestRow.id,
      workspaceId,
    },
    platformFeeBps: config.platformFeeBps,
    successUrl,
  });

  const { error: updateError } = await supabase
    .from("payment_requests")
    .update({
      payment_url: session.url,
      provider_checkout_session_id: session.id,
      provider_payment_intent_id: session.payment_intent ?? null,
      status: "link_created",
    })
    .eq("id", requestRow.id);

  if (updateError) {
    throw new Error(`Unable to save payment link: ${updateError.message}`);
  }

  return {
    id: requestRow.id,
    paymentUrl: session.url,
    providerCheckoutSessionId: session.id,
  };
}
