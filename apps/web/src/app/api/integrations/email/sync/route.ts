import type { User } from "@supabase/supabase-js";
import { syncInboundEmail } from "../../../../../lib/integrations/inbound-email-sync";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function syncSecret() {
  return (
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

function scheduledUser(ownerUserId: string): User {
  return { id: ownerUserId } as User;
}

async function runScheduledSync(request: Request) {
  const expectedSecret = syncSecret();

  if (!expectedSecret) {
    return Response.json(
      { error: "INBOUND_EMAIL_SYNC_SECRET or CRON_SECRET is not configured." },
      { status: 501 },
    );
  }

  if (requestSecret(request) !== expectedSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id,owner_user_id")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return Response.json(
      { error: `Unable to load workspaces: ${error.message}` },
      { status: 500 },
    );
  }

  const results = [];

  for (const workspace of workspaces ?? []) {
    const workspaceId = String(workspace.id);
    const ownerUserId = String(workspace.owner_user_id);

    try {
      const result = await syncInboundEmail({
        supabase,
        trigger: "scheduled",
        user: scheduledUser(ownerUserId),
        workspaceId,
      });

      results.push({
        ok: true,
        result,
        workspaceId,
      });
    } catch (error) {
      results.push({
        error:
          error instanceof Error
            ? error.message
            : "Scheduled email sync failed.",
        ok: false,
        workspaceId,
      });
    }
  }

  return Response.json({
    results,
    workspaceCount: workspaces?.length ?? 0,
  });
}

export async function GET(request: Request) {
  return runScheduledSync(request);
}

export async function POST(request: Request) {
  return runScheduledSync(request);
}
