import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../lib/http/request-secret";
import { discardStaleDraftReplies } from "../../../../lib/communication/stale-draft";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanupSecret() {
  return envSecrets("BACKGROUND_JOB_SECRET", "CRON_SECRET");
}

/**
 * Discards drafted replies nobody ever approved, six months on.
 *
 * Runs daily rather than on the minute: a draft that has sat for six months is
 * not urgent at six months and a day, and a slow sweep is easier to notice
 * going wrong than a fast one.
 */
async function runDraftCleanup(request: Request) {
  const expectedSecrets = cleanupSecret();

  if (expectedSecrets.length === 0) {
    return Response.json(
      { error: "Draft cleanup secret is not configured." },
      { status: 503 },
    );
  }

  if (!hasAnyValidRequestSecret(request, expectedSecrets)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "200");
  const olderThanDays = Number(url.searchParams.get("olderThanDays") ?? "");

  const result = await discardStaleDraftReplies(createServiceSupabaseClient(), {
    limit: Number.isFinite(limit) ? limit : 200,
    ...(Number.isFinite(olderThanDays) && olderThanDays > 0
      ? { olderThanDays }
      : {}),
    workspaceId: url.searchParams.get("workspaceId"),
  });

  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return runDraftCleanup(request);
}

export async function POST(request: Request) {
  return runDraftCleanup(request);
}
