import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { cleanupExpiredVoiceCallRecordings } from "../../../../../lib/voice/calls";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function syncSecret() {
  return envSecrets(
    "VOICE_RECORDING_RETENTION_SECRET",
    "OUTBOUND_DELIVERY_SECRET",
    "INBOUND_EMAIL_SYNC_SECRET",
    "CRON_SECRET",
  );
}

async function runRecordingCleanup(request: Request) {
  const expectedSecrets = syncSecret();

  if (expectedSecrets.length === 0) {
    return Response.json(
      {
        error:
          "VOICE_RECORDING_RETENTION_SECRET, OUTBOUND_DELIVERY_SECRET, INBOUND_EMAIL_SYNC_SECRET, or CRON_SECRET is not configured.",
      },
      { status: 501 },
    );
  }

  if (!hasAnyValidRequestSecret(request, expectedSecrets)) {
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
