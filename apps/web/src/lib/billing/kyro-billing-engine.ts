import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import { createStripePaymentIntent } from "../payments/stripe";
import {
  getKyroUserBillingOverview,
  type KyroUserBillingOverview,
} from "./kyro-user-billing";

export const KYRO_BILLING_INVOICE_FLOW = "kyro_user_billing_invoice";

type BillingStatus =
  | "draft"
  | "open"
  | "paid"
  | "payment_failed"
  | "charging"
  | "void";

type UsageAggregationRow = {
  cost_snapshot: unknown;
  currency: unknown;
  customer_charge_snapshot: unknown;
  id: unknown;
  provider: unknown;
  quantity: unknown;
  service: unknown;
  usage_type: unknown;
};

type WorkspaceBillingRow = {
  id: unknown;
  name: unknown;
};

type BillingPeriodRow = {
  id: unknown;
  status: unknown;
};

type InvoiceRow = {
  billing_period_id: unknown;
  currency: unknown;
  failure_count: unknown;
  id: unknown;
  invoice_number: unknown;
  status: unknown;
  stripe_customer_id: unknown;
  stripe_payment_intent_id: unknown;
  stripe_payment_method_id: unknown;
  total_amount: unknown;
  workspace_id: unknown;
};

type InvoiceLineItemInput = {
  amount: number;
  currency: string;
  description: string;
  kind: string;
  metadata?: Record<string, unknown>;
  provider?: string | null;
  quantity: number;
  service?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  taxAmount?: number;
  unitAmount: number;
  usageType?: string | null;
};

export type KyroBillingEngineOverview = {
  invoices: Array<{
    dueAt: string | null;
    failureCount: number;
    failedAt: string | null;
    id: string;
    invoiceNumber: string;
    issuedAt: string | null;
    lastError: string | null;
    nextRetryAt: string | null;
    paidAt: string | null;
    status: string;
    totalAmount: number;
    currency: string;
  }>;
  latestInvoice: {
    dueAt: string | null;
    id: string;
    invoiceNumber: string;
    lastError: string | null;
    nextRetryAt: string | null;
    status: string;
    totalAmount: number;
    currency: string;
  } | null;
  openInvoiceCount: number;
  pastDueInvoiceCount: number;
  periods: Array<{
    id: string;
    periodEnd: string;
    periodStart: string;
    status: string;
    totalAmount: number;
    currency: string;
  }>;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

function intValue(value: unknown) {
  const parsed = numberValue(value);

  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]?.trim());

  return Number.isFinite(parsed) ? parsed : fallback;
}

function envString(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function roundMoney(value: number) {
  return Number(value.toFixed(8));
}

function toMinorUnits(value: number) {
  return Math.max(0, Math.round(value * 100));
}

function addDaysIso(start: Date, days: number) {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString();
}

export function previousMonthlyBillingPeriod(anchor = new Date()) {
  const start = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1),
  );
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));

  return {
    end: end.toISOString(),
    start: start.toISOString(),
  };
}

function invoiceNumber(workspaceId: string, periodStart: string) {
  const date = new Date(periodStart);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");

  return `KYRO-${year}${month}-${workspaceId.slice(0, 8).toUpperCase()}`;
}

function billablePeriodStart(input: {
  billingOverview: KyroUserBillingOverview;
  periodStart: string;
  periodEnd: string;
}) {
  const trialEndsAt = textValue(input.billingOverview.settings.trialEndsAt);

  if (!trialEndsAt) {
    return input.periodStart;
  }

  const trialEnd = new Date(trialEndsAt);
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);

  if (Number.isNaN(trialEnd.getTime()) || trialEnd <= periodStart) {
    return input.periodStart;
  }

  if (trialEnd >= periodEnd) {
    return input.periodEnd;
  }

  return trialEnd.toISOString();
}

function proratedBasePlanAmount(input: {
  billableStart: string;
  periodStart: string;
  periodEnd: string;
}) {
  const monthlyPrice =
    envNumber("KYRO_BASE_MONTHLY_PRICE_CENTS", NaN) / 100 ||
    envNumber("KYRO_BASE_MONTHLY_PRICE_USD", 0);

  if (monthlyPrice <= 0) {
    return 0;
  }

  const periodStart = new Date(input.periodStart).getTime();
  const periodEnd = new Date(input.periodEnd).getTime();
  const billableStart = new Date(input.billableStart).getTime();
  const totalMs = Math.max(1, periodEnd - periodStart);
  const billableMs = Math.max(0, periodEnd - Math.max(periodStart, billableStart));

  return roundMoney(monthlyPrice * (billableMs / totalMs));
}

function taxRate() {
  return Math.max(0, envNumber("KYRO_BILLING_TAX_RATE_BPS", 0)) / 10_000;
}

function defaultBillingCurrency() {
  return envString("KYRO_BILLING_CURRENCY", "USD").toUpperCase();
}

async function loadUsageRows(input: {
  billableStart: string;
  periodEnd: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  if (new Date(input.billableStart) >= new Date(input.periodEnd)) {
    return [];
  }

  const { data, error } = await input.supabase
    .from("usage_events")
    .select(
      [
        "id",
        "provider",
        "service",
        "usage_type",
        "quantity",
        "currency",
        "cost_snapshot",
        "customer_charge_snapshot",
      ].join(","),
    )
    .eq("workspace_id", input.workspaceId)
    .gte("created_at", input.billableStart)
    .lt("created_at", input.periodEnd)
    .order("created_at", { ascending: true })
    .limit(100_000);

  if (error) {
    throw new Error(`Unable to load billing usage rows: ${error.message}`);
  }

  return (data ?? []) as unknown as UsageAggregationRow[];
}

function usageLineItems(rows: UsageAggregationRow[]) {
  const groups = new Map<string, InvoiceLineItemInput>();

  for (const row of rows) {
    const provider = textValue(row.provider) ?? "provider";
    const service = textValue(row.service) ?? "service";
    const usageType = textValue(row.usage_type) ?? "usage";
    const currency = (textValue(row.currency) ?? defaultBillingCurrency()).toUpperCase();
    const key = [provider, service, usageType, currency].join("|");
    const quantity = numberValue(row.quantity);
    const amount = numberValue(row.customer_charge_snapshot);
    const providerCost = numberValue(row.cost_snapshot);
    const current =
      groups.get(key) ??
      ({
        amount: 0,
        currency,
        description: `${service.replace(/_/g, " ")} - ${usageType.replace(/_/g, " ")}`,
        kind: "usage",
        metadata: {
          providerCost: 0,
          usageEventIds: [],
        },
        provider,
        quantity: 0,
        service,
        unitAmount: 0,
        usageType,
      } satisfies InvoiceLineItemInput);
    const metadata = current.metadata ?? {};
    const usageEventIds = Array.isArray(metadata.usageEventIds)
      ? metadata.usageEventIds
      : [];

    current.quantity += quantity;
    current.amount = roundMoney(current.amount + amount);
    current.unitAmount =
      current.quantity > 0 ? roundMoney(current.amount / current.quantity) : 0;
    current.metadata = {
      ...metadata,
      providerCost: roundMoney(numberValue(metadata.providerCost) + providerCost),
      usageEventIds: [...usageEventIds, textValue(row.id)].filter(Boolean),
    };
    groups.set(key, current);
  }

  return [...groups.values()].filter((item) => item.amount > 0);
}

async function upsertBillingPeriod(input: {
  currency: string;
  periodEnd: string;
  periodStart: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data: existing, error: existingError } = await input.supabase
    .from("kyro_billing_periods")
    .select("id,status")
    .eq("workspace_id", input.workspaceId)
    .eq("period_start", input.periodStart)
    .eq("period_end", input.periodEnd)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to load billing period: ${existingError.message}`);
  }

  if (existing) {
    return existing as BillingPeriodRow;
  }

  const { data, error } = await input.supabase
    .from("kyro_billing_periods")
    .insert({
      currency: input.currency,
      period_end: input.periodEnd,
      period_start: input.periodStart,
      status: "draft",
      workspace_id: input.workspaceId,
    })
    .select("id,status")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to create billing period: ${error?.message ?? "unknown error"}`,
    );
  }

  return data as BillingPeriodRow;
}

async function upsertInvoice(input: {
  billingOverview: KyroUserBillingOverview;
  billingPeriodId: string;
  currency: string;
  periodEnd: string;
  periodStart: string;
  supabase: SupabaseClient;
  totalAmount: number;
  workspaceId: string;
}) {
  const { data: existing, error: existingError } = await input.supabase
    .from("kyro_invoices")
    .select(
      "id,status,billing_period_id,invoice_number,total_amount,currency,failure_count,stripe_customer_id,stripe_payment_method_id,stripe_payment_intent_id,workspace_id",
    )
    .eq("billing_period_id", input.billingPeriodId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to load Kyro invoice: ${existingError.message}`);
  }

  if (existing) {
    return existing as InvoiceRow;
  }

  const now = new Date();
  const status: BillingStatus = input.totalAmount > 0 ? "open" : "paid";
  const { data, error } = await input.supabase
    .from("kyro_invoices")
    .insert({
      billing_period_id: input.billingPeriodId,
      currency: input.currency,
      due_at: addDaysIso(now, 7),
      invoice_number: invoiceNumber(input.workspaceId, input.periodStart),
      issued_at: now.toISOString(),
      paid_at: status === "paid" ? now.toISOString() : null,
      status,
      stripe_customer_id: input.billingOverview.settings.stripeCustomerId,
      stripe_payment_method_id:
        input.billingOverview.settings.stripePaymentMethodId,
      total_amount: input.totalAmount,
      workspace_id: input.workspaceId,
    })
    .select(
      "id,status,billing_period_id,invoice_number,total_amount,currency,failure_count,stripe_customer_id,stripe_payment_method_id,stripe_payment_intent_id,workspace_id",
    )
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to create Kyro invoice: ${error?.message ?? "unknown error"}`,
    );
  }

  return data as InvoiceRow;
}

async function replaceInvoiceLineItems(input: {
  billingPeriodId: string;
  invoiceId: string;
  items: InvoiceLineItemInput[];
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { error: deleteError } = await input.supabase
    .from("kyro_invoice_line_items")
    .delete()
    .eq("invoice_id", input.invoiceId)
    .eq("workspace_id", input.workspaceId);

  if (deleteError) {
    throw new Error(`Unable to refresh invoice line items: ${deleteError.message}`);
  }

  if (input.items.length === 0) {
    return;
  }

  const { error } = await input.supabase.from("kyro_invoice_line_items").insert(
    input.items.map((item) => ({
      amount: String(roundMoney(item.amount)),
      billing_period_id: input.billingPeriodId,
      currency: item.currency,
      description: item.description,
      invoice_id: input.invoiceId,
      kind: item.kind,
      metadata: item.metadata ?? {},
      provider: item.provider ?? null,
      quantity: String(roundMoney(item.quantity)),
      service: item.service ?? null,
      source_id: item.sourceId ?? null,
      source_type: item.sourceType ?? null,
      tax_amount: String(roundMoney(item.taxAmount ?? 0)),
      unit_amount: String(roundMoney(item.unitAmount)),
      usage_type: item.usageType ?? null,
      workspace_id: input.workspaceId,
    })),
  );

  if (error) {
    throw new Error(`Unable to create invoice line items: ${error.message}`);
  }
}

export async function generateKyroBillingInvoice(input: {
  periodEnd: string;
  periodStart: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const billingOverview = await getKyroUserBillingOverview(
    input.supabase,
    input.workspaceId,
  );
  const billableStart = billablePeriodStart({
    billingOverview,
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
  });
  const usageRows = await loadUsageRows({
    billableStart,
    periodEnd: input.periodEnd,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });
  const items = usageLineItems(usageRows);
  const usageAmount = roundMoney(items.reduce((total, item) => total + item.amount, 0));
  const providerCostAmount = roundMoney(
    items.reduce(
      (total, item) => total + numberValue(item.metadata?.providerCost),
      0,
    ),
  );
  const basePlanAmount = proratedBasePlanAmount({
    billableStart,
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
  });
  const currency = items[0]?.currency ?? defaultBillingCurrency();

  if (basePlanAmount > 0) {
    items.unshift({
      amount: basePlanAmount,
      currency,
      description: "Kyro monthly subscription",
      kind: "base_subscription",
      metadata: {
        billableStart,
        periodEnd: input.periodEnd,
        periodStart: input.periodStart,
      },
      quantity: 1,
      unitAmount: basePlanAmount,
    });
  }

  const subtotal = roundMoney(
    items
      .filter((item) => item.kind !== "tax")
      .reduce((total, item) => total + item.amount, 0),
  );
  const taxAmount = roundMoney(subtotal * taxRate());

  if (taxAmount > 0) {
    items.push({
      amount: taxAmount,
      currency,
      description: envString("KYRO_BILLING_TAX_LABEL", "Tax"),
      kind: "tax",
      metadata: {
        rateBps: envNumber("KYRO_BILLING_TAX_RATE_BPS", 0),
      },
      quantity: 1,
      taxAmount,
      unitAmount: taxAmount,
    });
  }

  const totalAmount = roundMoney(subtotal + taxAmount);
  const period = await upsertBillingPeriod({
    currency,
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });
  const periodId = String(period.id);
  const invoice = await upsertInvoice({
    billingOverview,
    billingPeriodId: periodId,
    currency,
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
    supabase: input.supabase,
    totalAmount,
    workspaceId: input.workspaceId,
  });
  const invoiceId = String(invoice.id);
  const invoiceStatus = textValue(invoice.status) ?? "draft";

  if (!["paid", "charging", "void"].includes(invoiceStatus)) {
    await replaceInvoiceLineItems({
      billingPeriodId: periodId,
      invoiceId,
      items,
      supabase: input.supabase,
      workspaceId: input.workspaceId,
    });

    const nextStatus: BillingStatus = totalAmount > 0 ? "open" : "paid";
    const paidAt = nextStatus === "paid" ? new Date().toISOString() : null;

    await input.supabase
      .from("kyro_invoices")
      .update({
        currency,
        paid_at: paidAt,
        provider_cost_amount: String(providerCostAmount),
        status: nextStatus,
        subtotal_amount: String(subtotal),
        tax_amount: String(taxAmount),
        total_amount: String(totalAmount),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", invoiceId);

    await input.supabase
      .from("kyro_billing_periods")
      .update({
        base_subscription_amount: String(basePlanAmount),
        currency,
        generated_at: new Date().toISOString(),
        invoice_id: invoiceId,
        provider_cost_amount: String(providerCostAmount),
        status: nextStatus,
        subtotal_amount: String(subtotal),
        tax_amount: String(taxAmount),
        total_amount: String(totalAmount),
        usage_amount: String(usageAmount),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", periodId);
  }

  await insertAuditLog(input.supabase, {
    workspaceId: input.workspaceId,
    actorType: "system",
    action: "kyro_billing.invoice_generated",
    entityType: "kyro_invoice",
    entityId: invoiceId,
    after: {
      billingPeriodId: periodId,
      currency,
      subtotal,
      taxAmount,
      totalAmount,
      usageRows: usageRows.length,
    },
  });

  return {
    billingPeriodId: periodId,
    invoiceId,
    invoiceNumber: textValue(invoice.invoice_number) ?? invoiceNumber(input.workspaceId, input.periodStart),
    status: totalAmount > 0 ? "open" : "paid",
    totalAmount,
    currency,
  };
}

function nextRetryAt(failureCount: number) {
  const hours = Math.min(24 * 7, Math.max(1, failureCount) * 24);
  const date = new Date();
  date.setUTCHours(date.getUTCHours() + hours);

  return date.toISOString();
}

export async function chargeKyroInvoice(input: {
  invoiceId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await input.supabase
    .from("kyro_invoices")
    .select(
      "id,workspace_id,billing_period_id,invoice_number,status,total_amount,currency,failure_count,stripe_customer_id,stripe_payment_method_id,stripe_payment_intent_id",
    )
    .eq("id", input.invoiceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load invoice for charging: ${error.message}`);
  }

  if (!data) {
    throw new Error("Kyro invoice not found.");
  }

  const invoice = data as InvoiceRow;
  const status = textValue(invoice.status) ?? "draft";
  const totalAmount = numberValue(invoice.total_amount);
  const workspaceId = String(invoice.workspace_id);
  const invoiceId = String(invoice.id);
  const customerId = textValue(invoice.stripe_customer_id);
  const paymentMethodId = textValue(invoice.stripe_payment_method_id);
  const failureCount = intValue(invoice.failure_count);
  const currency = textValue(invoice.currency) ?? defaultBillingCurrency();

  if (status === "paid") {
    return { invoiceId, status, charged: false };
  }

  if (totalAmount <= 0) {
    await markKyroInvoicePaid({
      eventId: null,
      paymentIntentId: null,
      supabase: input.supabase,
      workspaceId,
      invoiceId,
    });

    return { invoiceId, status: "paid", charged: false };
  }

  if (!customerId || !paymentMethodId) {
    const nextFailureCount = failureCount + 1;

    await input.supabase
      .from("kyro_invoices")
      .update({
        failed_at: new Date().toISOString(),
        failure_count: nextFailureCount,
        last_error: "Missing Stripe customer or saved payment method.",
        next_retry_at: nextRetryAt(nextFailureCount),
        status: "payment_failed",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", invoiceId);

    return {
      charged: false,
      invoiceId,
      status: "payment_failed",
    };
  }

  await input.supabase
    .from("kyro_invoices")
    .update({ status: "charging" })
    .eq("workspace_id", workspaceId)
    .eq("id", invoiceId);

  try {
    const paymentIntent = await createStripePaymentIntent({
      amountCents: toMinorUnits(totalAmount),
      currency,
      customerId,
      description: `Kyro invoice ${textValue(invoice.invoice_number) ?? invoiceId}`,
      metadata: {
        billingPeriodId: textValue(invoice.billing_period_id) ?? "",
        flow: KYRO_BILLING_INVOICE_FLOW,
        invoiceId,
        workspaceId,
      },
      paymentMethodId,
    });
    const paymentStatus = textValue(paymentIntent.status) ?? "unknown";

    if (paymentStatus === "succeeded") {
      await markKyroInvoicePaid({
        eventId: null,
        paymentIntentId: paymentIntent.id,
        supabase: input.supabase,
        workspaceId,
        invoiceId,
      });
    } else if (paymentStatus === "processing") {
      await input.supabase
        .from("kyro_invoices")
        .update({
          last_error: null,
          status: "charging",
          stripe_payment_intent_id: paymentIntent.id,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", invoiceId);
    } else {
      await markKyroInvoiceFailed({
        errorMessage:
          textValue(paymentIntent.last_payment_error?.message) ??
          `Stripe returned payment status ${paymentStatus}.`,
        eventId: null,
        paymentIntentId: paymentIntent.id,
        supabase: input.supabase,
        workspaceId,
        invoiceId,
      });
    }

    await insertAuditLog(input.supabase, {
      workspaceId,
      actorType: "system",
      action: "kyro_billing.invoice_charge_attempted",
      entityType: "kyro_invoice",
      entityId: invoiceId,
      after: {
        paymentIntentId: paymentIntent.id,
        status: paymentStatus,
        totalAmount,
      },
    });

    return {
      charged: paymentStatus === "succeeded",
      invoiceId,
      paymentIntentId: paymentIntent.id,
      status: paymentStatus === "succeeded" ? "paid" : paymentStatus,
    };
  } catch (error) {
    await markKyroInvoiceFailed({
      errorMessage:
        error instanceof Error ? error.message : "Stripe charge failed.",
      eventId: null,
      paymentIntentId: null,
      supabase: input.supabase,
      workspaceId,
      invoiceId,
    });

    return {
      charged: false,
      invoiceId,
      status: "payment_failed",
    };
  }
}

export async function markKyroInvoicePaid(input: {
  eventId: string | null;
  invoiceId: string;
  paymentIntentId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const now = new Date().toISOString();

  await input.supabase
    .from("kyro_invoices")
    .update({
      failed_at: null,
      last_error: null,
      next_retry_at: null,
      paid_at: now,
      status: "paid",
      stripe_last_event_id: input.eventId,
      ...(input.paymentIntentId
        ? { stripe_payment_intent_id: input.paymentIntentId }
        : {}),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.invoiceId);

  await input.supabase
    .from("kyro_billing_periods")
    .update({
      closed_at: now,
      status: "paid",
    })
    .eq("workspace_id", input.workspaceId)
    .eq("invoice_id", input.invoiceId);
}

export async function markKyroInvoiceFailed(input: {
  errorMessage: string;
  eventId: string | null;
  invoiceId: string;
  paymentIntentId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data } = await input.supabase
    .from("kyro_invoices")
    .select("failure_count")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.invoiceId)
    .maybeSingle();
  const failureCount = intValue(data?.failure_count) + 1;

  await input.supabase
    .from("kyro_invoices")
    .update({
      failed_at: new Date().toISOString(),
      failure_count: failureCount,
      last_error: input.errorMessage,
      next_retry_at: nextRetryAt(failureCount),
      status: "payment_failed",
      stripe_last_event_id: input.eventId,
      ...(input.paymentIntentId
        ? { stripe_payment_intent_id: input.paymentIntentId }
        : {}),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.invoiceId);

  await input.supabase
    .from("kyro_billing_periods")
    .update({ status: "payment_failed" })
    .eq("workspace_id", input.workspaceId)
    .eq("invoice_id", input.invoiceId);
}

export async function reconcileKyroInvoicePaymentIntent(input: {
  eventId: string;
  eventType: string;
  paymentIntent: Record<string, unknown>;
  supabase: SupabaseClient;
}) {
  const metadata =
    input.paymentIntent.metadata &&
    typeof input.paymentIntent.metadata === "object"
      ? (input.paymentIntent.metadata as Record<string, unknown>)
      : {};
  const invoiceId = textValue(metadata.invoiceId);
  const workspaceId = textValue(metadata.workspaceId);
  const paymentIntentId = textValue(input.paymentIntent.id);

  if (!invoiceId || !workspaceId || !paymentIntentId) {
    return false;
  }

  if (input.eventType === "payment_intent.succeeded") {
    await markKyroInvoicePaid({
      eventId: input.eventId,
      invoiceId,
      paymentIntentId,
      supabase: input.supabase,
      workspaceId,
    });

    return true;
  }

  if (input.eventType === "payment_intent.payment_failed") {
    const error = input.paymentIntent.last_payment_error;
    const message =
      error && typeof error === "object"
        ? textValue((error as Record<string, unknown>).message)
        : null;

    await markKyroInvoiceFailed({
      errorMessage: message ?? "Stripe reported payment failure.",
      eventId: input.eventId,
      invoiceId,
      paymentIntentId,
      supabase: input.supabase,
      workspaceId,
    });

    return true;
  }

  return false;
}

export async function runKyroBillingCycle(input: {
  autoCharge?: boolean;
  periodEnd?: string;
  periodStart?: string;
  supabase: SupabaseClient;
}) {
  const period = input.periodStart && input.periodEnd
    ? { end: input.periodEnd, start: input.periodStart }
    : previousMonthlyBillingPeriod();
  const { data: workspaces, error } = await input.supabase
    .from("workspaces")
    .select("id,name")
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Unable to load workspaces for billing: ${error.message}`);
  }

  const results = [];

  for (const workspace of (workspaces ?? []) as WorkspaceBillingRow[]) {
    const workspaceId = String(workspace.id);
    const generated = await generateKyroBillingInvoice({
      periodEnd: period.end,
      periodStart: period.start,
      supabase: input.supabase,
      workspaceId,
    });
    const chargeResult =
      input.autoCharge && generated.totalAmount > 0
        ? await chargeKyroInvoice({
            invoiceId: generated.invoiceId,
            supabase: input.supabase,
          })
        : null;

    results.push({
      chargeResult,
      generated,
      workspaceId,
    });
  }

  return {
    period,
    results,
  };
}

export async function chargeDueKyroInvoices(input: {
  supabase: SupabaseClient;
}) {
  const now = Date.now();
  const { data, error } = await input.supabase
    .from("kyro_invoices")
    .select("id,next_retry_at")
    .in("status", ["open", "payment_failed"])
    .gt("total_amount", 0)
    .limit(100);

  if (error) {
    throw new Error(`Unable to load due Kyro invoices: ${error.message}`);
  }

  const results = [];

  for (const invoice of (data ?? []) as Record<string, unknown>[]) {
    const retryAt = textValue(invoice.next_retry_at);

    if (retryAt && new Date(retryAt).getTime() > now) {
      continue;
    }

    results.push(
      await chargeKyroInvoice({
        invoiceId: String(invoice.id),
        supabase: input.supabase,
      }),
    );
  }

  return results;
}

export async function getKyroBillingEngineOverview(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<KyroBillingEngineOverview> {
  const [invoicesResult, periodsResult] = await Promise.all([
    supabase
      .from("kyro_invoices")
      .select(
        "id,invoice_number,status,total_amount,currency,issued_at,due_at,paid_at,failed_at,next_retry_at,failure_count,last_error",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("kyro_billing_periods")
      .select("id,status,period_start,period_end,total_amount,currency")
      .eq("workspace_id", workspaceId)
      .order("period_end", { ascending: false })
      .limit(6),
  ]);

  if (invoicesResult.error) {
    throw new Error(
      `Unable to load Kyro invoices: ${invoicesResult.error.message}`,
    );
  }

  if (periodsResult.error) {
    throw new Error(
      `Unable to load Kyro billing periods: ${periodsResult.error.message}`,
    );
  }

  const invoices = ((invoicesResult.data ?? []) as Record<string, unknown>[]).map(
    (invoice) => ({
      currency: textValue(invoice.currency) ?? defaultBillingCurrency(),
      dueAt: textValue(invoice.due_at),
      failedAt: textValue(invoice.failed_at),
      failureCount: intValue(invoice.failure_count),
      id: String(invoice.id),
      invoiceNumber: String(invoice.invoice_number),
      issuedAt: textValue(invoice.issued_at),
      lastError: textValue(invoice.last_error),
      nextRetryAt: textValue(invoice.next_retry_at),
      paidAt: textValue(invoice.paid_at),
      status: textValue(invoice.status) ?? "draft",
      totalAmount: numberValue(invoice.total_amount),
    }),
  );
  const now = Date.now();

  return {
    invoices,
    latestInvoice: invoices[0]
      ? {
          currency: invoices[0].currency,
          dueAt: invoices[0].dueAt,
          id: invoices[0].id,
          invoiceNumber: invoices[0].invoiceNumber,
          lastError: invoices[0].lastError,
          nextRetryAt: invoices[0].nextRetryAt,
          status: invoices[0].status,
          totalAmount: invoices[0].totalAmount,
        }
      : null,
    openInvoiceCount: invoices.filter((invoice) =>
      ["open", "payment_failed", "charging"].includes(invoice.status),
    ).length,
    pastDueInvoiceCount: invoices.filter((invoice) => {
      if (!invoice.dueAt || invoice.status === "paid") {
        return false;
      }

      return new Date(invoice.dueAt).getTime() < now;
    }).length,
    periods: ((periodsResult.data ?? []) as Record<string, unknown>[]).map(
      (period) => ({
        currency: textValue(period.currency) ?? defaultBillingCurrency(),
        id: String(period.id),
        periodEnd: String(period.period_end),
        periodStart: String(period.period_start),
        status: textValue(period.status) ?? "draft",
        totalAmount: numberValue(period.total_amount),
      }),
    ),
  };
}
