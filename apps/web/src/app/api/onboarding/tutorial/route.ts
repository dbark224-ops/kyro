import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

const DASHBOARD_TOUR_VERSION = 1;

type TutorialRow = {
  dashboard_tour_completed_at: string | null;
  dashboard_tour_version: number | null;
};

type TutorialQuery = {
  maybeSingle(): Promise<{
    data: TutorialRow | null;
    error: { message: string } | null;
  }>;
};

type TutorialSupabaseClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): TutorialQuery;
    };
    upsert(
      values: Record<string, unknown>,
      options: { onConflict: string },
    ): Promise<{ error: { message: string } | null }>;
  };
};

function completedFromRow(row: TutorialRow | null) {
  return Boolean(
    row?.dashboard_tour_completed_at &&
      (row.dashboard_tour_version ?? 1) >= DASHBOARD_TOUR_VERSION,
  );
}

export async function GET() {
  const { supabase, workspace } = await requireWorkspaceContext();
  const tutorialSupabase = supabase as unknown as TutorialSupabaseClient;

  const { data, error } = await tutorialSupabase
    .from("workspace_tutorial_state")
    .select("dashboard_tour_completed_at,dashboard_tour_version")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `Unable to load tutorial state: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    completed: completedFromRow(data),
    version: DASHBOARD_TOUR_VERSION,
  });
}

export async function POST(request: Request) {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const tutorialSupabase = supabase as unknown as TutorialSupabaseClient;
  const body = (await request.json().catch(() => ({}))) as {
    completed?: unknown;
  };
  const completed = body.completed !== false;

  const { error } = await tutorialSupabase
    .from("workspace_tutorial_state")
    .upsert(
      {
        dashboard_tour_completed_at: completed ? new Date().toISOString() : null,
        dashboard_tour_completed_by: completed ? user.id : null,
        dashboard_tour_version: DASHBOARD_TOUR_VERSION,
        workspace_id: workspace.id,
      },
      { onConflict: "workspace_id" },
    );

  if (error) {
    return NextResponse.json(
      { error: `Unable to update tutorial state: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    completed,
    version: DASHBOARD_TOUR_VERSION,
  });
}
