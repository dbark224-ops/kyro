import { NextRequest, NextResponse } from "next/server";
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobType,
  drainBackgroundJobs,
} from "../../../../lib/background/jobs";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function expectedSecrets() {
  return envSecrets("BACKGROUND_JOB_SECRET", "CRON_SECRET");
}

function clamp(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(Math.trunc(parsed), max))
    : fallback;
}

function requestedJobTypes(request: NextRequest) {
  const requested = request.nextUrl.searchParams
    .get("types")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!requested || requested.length === 0) {
    return null;
  }

  const allowed = new Set<string>(BACKGROUND_JOB_TYPES);
  return requested.filter((value): value is BackgroundJobType =>
    allowed.has(value),
  );
}

async function handle(request: NextRequest) {
  const secrets = expectedSecrets();

  if (
    secrets.length === 0 ||
    !hasAnyValidRequestSecret(request, secrets, {
      queryParamNames: ["secret"],
    })
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await drainBackgroundJobs(createServiceSupabaseClient(), {
    claimLimit: clamp(request.nextUrl.searchParams.get("limit"), 40, 200),
    jobTypes: requestedJobTypes(request),
    leaseSeconds: clamp(
      request.nextUrl.searchParams.get("leaseSeconds"),
      300,
      1800,
    ),
    scheduleLimit: clamp(
      request.nextUrl.searchParams.get("scheduleLimit"),
      1000,
      5000,
    ),
    maxCycles: clamp(request.nextUrl.searchParams.get("maxCycles"), 10, 25),
    timeBudgetMs: 240_000,
    workspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
