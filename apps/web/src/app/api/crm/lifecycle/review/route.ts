import { runContactLifecycleReview } from "../../../../../lib/crm/lifecycle-review";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function syncSecret() {
  return envSecrets("CRM_LIFECYCLE_REVIEW_SECRET", "CRON_SECRET");
}

async function runScheduledLifecycleReview(request: Request) {
  const expectedSecrets = syncSecret();

  if (expectedSecrets.length === 0) {
    return Response.json(
      {
        error: "CRM_LIFECYCLE_REVIEW_SECRET or CRON_SECRET is not configured.",
      },
      { status: 501 },
    );
  }

  if (!hasAnyValidRequestSecret(request, expectedSecrets)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const contactId = url.searchParams.get("contactId");
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const supabase = createServiceSupabaseClient();

  const workspaceQuery = supabase
    .from("workspaces")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(200);

  const { data: workspaces, error } = workspaceId
    ? await workspaceQuery.eq("id", workspaceId)
    : await workspaceQuery;

  if (error) {
    return Response.json(
      { error: `Unable to load workspaces: ${error.message}` },
      { status: 500 },
    );
  }

  const results = [];

  for (const workspace of workspaces ?? []) {
    const id = String(workspace.id);

    try {
      const result = await runContactLifecycleReview(supabase, id, {
        contactId,
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100,
      });

      results.push({
        ok: true,
        result,
        workspaceId: id,
      });
    } catch (error) {
      results.push({
        error:
          error instanceof Error ? error.message : "Lifecycle review failed.",
        ok: false,
        workspaceId: id,
      });
    }
  }

  return Response.json({
    results,
    workspaceCount: workspaces?.length ?? 0,
  });
}

export async function GET(request: Request) {
  return runScheduledLifecycleReview(request);
}

export async function POST(request: Request) {
  return runScheduledLifecycleReview(request);
}
