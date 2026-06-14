import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { WorkspaceSummary } from "../workspace/bootstrap";
import {
  createStripeBillingPortalSession,
  createStripeCustomer,
  createStripeSetupCheckoutSession,
  getStripeConfig,
} from "../payments/stripe";

export const KYRO_USER_BILLING_POLICY_TYPE = "kyro_user_billing";
export const KYRO_BILLING_SETUP_FLOW = "kyro_workspace_billing_setup";

type PolicyRow = {
  id: string;
  settings: Record<string, unknown> | null;
};

export type KyroUserBillingSettings = {
  defaultPaymentMethodReady: boolean;
  lastCheckoutSessionId: string | null;
  lastStripeEventId: string | null;
  setupCompletedAt: string | null;
  setupStatus: "not_started" | "pending" | "ready";
  stripeCustomerId: string | null;
  stripeSetupIntentId: string | null;
  trialEndsAt: string | null;
  trialStartedAt: string | null;
};

export type KyroUserBillingOverview = {
  appUrlConfigured: boolean;
  configured: boolean;
  settings: KyroUserBillingSettings;
  setupReady: boolean;
  webhookConfigured: boolean;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown) {
  return value === true;
}

function normalizeSettings(settings: Record<string, unknown> | null): KyroUserBillingSettings {
  const setupStatus = textValue(settings?.setupStatus);

  return {
    defaultPaymentMethodReady: boolValue(settings?.defaultPaymentMethodReady),
    lastCheckoutSessionId: textValue(settings?.lastCheckoutSessionId),
    lastStripeEventId: textValue(settings?.lastStripeEventId),
    setupCompletedAt: textValue(settings?.setupCompletedAt),
    setupStatus:
      setupStatus === "pending" || setupStatus === "ready" ? setupStatus : "not_started",
    stripeCustomerId: textValue(settings?.stripeCustomerId),
    stripeSetupIntentId: textValue(settings?.stripeSetupIntentId),
    trialEndsAt: textValue(settings?.trialEndsAt),
    trialStartedAt: textValue(settings?.trialStartedAt),
  };
}

async function loadPolicy(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspaceId)
    .eq("policy_type", KYRO_USER_BILLING_POLICY_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load Kyro billing settings: ${error.message}`);
  }

  return data as PolicyRow | null;
}

async function upsertBillingSettings({
  settings,
  supabase,
  workspaceId,
}: {
  settings: KyroUserBillingSettings;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { error } = await supabase.from("workspace_policies").upsert(
    {
      policy_type: KYRO_USER_BILLING_POLICY_TYPE,
      settings,
      workspace_id: workspaceId,
    },
    { onConflict: "workspace_id,policy_type" },
  );

  if (error) {
    throw new Error(`Unable to save Kyro billing settings: ${error.message}`);
  }
}

export async function getKyroUserBillingOverview(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<KyroUserBillingOverview> {
  const config = getStripeConfig();
  const row = await loadPolicy(supabase, workspaceId);
  const settings = normalizeSettings(row?.settings ?? null);

  return {
    appUrlConfigured: Boolean(config.appUrl),
    configured: config.configured,
    settings,
    setupReady: Boolean(settings.stripeCustomerId && settings.defaultPaymentMethodReady),
    webhookConfigured: config.webhookConfigured,
  };
}

export async function createKyroUserBillingSetupUrl({
  cancelPath,
  successPath,
  supabase,
  user,
  workspace,
}: {
  cancelPath?: string;
  supabase: SupabaseClient;
  successPath?: string;
  user: User;
  workspace: WorkspaceSummary;
}) {
  const config = getStripeConfig();

  if (!config.appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
  }

  if (!user.email) {
    throw new Error("Your account needs an email address before billing can be set up.");
  }

  const existing = await getKyroUserBillingOverview(supabase, workspace.id);
  const stripeCustomerId =
    existing.settings.stripeCustomerId ??
    (
      await createStripeCustomer({
        email: user.email,
        metadata: {
          flow: KYRO_BILLING_SETUP_FLOW,
          userId: user.id,
          workspaceId: workspace.id,
        },
        name: workspace.name,
      })
    ).id;
  const now = new Date();
  const trialStartedAt = existing.settings.trialStartedAt ?? now.toISOString();
  const trialEndsAt =
    existing.settings.trialEndsAt ??
    new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const setupCancelPath =
    cancelPath ??
    "/settings?section=usage&panel=payment-method&engine_message=Billing%20setup%20cancelled.";
  const setupSuccessPath =
    successPath ??
    "/settings?section=usage&panel=payment-method&engine_message=Billing%20method%20saved.";
  const session = await createStripeSetupCheckoutSession({
    cancelUrl: `${config.appUrl}${setupCancelPath}`,
    customerId: stripeCustomerId,
    metadata: {
      flow: KYRO_BILLING_SETUP_FLOW,
      userId: user.id,
      workspaceId: workspace.id,
    },
    successUrl: `${config.appUrl}${setupSuccessPath}`,
  });

  await upsertBillingSettings({
    settings: {
      ...existing.settings,
      lastCheckoutSessionId: session.id,
      setupStatus: "pending",
      stripeCustomerId,
      trialEndsAt,
      trialStartedAt,
    },
    supabase,
    workspaceId: workspace.id,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a billing setup URL.");
  }

  return session.url;
}

export async function createKyroUserBillingPortalUrl({
  supabase,
  workspaceId,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const config = getStripeConfig();
  const overview = await getKyroUserBillingOverview(supabase, workspaceId);

  if (!config.appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
  }

  if (!overview.settings.stripeCustomerId) {
    throw new Error("Set up Kyro billing before opening the billing portal.");
  }

  const portal = await createStripeBillingPortalSession({
    customerId: overview.settings.stripeCustomerId,
    returnUrl: `${config.appUrl}/settings?section=usage&panel=payment-method`,
  });

  return portal.url;
}

export async function markKyroUserBillingSetupComplete({
  checkoutSessionId,
  customerId,
  eventId,
  setupIntentId,
  supabase,
  workspaceId,
}: {
  checkoutSessionId: string;
  customerId: string | null;
  eventId: string;
  setupIntentId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const existing = await getKyroUserBillingOverview(supabase, workspaceId);

  await upsertBillingSettings({
    settings: {
      ...existing.settings,
      defaultPaymentMethodReady: true,
      lastCheckoutSessionId: checkoutSessionId,
      lastStripeEventId: eventId,
      setupCompletedAt: new Date().toISOString(),
      setupStatus: "ready",
      stripeCustomerId: customerId ?? existing.settings.stripeCustomerId,
      stripeSetupIntentId: setupIntentId,
    },
    supabase,
    workspaceId,
  });
}
