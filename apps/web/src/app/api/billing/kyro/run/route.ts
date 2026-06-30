import { NextRequest, NextResponse } from "next/server";
import {
  chargeDueKyroInvoices,
  runKyroBillingCycle,
} from "../../../../../lib/billing/kyro-billing-engine";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function expectedSecret() {
  return envSecrets(
    "KYRO_BILLING_RUN_SECRET",
    "OUTBOUND_DELIVERY_SECRET",
    "CRON_SECRET",
  );
}

function autoChargeEnabled(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("charge");

  if (explicit === "1" || explicit === "true") {
    return true;
  }

  if (explicit === "0" || explicit === "false") {
    return false;
  }

  const configured = process.env.KYRO_BILLING_AUTO_CHARGE?.trim().toLowerCase();

  if (configured === "false" || configured === "0" || configured === "no") {
    return false;
  }

  return true;
}

function chargeDeveloperAccountsEnabled(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("includeDevCharges");

  if (explicit === "1" || explicit === "true") {
    return true;
  }

  return (
    process.env.KYRO_BILLING_CHARGE_DEV_ACCOUNTS?.trim().toLowerCase() ===
    "true"
  );
}

async function handle(request: NextRequest) {
  const secrets = expectedSecret();

  if (secrets.length === 0) {
    return NextResponse.json(
      {
        error:
          "KYRO_BILLING_RUN_SECRET, OUTBOUND_DELIVERY_SECRET, or CRON_SECRET is not configured.",
      },
      { status: 500 },
    );
  }

  if (
    !hasAnyValidRequestSecret(request, secrets, {
      queryParamNames: ["secret"],
    })
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const periodStart = request.nextUrl.searchParams.get("periodStart");
  const periodEnd = request.nextUrl.searchParams.get("periodEnd");
  const autoCharge = autoChargeEnabled(request);
  const includeDeveloperAccounts = chargeDeveloperAccountsEnabled(request);
  const cycle = await runKyroBillingCycle({
    autoCharge,
    includeDeveloperAccounts,
    periodEnd: periodEnd || undefined,
    periodStart: periodStart || undefined,
    supabase,
  });
  const retryResults = autoCharge
    ? await chargeDueKyroInvoices({ includeDeveloperAccounts, supabase })
    : [];

  return NextResponse.json({
    autoCharge,
    includeDeveloperAccounts,
    generated: cycle.results.length,
    ok: true,
    period: cycle.period,
    retryAttempts: retryResults.length,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
