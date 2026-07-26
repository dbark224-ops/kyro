import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "../supabase/service";
import { getKyroUserBillingSettings } from "./kyro-user-billing";
import { textValue } from "@kyro/core";

export type WorkspaceBillingAccessStatus =
  | "trial"
  | "active"
  | "grace"
  | "restricted"
  | "cancelled";

export type WorkspaceBillingAccess = {
  dunningStage: number;
  graceEndsAt: string | null;
  graceStartedAt: string | null;
  latestFailureAt: string | null;
  latestInvoiceId: string | null;
  nextDunningAt: string | null;
  reason: string | null;
  restrictedAt: string | null;
  status: WorkspaceBillingAccessStatus;
  trialEndsAt: string | null;
  workspaceId: string;
};

type BillingAccessRow = {
  dunning_stage: unknown;
  grace_ends_at: unknown;
  grace_started_at: unknown;
  latest_failure_at: unknown;
  latest_invoice_id: unknown;
  next_dunning_at: unknown;
  reason: unknown;
  restricted_at: unknown;
  status: unknown;
  trial_ends_at: unknown;
  workspace_id: unknown;
};

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function billingGraceDays() {
  const configured = Number(process.env.KYRO_BILLING_GRACE_DAYS ?? "7");
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(30, Math.round(configured)))
    : 7;
}

function boolValue(value: unknown) {
  if (value === true || value === 1) {
    return true;
  }

  return typeof value === "string"
    ? ["1", "true", "yes", "y"].includes(value.trim().toLowerCase())
    : false;
}

function developerEmails() {
  return [
    process.env.KYRO_BILLING_DEV_EMAILS,
    process.env.KYRO_DEVELOPER_EMAILS,
  ]
    .join(",")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function workspaceIsDeveloper(
  supabase: SupabaseClient,
  ownerUserId: string | null,
) {
  if (!ownerUserId) {
    return false;
  }

  const { data, error } = await supabase.auth.admin.getUserById(ownerUserId);

  if (error || !data.user) {
    return false;
  }

  const metadata =
    data.user.app_metadata && typeof data.user.app_metadata === "object"
      ? (data.user.app_metadata as Record<string, unknown>)
      : {};
  const email = data.user.email?.trim().toLowerCase() ?? "";

  return (
    boolValue(metadata.developer) ||
    boolValue(metadata.mobileDeveloper) ||
    developerEmails().includes(email)
  );
}

function normalizeAccess(row: BillingAccessRow): WorkspaceBillingAccess {
  const status = textValue(row.status);

  return {
    dunningStage: Math.max(0, Math.round(numberValue(row.dunning_stage))),
    graceEndsAt: textValue(row.grace_ends_at),
    graceStartedAt: textValue(row.grace_started_at),
    latestFailureAt: textValue(row.latest_failure_at),
    latestInvoiceId: textValue(row.latest_invoice_id),
    nextDunningAt: textValue(row.next_dunning_at),
    reason: textValue(row.reason),
    restrictedAt: textValue(row.restricted_at),
    status:
      status === "trial" ||
      status === "grace" ||
      status === "restricted" ||
      status === "cancelled"
        ? status
        : "active",
    trialEndsAt: textValue(row.trial_ends_at),
    workspaceId: String(row.workspace_id),
  };
}

export async function getWorkspaceBillingAccess(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_billing_access")
    .select(
      "workspace_id,status,reason,trial_ends_at,grace_started_at,grace_ends_at,restricted_at,latest_invoice_id,latest_failure_at,dunning_stage,next_dunning_at",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load billing access: ${error.message}`);
  }

  return data ? normalizeAccess(data as BillingAccessRow) : null;
}

export async function reconcileWorkspaceBillingAccess(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const [existing, settingsResult, workspaceResult, invoiceResult] =
    await Promise.all([
      getWorkspaceBillingAccess(serviceSupabase, workspaceId),
      getKyroUserBillingSettings(serviceSupabase, workspaceId),
      serviceSupabase
        .from("workspaces")
        .select("owner_user_id")
        .eq("id", workspaceId)
        .maybeSingle(),
      serviceSupabase
        .from("kyro_invoices")
        .select("id,status,failed_at,paid_at,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (workspaceResult.error) {
    throw new Error(
      `Unable to load billing workspace owner: ${workspaceResult.error.message}`,
    );
  }

  if (invoiceResult.error) {
    throw new Error(
      `Unable to load latest billing invoice: ${invoiceResult.error.message}`,
    );
  }

  const ownerUserId = textValue(workspaceResult.data?.owner_user_id);
  const isDeveloper = await workspaceIsDeveloper(serviceSupabase, ownerUserId);
  const trialEndsAt = settingsResult.trialEndsAt;
  const trialEndMs = dateValue(trialEndsAt);
  const latestInvoice = invoiceResult.data as Record<string, unknown> | null;
  const invoiceStatus = textValue(latestInvoice?.status);
  const invoiceId = textValue(latestInvoice?.id);
  const invoiceFailureAt = textValue(latestInvoice?.failed_at);
  const trialExpiredWithoutPayment = Boolean(
    trialEndMs &&
    trialEndMs <= now.getTime() &&
    !settingsResult.defaultPaymentMethodReady,
  );
  const paymentFailed = invoiceStatus === "payment_failed";
  const previousStatus = existing?.status ?? null;
  let status: WorkspaceBillingAccessStatus = "active";
  let reason: string | null = null;
  let graceStartedAt: string | null = null;
  let graceEndsAt: string | null = null;
  let restrictedAt: string | null = null;
  let latestFailureAt: string | null = null;

  if (isDeveloper) {
    reason = "developer_account";
  } else if (trialEndMs && trialEndMs > now.getTime()) {
    status = "trial";
    reason = "free_trial";
  } else if (paymentFailed || trialExpiredWithoutPayment) {
    reason = paymentFailed
      ? "payment_failed"
      : "trial_ended_without_payment_method";
    const failureAnchor =
      dateValue(invoiceFailureAt) ??
      (trialExpiredWithoutPayment ? trialEndMs : null) ??
      now.getTime();
    const canReuseExistingGrace =
      existing &&
      existing.reason === reason &&
      existing.graceStartedAt &&
      existing.graceEndsAt;
    graceStartedAt = canReuseExistingGrace
      ? existing.graceStartedAt
      : new Date(failureAnchor).toISOString();
    graceEndsAt = canReuseExistingGrace
      ? existing.graceEndsAt
      : addDays(new Date(failureAnchor), billingGraceDays()).toISOString();
    latestFailureAt = paymentFailed
      ? (invoiceFailureAt ?? nowIso)
      : new Date(failureAnchor).toISOString();

    if ((dateValue(graceEndsAt) ?? 0) <= now.getTime()) {
      status = "restricted";
      restrictedAt = existing?.restrictedAt ?? nowIso;
    } else {
      status = "grace";
    }
  }

  const recovered =
    status === "active" &&
    (previousStatus === "grace" || previousStatus === "restricted");
  const changedState = previousStatus !== status || existing?.reason !== reason;
  const dunningStage = recovered
    ? (existing?.dunningStage ?? 0)
    : changedState
      ? 0
      : (existing?.dunningStage ?? 0);
  const { data, error } = await serviceSupabase
    .from("workspace_billing_access")
    .upsert(
      {
        dunning_stage: dunningStage,
        grace_ends_at: graceEndsAt,
        grace_started_at: graceStartedAt,
        latest_failure_at: latestFailureAt,
        latest_invoice_id: invoiceId,
        metadata: {
          defaultPaymentMethodReady: settingsResult.defaultPaymentMethodReady,
          developerBypass: isDeveloper,
          previousStatus,
          setupStatus: settingsResult.setupStatus,
        },
        next_dunning_at:
          status === "grace" || status === "restricted" ? nowIso : null,
        reason,
        recovered_at: recovered ? nowIso : null,
        restricted_at: restrictedAt,
        status,
        trial_ends_at: trialEndsAt,
        workspace_id: workspaceId,
      },
      { onConflict: "workspace_id" },
    )
    .select(
      "workspace_id,status,reason,trial_ends_at,grace_started_at,grace_ends_at,restricted_at,latest_invoice_id,latest_failure_at,dunning_stage,next_dunning_at",
    )
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to reconcile billing access: ${error?.message ?? "unknown error"}`,
    );
  }

  return {
    access: normalizeAccess(data as BillingAccessRow),
    recovered,
    previousStatus,
  };
}

export class BillingAccessRestrictedError extends Error {
  readonly code = "billing_access_restricted";
  readonly status = 402;

  constructor() {
    super(
      "Paid Kyro automation is paused because billing needs attention. Update the payment method in Settings > Usage and billing to resume it.",
    );
    this.name = "BillingAccessRestrictedError";
  }
}

export async function assertWorkspaceAutomationAllowed(workspaceId: string) {
  const serviceSupabase = createServiceSupabaseClient();
  const existing = await getWorkspaceBillingAccess(
    serviceSupabase,
    workspaceId,
  );
  const graceExpired = Boolean(
    existing?.status === "grace" &&
    existing.graceEndsAt &&
    new Date(existing.graceEndsAt).getTime() <= Date.now(),
  );
  const access =
    existing && !graceExpired
      ? existing
      : (await reconcileWorkspaceBillingAccess(serviceSupabase, workspaceId))
          .access;

  if (access.status === "restricted" || access.status === "cancelled") {
    throw new BillingAccessRestrictedError();
  }

  return access;
}
