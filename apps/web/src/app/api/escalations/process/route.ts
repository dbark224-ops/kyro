import { NextRequest, NextResponse } from "next/server";
import { processDueUrgentEscalations } from "../../../../lib/escalation/urgent-escalation";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: NextRequest) {
  const secrets = envSecrets(
    "URGENT_ESCALATION_SECRET",
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

  const results = await processDueUrgentEscalations(
    createServiceSupabaseClient(),
  );

  return NextResponse.json({
    attempted: results.length,
    failed: results.filter((result) => "sent" in result && !result.sent).length,
    ok: true,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
