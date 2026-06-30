import { refreshAssistantPromptSuggestionsForUser } from "../../../../../lib/assistant/prompt-suggestions";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WorkspaceMemberRow = {
  user_id: unknown;
  workspace_id: unknown;
};

type WorkspaceRow = {
  id: unknown;
  name: unknown;
};

type WorkspaceMapEntry = readonly [
  string,
  {
    id: string;
    name: string;
  },
];

function syncSecret() {
  return envSecrets("ASSISTANT_SUGGESTION_REFRESH_SECRET", "CRON_SECRET");
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampLimit(value: string | null) {
  const parsed = Number(value ?? "200");

  if (!Number.isFinite(parsed)) {
    return 200;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 500);
}

async function runScheduledPromptSuggestionRefresh(request: Request) {
  const expectedSecrets = syncSecret();

  if (expectedSecrets.length === 0) {
    return Response.json(
      {
        error:
          "ASSISTANT_SUGGESTION_REFRESH_SECRET or CRON_SECRET is not configured.",
      },
      { status: 501 },
    );
  }

  if (!hasAnyValidRequestSecret(request, expectedSecrets)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = textValue(url.searchParams.get("workspaceId"));
  const userId = textValue(url.searchParams.get("userId"));
  const limit = clampLimit(url.searchParams.get("limit"));
  const supabase = createServiceSupabaseClient();
  let memberQuery = supabase
    .from("workspace_members")
    .select("workspace_id,user_id")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (workspaceId) {
    memberQuery = memberQuery.eq("workspace_id", workspaceId);
  }

  if (userId) {
    memberQuery = memberQuery.eq("user_id", userId);
  }

  const { data: members, error: membersError } = await memberQuery;

  if (membersError) {
    return Response.json(
      { error: `Unable to load workspace members: ${membersError.message}` },
      { status: 500 },
    );
  }

  const memberRows = ((members ?? []) as WorkspaceMemberRow[])
    .map((member) => ({
      userId: textValue(member.user_id),
      workspaceId: textValue(member.workspace_id),
    }))
    .filter(
      (
        member,
      ): member is {
        userId: string;
        workspaceId: string;
      } => Boolean(member.userId && member.workspaceId),
    );
  const workspaceIds = [
    ...new Set(memberRows.map((member) => member.workspaceId)),
  ];

  if (workspaceIds.length === 0) {
    return Response.json({
      refreshed: 0,
      results: [],
    });
  }

  const { data: workspaceRows, error: workspacesError } = await supabase
    .from("workspaces")
    .select("id,name")
    .in("id", workspaceIds);

  if (workspacesError) {
    return Response.json(
      { error: `Unable to load workspaces: ${workspacesError.message}` },
      { status: 500 },
    );
  }

  const workspaceEntries = ((workspaceRows ?? []) as WorkspaceRow[])
    .map((workspace): WorkspaceMapEntry | null => {
      const id = textValue(workspace.id);

      if (!id) {
        return null;
      }

      return [
        id,
        {
          id,
          name: textValue(workspace.name) ?? "Workspace",
        },
      ] as const;
    })
    .filter((entry): entry is WorkspaceMapEntry => Boolean(entry));
  const workspacesById = new Map(workspaceEntries);
  const results = [];

  for (const member of memberRows) {
    const workspace = workspacesById.get(member.workspaceId);

    if (!workspace) {
      results.push({
        error: "Workspace record was not found.",
        ok: false,
        userId: member.userId,
        workspaceId: member.workspaceId,
      });
      continue;
    }

    try {
      const result = await refreshAssistantPromptSuggestionsForUser({
        supabase,
        trigger: "weekly",
        userId: member.userId,
        workspace,
      });

      results.push({
        ok: true,
        result,
        userId: member.userId,
        workspaceId: member.workspaceId,
      });
    } catch (error) {
      results.push({
        error:
          error instanceof Error
            ? error.message
            : "Prompt suggestion refresh failed.",
        ok: false,
        userId: member.userId,
        workspaceId: member.workspaceId,
      });
    }
  }

  return Response.json({
    refreshed: results.filter((result) => result.ok).length,
    results,
  });
}

export async function GET(request: Request) {
  return runScheduledPromptSuggestionRefresh(request);
}

export async function POST(request: Request) {
  return runScheduledPromptSuggestionRefresh(request);
}
