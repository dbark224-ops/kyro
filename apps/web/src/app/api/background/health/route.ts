import { NextRequest, NextResponse } from "next/server";
import {
  getBackgroundQueueMetrics,
  unhealthyBackgroundQueueMetrics,
} from "../../../../lib/background/jobs";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: NextRequest) {
  const secrets = envSecrets("BACKGROUND_JOB_SECRET", "CRON_SECRET");

  if (
    secrets.length === 0 ||
    !hasAnyValidRequestSecret(request, secrets, {
      queryParamNames: ["secret"],
    })
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const metrics = await getBackgroundQueueMetrics(
    createServiceSupabaseClient(),
  );
  const unhealthy = unhealthyBackgroundQueueMetrics(metrics);

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      healthy: unhealthy.length === 0,
      metrics,
      unhealthy,
    },
    { status: unhealthy.length === 0 ? 200 : 503 },
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
