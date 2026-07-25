import { NextRequest, NextResponse } from "next/server";
import { acknowledgeUrgentEscalation } from "../../../../lib/escalation/urgent-escalation";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return new NextResponse("Invalid escalation acknowledgement link.", {
      status: 400,
    });
  }

  const incident = await acknowledgeUrgentEscalation(
    createServiceSupabaseClient(),
    { token },
  );

  return new NextResponse(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kyro escalation</title></head><body style="margin:0;background:#090a0f;color:#fff;font-family:Arial,sans-serif;display:grid;min-height:100vh;place-items:center;"><main style="max-width:560px;padding:36px;text-align:center;"><h1 style="font-size:28px;margin:0 0 12px;">${incident ? "Escalation acknowledged" : "Escalation already closed"}</h1><p style="color:#cbd5e1;line-height:1.5;margin:0;">${incident ? "Kyro has stopped the remaining escalation steps." : "No further action is required for this link."}</p></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
