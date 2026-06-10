import type { SupabaseClient } from "@supabase/supabase-js";
import { STRIPE_PROVIDER, stripeWebhookUrl, getStripeConfig } from "./stripe";

type ContactRow = {
  company: string | null;
  email: string | null;
  id: string;
  name: string | null;
  phone: string | null;
};

type PaymentRequestRow = {
  amount_cents: number;
  contact_id: string | null;
  created_at: string;
  currency: string;
  description: string;
  due_at: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  paid_at: string | null;
  payment_url: string | null;
  provider_checkout_session_id: string | null;
  provider_payment_intent_id: string | null;
  status: string;
  updated_at: string;
};

type PaymentAccountRow = {
  charges_enabled: boolean;
  default_currency: string;
  id: string;
  payouts_enabled: boolean;
  provider_account_id: string | null;
  status: string;
};

export type PaymentsContactOption = {
  company: string | null;
  email: string | null;
  id: string;
  label: string;
  phone: string | null;
};

export type PaymentRequestListItem = {
  amountCents: number;
  contactId: string | null;
  contactLabel: string;
  createdAt: string;
  currency: string;
  description: string;
  dueAt: string | null;
  id: string;
  metadata: Record<string, unknown>;
  paidAt: string | null;
  paymentUrl: string | null;
  status: string;
  updatedAt: string;
};

export type PaymentsOverviewData = {
  account: {
    chargesEnabled: boolean;
    defaultCurrency: string;
    payoutsEnabled: boolean;
    providerAccountId: string | null;
    status: string;
  } | null;
  contacts: PaymentsContactOption[];
  configured: boolean;
  migrationReady: boolean;
  paymentRequests: PaymentRequestListItem[];
  stats: {
    currency: string;
    overdueAmountCents: number;
    overdueCount: number;
    outstandingAmountCents: number;
    outstandingCount: number;
    paidThisMonthCents: number;
    paidThisWeekCents: number;
    totalPaidCents: number;
  };
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

function startOfWeek() {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;

  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);

  return date;
}

function startOfMonth() {
  const date = new Date();

  date.setDate(1);
  date.setHours(0, 0, 0, 0);

  return date;
}

function contactLabel(contact: ContactRow | null | undefined) {
  if (!contact) {
    return "No contact linked";
  }

  return contact.name || contact.company || contact.email || contact.phone || "Unnamed contact";
}

function requestContactLabel(contact: ContactRow | null | undefined) {
  return contactLabel(contact);
}

function isPaid(row: PaymentRequestRow) {
  return row.status === "paid" || Boolean(row.paid_at);
}

function isOpen(row: PaymentRequestRow) {
  return !["paid", "cancelled", "refunded"].includes(row.status);
}

function centsValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

export async function getPaymentsOverviewData(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<PaymentsOverviewData> {
  const config = getStripeConfig();
  const [accountResult, requestsResult, contactsResult] = await Promise.all([
    supabase
      .from("workspace_payment_accounts")
      .select(
        "id,provider_account_id,status,charges_enabled,payouts_enabled,default_currency",
      )
      .eq("workspace_id", workspaceId)
      .eq("provider", STRIPE_PROVIDER)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("payment_requests")
      .select(
        "id,contact_id,status,description,amount_cents,currency,payment_url,provider_checkout_session_id,provider_payment_intent_id,due_at,paid_at,metadata,created_at,updated_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("contacts")
      .select("id,name,company,email,phone")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .limit(500),
  ]);

  if (tableMissing(accountResult.error) || tableMissing(requestsResult.error)) {
    return {
      account: null,
      contacts: [],
      configured: config.configured,
      migrationReady: false,
      paymentRequests: [],
      stats: {
        currency: "AUD",
        overdueAmountCents: 0,
        overdueCount: 0,
        outstandingAmountCents: 0,
        outstandingCount: 0,
        paidThisMonthCents: 0,
        paidThisWeekCents: 0,
        totalPaidCents: 0,
      },
      webhookConfigured: config.webhookConfigured,
      webhookUrl: stripeWebhookUrl(),
    };
  }

  if (accountResult.error) {
    throw new Error(`Unable to load payment account: ${accountResult.error.message}`);
  }

  if (requestsResult.error) {
    throw new Error(`Unable to load payment requests: ${requestsResult.error.message}`);
  }

  if (contactsResult.error) {
    throw new Error(`Unable to load payment contacts: ${contactsResult.error.message}`);
  }

  const contacts = (contactsResult.data ?? []) as ContactRow[];
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const rows = (requestsResult.data ?? []) as PaymentRequestRow[];
  const weekStart = startOfWeek().getTime();
  const monthStart = startOfMonth().getTime();
  const now = Date.now();
  const currency =
    rows[0]?.currency ??
    ((accountResult.data as PaymentAccountRow | null)?.default_currency || "AUD");

  const stats = rows.reduce(
    (current, row) => {
      const amount = centsValue(row.amount_cents);

      if (isPaid(row)) {
        current.totalPaidCents += amount;

        const paidTime = new Date(row.paid_at ?? row.updated_at).getTime();

        if (paidTime >= weekStart) {
          current.paidThisWeekCents += amount;
        }

        if (paidTime >= monthStart) {
          current.paidThisMonthCents += amount;
        }
      } else if (isOpen(row)) {
        current.outstandingAmountCents += amount;
        current.outstandingCount += 1;

        if (row.due_at && new Date(row.due_at).getTime() < now) {
          current.overdueAmountCents += amount;
          current.overdueCount += 1;
        }
      }

      return current;
    },
    {
      currency,
      overdueAmountCents: 0,
      overdueCount: 0,
      outstandingAmountCents: 0,
      outstandingCount: 0,
      paidThisMonthCents: 0,
      paidThisWeekCents: 0,
      totalPaidCents: 0,
    },
  );

  return {
    account: accountResult.data
      ? {
          chargesEnabled: Boolean((accountResult.data as PaymentAccountRow).charges_enabled),
          defaultCurrency: (accountResult.data as PaymentAccountRow).default_currency,
          payoutsEnabled: Boolean((accountResult.data as PaymentAccountRow).payouts_enabled),
          providerAccountId: (accountResult.data as PaymentAccountRow).provider_account_id,
          status: (accountResult.data as PaymentAccountRow).status,
        }
      : null,
    contacts: contacts.map((contact) => ({
      company: contact.company,
      email: contact.email,
      id: contact.id,
      label: contactLabel(contact),
      phone: contact.phone,
    })),
    configured: config.configured,
    migrationReady: true,
    paymentRequests: rows.map((row) => ({
      amountCents: centsValue(row.amount_cents),
      contactId: row.contact_id,
      contactLabel: requestContactLabel(row.contact_id ? contactById.get(row.contact_id) : null),
      createdAt: row.created_at,
      currency: row.currency,
      description: row.description,
      dueAt: row.due_at,
      id: row.id,
      metadata: row.metadata ?? {},
      paidAt: row.paid_at,
      paymentUrl: row.payment_url,
      status: row.status,
      updatedAt: row.updated_at,
    })),
    stats,
    webhookConfigured: config.webhookConfigured,
    webhookUrl: stripeWebhookUrl(),
  };
}
