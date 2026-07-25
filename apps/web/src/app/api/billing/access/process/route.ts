import { NextRequest, NextResponse } from "next/server";
import { runBackgroundJobCycle } from "../../../../../lib/background/jobs";
import { processBillingAccessCycle } from "../../../../../lib/billing/dunning";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: NextRequest) {
  const secrets = envSecrets(
    "KYRO_BILLING_RUN_SECRET",
    "OUTBOUND_DELIVERY_SECRET",
    "CRON_SECRET",
  );

  if (
    secrets.length === 0 ||
    !hasAnyValidRequestSecret(request, secrets, {
      queryParamNames: ["secret"],
    })
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const supabase = createServiceSupabaseClient();

  if (workspaceId) {
    const results = await processBillingAccessCycle(supabase, {
      limit: 1,
      workspaceId,
    });

    return NextResponse.json({
      checked: results.length,
      errors: results.filter((result) => !result.ok).length,
      ok: true,
      results,
    });
  }

  const results = await runBackgroundJobCycle(supabase, {
    claimLimit: 40,
    jobTypes: ["billing_access"],
  });

  return NextResponse.json({
    ...results,
    ok: true,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
