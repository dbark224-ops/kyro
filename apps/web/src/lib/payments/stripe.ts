import crypto from "crypto";

export const STRIPE_PROVIDER = "stripe";
export const STRIPE_API_VERSION = "2025-09-30.clover";

const DEFAULT_PLATFORM_FEE_BPS = 50;
const WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeConfig = {
  appUrl: string | null;
  configured: boolean;
  platformFeeBps: number;
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
  id: string;
  payment_intent?: string | null;
  url: string | null;
};

function envString(name: string) {
  const value = process.env[name]?.trim();

  return value || null;
}

export function getStripeConfig(): StripeConfig {
  const secretKey = envString("STRIPE_SECRET_KEY");
  const webhookSecret = envString("STRIPE_WEBHOOK_SECRET");
  const feeValue = Number(envString("STRIPE_PLATFORM_FEE_BPS"));

  return {
    appUrl: envString("NEXT_PUBLIC_APP_URL"),
    configured: Boolean(secretKey),
    platformFeeBps:
      Number.isFinite(feeValue) && feeValue >= 0
        ? Math.round(feeValue)
        : DEFAULT_PLATFORM_FEE_BPS,
    secretKey,
    webhookConfigured: Boolean(webhookSecret),
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

export async function createStripeCheckoutSession({
  accountId,
  amountCents,
  cancelUrl,
  currency,
  description,
  metadata,
  platformFeeBps,
  successUrl,
}: {
  accountId: string;
  amountCents: number;
  cancelUrl: string;
  currency: string;
  description: string;
  metadata: Record<string, string>;
  platformFeeBps: number;
  successUrl: string;
}) {
  const applicationFeeAmount =
    platformFeeBps > 0 ? Math.round((amountCents * platformFeeBps) / 10_000) : 0;

  return stripeApiRequest<StripeCheckoutSession>(
    "/v1/checkout/sessions",
    {
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: description.slice(0, 120),
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata,
      mode: "payment",
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount || undefined,
        metadata,
      },
      success_url: successUrl,
    },
    { stripeAccount: accountId },
  );
}
