import { NextResponse, type NextRequest } from "next/server";
import { getBillableUsageSummary } from "../../../../lib/billing/usage-summary";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { getPrimaryWorkspace } from "../../../../lib/workspace/bootstrap";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  const search = request.nextUrl.searchParams;

  try {
    const summary = await getBillableUsageSummary(supabase, workspace.id, {
      anchor: search.get("anchor"),
      end: search.get("end"),
      period: search.get("period"),
      start: search.get("start"),
      userId: search.get("userId"),
    });

    return NextResponse.json({
      data: summary,
      meta: {
        billingSystemReady: true,
        source: "usage_events.customer_charge_snapshot",
        usage:
          "Read-only usage summary feeding Kyro-owned billing periods, invoices, and optional Stripe off-session charges.",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to calculate billable usage.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
