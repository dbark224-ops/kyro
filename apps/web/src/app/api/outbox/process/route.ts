import { processDueOutboundMessages } from "../../../../lib/communication/outbound";
import {
  envSecret,
  hasValidRequestSecret,
} from "../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function syncSecret() {
  return envSecret(
    "OUTBOUND_DELIVERY_SECRET",
    "INBOUND_EMAIL_SYNC_SECRET",
    "CRON_SECRET",
  );
}

async function runOutboxProcessor(request: Request) {
  const expectedSecret = syncSecret();

  if (!expectedSecret) {
    return Response.json(
      {
        error:
          "OUTBOUND_DELIVERY_SECRET, INBOUND_EMAIL_SYNC_SECRET, or CRON_SECRET is not configured.",
      },
      { status: 501 },
    );
  }

  if (!hasValidRequestSecret(request, expectedSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const workspaceId = url.searchParams.get("workspaceId");
  const supabase = createServiceSupabaseClient();
  const result = await processDueOutboundMessages(supabase, {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 25,
    workspaceId,
  });

  return Response.json(result);
}

export async function GET(request: Request) {
  return runOutboxProcessor(request);
}

export async function POST(request: Request) {
  return runOutboxProcessor(request);
}
