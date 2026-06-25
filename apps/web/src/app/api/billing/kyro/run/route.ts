import { NextRequest, NextResponse } from "next/server";
import {
  chargeDueKyroInvoices,
  runKyroBillingCycle,
} from "../../../../../lib/billing/kyro-billing-engine";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function expectedSecret() {
  return (
    process.env.KYRO_BILLING_RUN_SECRET?.trim() ??
    process.env.OUTBOUND_DELIVERY_SECRET?.trim() ??
    process.env.CRON_SECRET?.trim() ??
    null
  );
}

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.nextUrl.searchParams.get("secret")?.trim() ?? null;
}

function autoChargeEnabled(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("charge");

  if (explicit === "1" || explicit === "true") {
    return true;
  }

  return process.env.KYRO_BILLING_AUTO_CHARGE?.trim().toLowerCase() === "true";
}

async function handle(request: NextRequest) {
  const secret = expectedSecret();

  if (!secret) {
    return NextResponse.json(
      {
        error:
          "KYRO_BILLING_RUN_SECRET, OUTBOUND_DELIVERY_SECRET, or CRON_SECRET is not configured.",
      },
      { status: 500 },
    );
  }

  if (bearerToken(request) !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const periodStart = request.nextUrl.searchParams.get("periodStart");
  const periodEnd = request.nextUrl.searchParams.get("periodEnd");
  const autoCharge = autoChargeEnabled(request);
  const cycle = await runKyroBillingCycle({
    autoCharge,
    periodEnd: periodEnd || undefined,
    periodStart: periodStart || undefined,
    supabase,
  });
  const retryResults = autoCharge
    ? await chargeDueKyroInvoices({ supabase })
    : [];

  return NextResponse.json({
    autoCharge,
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
