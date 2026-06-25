import crypto from "crypto";

export const STRIPE_PROVIDER = "stripe";
export const STRIPE_API_VERSION = "2025-09-30.clover";

const DEFAULT_PLATFORM_FEE_BPS = 50;
const WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeConfig = {
  appUrl: string | null;
  configured: boolean;
  platformFeeBps: number;
  publishableKey: string | null;
  secretKey: string | null;
  webhookConfigured: boolean;
  webhookSecret: string | null;
};

export type StripeAccount = {
  charges_enabled?: boolean;
  country?: string;
  details_submitted?: boolean;
  id: string;
  payouts_enabled?: boolean;
};

export type StripeAccountLink = {
  url: string;
};

export type StripeCheckoutSession = {
  customer?: string | null;
  id: string;
  payment_intent?: string | null;
  setup_intent?: string | null;
  url: string | null;
};

export type StripeCustomer = {
  id: string;
};

export type StripeSetupIntent = {
  client_secret?: string | null;
  customer?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  payment_method?: string | null;
  status?: string | null;
};

export type StripePaymentIntent = {
  amount?: number | null;
  client_secret?: string | null;
  currency?: string | null;
  customer?: string | null;
  id: string;
  last_payment_error?: {
    message?: string | null;
  } | null;
  metadata?: Record<string, unknown> | null;
  payment_method?: string | null;
  status?: string | null;
};

export type StripeBillingPortalSession = {
  id: string;
  url: string;
};

export type StripeCheckoutLineItem = {
  amountCents: number;
  description: string;
  quantity: number;
};

function envString(name: string) {
  const value = process.env[name]?.trim();

  return value || null;
}

export function getStripeWebhookSecrets() {
  const singleSecret = envString("STRIPE_WEBHOOK_SECRET");
  const multipleSecrets = envString("STRIPE_WEBHOOK_SECRETS");
  const secrets = [
    ...(singleSecret ? [singleSecret] : []),
    ...(multipleSecrets
      ? multipleSecrets
          .split(/[\n,]/)
          .map((secret) => secret.trim())
          .filter(Boolean)
      : []),
  ];

  return Array.from(new Set(secrets));
}

export function getStripeConfig(): StripeConfig {
  const secretKey = envString("STRIPE_SECRET_KEY");
  const publishableKey =
    envString("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") ??
    envString("STRIPE_PUBLISHABLE_KEY");
  const webhookSecret = getStripeWebhookSecrets()[0] ?? null;
  const feeValue = Number(envString("STRIPE_PLATFORM_FEE_BPS"));

  return {
    appUrl: envString("NEXT_PUBLIC_APP_URL"),
    configured: Boolean(secretKey),
    platformFeeBps:
      Number.isFinite(feeValue) && feeValue >= 0
        ? Math.round(feeValue)
        : DEFAULT_PLATFORM_FEE_BPS,
    publishableKey,
    secretKey,
    webhookConfigured: getStripeWebhookSecrets().length > 0,
    webhookSecret,
  };
}

export function stripeWebhookUrl() {
  const appUrl = getStripeConfig().appUrl;

  return appUrl ? `${appUrl.replace(/\/$/, "")}/api/integrations/stripe/webhook` : null;
}

function appendFormData(
  form: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  form.append(key, String(value));
}

function nestedFormData(
  value: Record<string, unknown>,
  parentKey?: string,
  form = new URLSearchParams(),
) {
  for (const [key, item] of Object.entries(value)) {
    const formKey = parentKey ? `${parentKey}[${key}]` : key;

    if (item && typeof item === "object" && !Array.isArray(item)) {
      nestedFormData(item as Record<string, unknown>, formKey, form);
    } else if (Array.isArray(item)) {
      item.forEach((entry, index) => {
        if (entry && typeof entry === "object") {
          nestedFormData(entry as Record<string, unknown>, `${formKey}[${index}]`, form);
        } else {
          appendFormData(form, `${formKey}[${index}]`, entry as string);
        }
      });
    } else {
      appendFormData(form, formKey, item as string | number | boolean | null | undefined);
    }
  }

  return form;
}

export async function stripeApiRequest<T>(
  path: string,
  body?: Record<string, unknown>,
  options: { stripeAccount?: string | null } = {},
) {
  const config = getStripeConfig();

  if (!config.secretKey) {
    throw new Error("Stripe is not configured.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.secretKey}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  const init: RequestInit = {
    headers,
    method: body ? "POST" : "GET",
  };

  if (options.stripeAccount) {
    headers["Stripe-Account"] = options.stripeAccount;
  }

  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = nestedFormData(body);
  }

  const response = await fetch(`https://api.stripe.com${path}`, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Stripe request failed (${response.status}).`);
  }

  return payload as T;
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
) {
  if (!signatureHeader) {
    return false;
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");

      return [key, value];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;

  if (!Number.isFinite(timestamp) || !signature) {
    return false;
  }

  const age = Math.abs(Date.now() / 1000 - timestamp);

  if (age > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function createStripeExpressAccount({
  businessName,
  country,
  email,
}: {
  businessName: string;
  country: string;
  email: string;
}) {
  return stripeApiRequest<StripeAccount>("/v1/accounts", {
    business_profile: {
      name: businessName,
    },
    business_type: "company",
    capabilities: {
      card_payments: {
        requested: true,
      },
      transfers: {
        requested: true,
      },
    },
    country,
    email,
    type: "express",
  });
}

export async function createStripeAccountLink({
  accountId,
  refreshUrl,
  returnUrl,
}: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}) {
  return stripeApiRequest<StripeAccountLink>("/v1/account_links", {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
}

export async function createStripeCustomer({
  email,
  metadata,
  name,
}: {
  email: string;
  metadata?: Record<string, string>;
  name?: string | null;
}) {
  return stripeApiRequest<StripeCustomer>("/v1/customers", {
    email,
    metadata,
    name,
  });
}

export async function createStripeSetupCheckoutSession({
  cancelUrl,
  customerId,
  metadata,
  successUrl,
}: {
  cancelUrl: string;
  customerId: string;
  metadata: Record<string, string>;
  successUrl: string;
}) {
  return stripeApiRequest<StripeCheckoutSession>("/v1/checkout/sessions", {
    cancel_url: cancelUrl,
    customer: customerId,
    metadata,
    mode: "setup",
    payment_method_types: ["card"],
    setup_intent_data: {
      metadata,
    },
    success_url: successUrl,
  });
}

export async function createStripeSetupIntent({
  customerId,
  metadata,
}: {
  customerId: string;
  metadata: Record<string, string>;
}) {
  return stripeApiRequest<StripeSetupIntent>("/v1/setup_intents", {
    customer: customerId,
    metadata,
    payment_method_types: ["card"],
    usage: "off_session",
  });
}

export async function retrieveStripeSetupIntent(setupIntentId: string) {
  return stripeApiRequest<StripeSetupIntent>(
    `/v1/setup_intents/${encodeURIComponent(setupIntentId)}`,
  );
}

export async function createStripeBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string;
  returnUrl: string;
}) {
  return stripeApiRequest<StripeBillingPortalSession>(
    "/v1/billing_portal/sessions",
    {
      customer: customerId,
      return_url: returnUrl,
    },
  );
}

export async function createStripePaymentIntent({
  amountCents,
  currency,
  customerId,
  description,
  metadata,
  paymentMethodId,
}: {
  amountCents: number;
  currency: string;
  customerId: string;
  description: string;
  metadata: Record<string, string>;
  paymentMethodId: string;
}) {
  return stripeApiRequest<StripePaymentIntent>("/v1/payment_intents", {
    amount: amountCents,
    confirm: true,
    currency: currency.toLowerCase(),
    customer: customerId,
    description,
    metadata,
    off_session: true,
    payment_method: paymentMethodId,
  });
}

export async function createStripeCheckoutSession({
  accountId,
  amountCents,
  cancelUrl,
  currency,
  description,
  lineItems,
  metadata,
  paymentMethodTypes,
  platformFeeBps,
  successUrl,
}: {
  accountId: string;
  amountCents: number;
  cancelUrl: string;
  currency: string;
  description: string;
  lineItems?: StripeCheckoutLineItem[];
  metadata: Record<string, string>;
  paymentMethodTypes?: string[];
  platformFeeBps: number;
  successUrl: string;
}) {
  const applicationFeeAmount =
    platformFeeBps > 0 ? Math.round((amountCents * platformFeeBps) / 10_000) : 0;
  const checkoutLineItems =
    lineItems && lineItems.length > 0
      ? lineItems
      : [{ amountCents, description, quantity: 1 }];

  return stripeApiRequest<StripeCheckoutSession>(
    "/v1/checkout/sessions",
    {
      cancel_url: cancelUrl,
      line_items: checkoutLineItems.map((lineItem) => ({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: lineItem.description.slice(0, 120),
            },
            unit_amount: lineItem.amountCents,
          },
          quantity: lineItem.quantity,
      })),
      metadata,
      mode: "payment",
      ...(paymentMethodTypes && paymentMethodTypes.length > 0
        ? { payment_method_types: paymentMethodTypes }
        : {}),
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount || undefined,
        metadata,
      },
      success_url: successUrl,
    },
    { stripeAccount: accountId },
  );
}
