import { cleanupExpiredVoiceCallRecordings } from "../../../../../lib/voice/calls";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function syncSecret() {
  return (
    process.env.VOICE_RECORDING_RETENTION_SECRET?.trim() ??
    process.env.OUTBOUND_DELIVERY_SECRET?.trim() ??
    process.env.INBOUND_EMAIL_SYNC_SECRET?.trim() ??
    process.env.CRON_SECRET?.trim() ??
    ""
  );
}

function requestSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-kyro-sync-secret")?.trim() ?? "";
}

async function runRecordingCleanup(request: Request) {
  const expectedSecret = syncSecret();

  if (!expectedSecret) {
    return Response.json(
      {
        error:
          "VOICE_RECORDING_RETENTION_SECRET, OUTBOUND_DELIVERY_SECRET, INBOUND_EMAIL_SYNC_SECRET, or CRON_SECRET is not configured.",
      },
      { status: 501 },
    );
  }

  if (requestSecret(request) !== expectedSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const workspaceId = url.searchParams.get("workspaceId");
  const supabase = createServiceSupabaseClient();
  const result = await cleanupExpiredVoiceCallRecordings(supabase, {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    workspaceId,
  });

  return Response.json(result);
}

export async function GET(request: Request) {
  return runRecordingCleanup(request);
}

export async function POST(request: Request) {
  return runRecordingCleanup(request);
}
