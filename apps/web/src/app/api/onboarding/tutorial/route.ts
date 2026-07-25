import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

const DASHBOARD_TOUR_VERSION = 1;

type TutorialRow = {
  dashboard_tour_completed_at: string | null;
  dashboard_tour_force_show: boolean | null;
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
  if (row?.dashboard_tour_force_show) {
    return false;
  }

  return Boolean(
    row?.dashboard_tour_completed_at &&
      (row.dashboard_tour_version ?? 1) >= DASHBOARD_TOUR_VERSION,
  );
}

async function loadTutorialRow(
  tutorialSupabase: TutorialSupabaseClient,
  workspaceId: string,
) {
  const withForceShow = await tutorialSupabase
    .from("workspace_tutorial_state")
    .select(
      "dashboard_tour_completed_at,dashboard_tour_force_show,dashboard_tour_version",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!withForceShow.error) {
    return withForceShow;
  }

  const legacy = await tutorialSupabase
    .from("workspace_tutorial_state")
    .select("dashboard_tour_completed_at,dashboard_tour_version")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  return {
    ...legacy,
    data: legacy.data
      ? { ...legacy.data, dashboard_tour_force_show: false }
      : legacy.data,
  };
}

export async function GET() {
  const { supabase, workspace } = await requireWorkspaceContext();
  const tutorialSupabase = supabase as unknown as TutorialSupabaseClient;

  const { data, error } = await loadTutorialRow(tutorialSupabase, workspace.id);

  if (error) {
    return NextResponse.json(
      { error: `Unable to load tutorial state: ${error.message}` },
      { status: 500 },
    );
  }

  const completed = completedFromRow(data);

  return NextResponse.json({
    completed,
    forceShow: Boolean(data?.dashboard_tour_force_show),
    shouldShow: Boolean(data?.dashboard_tour_force_show) || !completed,
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
    shouldShow: !completed,
    version: DASHBOARD_TOUR_VERSION,
  });
}
