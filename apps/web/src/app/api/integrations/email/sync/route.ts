import type { User } from "@supabase/supabase-js";
import { runBackgroundJobCycle } from "../../../../../lib/background/jobs";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import { syncInboundEmail } from "../../../../../lib/integrations/inbound-email-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runScheduledSync(request: Request) {
  const secrets = envSecrets("INBOUND_EMAIL_SYNC_SECRET", "CRON_SECRET");

  if (secrets.length === 0 || !hasAnyValidRequestSecret(request, secrets)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const supabase = createServiceSupabaseClient();

  if (workspaceId) {
    const { data: workspace, error } = await supabase
      .from("workspaces")
      .select("id,owner_user_id")
      .eq("id", workspaceId)
      .maybeSingle();

    if (error || !workspace?.owner_user_id) {
      return Response.json(
        { error: error?.message ?? "Workspace owner is unavailable." },
        { status: error ? 500 : 404 },
      );
    }

    const result = await syncInboundEmail({
      supabase,
      trigger: "scheduled",
      user: { id: String(workspace.owner_user_id) } as User,
      workspaceId,
    });

    return Response.json({ ok: true, result, workspaceId });
  }

  const result = await runBackgroundJobCycle(supabase, {
    claimLimit: 40,
    jobTypes: ["inbound_email_sync"],
  });

  return Response.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return runScheduledSync(request);
}

export async function POST(request: Request) {
  return runScheduledSync(request);
}
