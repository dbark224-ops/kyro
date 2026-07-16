import { NextRequest, NextResponse } from "next/server";
import { retryBackgroundJob } from "../../../../lib/background/jobs";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secrets = envSecrets("BACKGROUND_JOB_SECRET", "CRON_SECRET");

  if (
    secrets.length === 0 ||
    !hasAnyValidRequestSecret(request, secrets, {
      queryParamNames: ["secret"],
    })
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    jobId?: unknown;
  } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const retried = await retryBackgroundJob(
    createServiceSupabaseClient(),
    jobId,
  );

  return NextResponse.json({ ok: true, retried });
}
