import { NextResponse, type NextRequest } from "next/server";
import {
  getAssistantPromptSuggestionState,
  refreshAssistantPromptSuggestionsForUser,
} from "../../../../lib/assistant/prompt-suggestions";
import { getApiWorkspaceContext } from "../../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const context = await getApiWorkspaceContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const state = await getAssistantPromptSuggestionState({
    supabase: context.supabase,
    userId: context.user.id,
    workspaceId: context.workspace.id,
  });

  return NextResponse.json({ data: state });
}

export async function POST(request: NextRequest) {
  const context = await getApiWorkspaceContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  try {
    const state = await refreshAssistantPromptSuggestionsForUser({
      periodEnd: textValue(payload.periodEnd),
      periodStart: textValue(payload.periodStart),
      supabase: context.supabase,
      trigger: "manual",
      userId: context.user.id,
      workspace: context.workspace,
    });

    return NextResponse.json({ data: state });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to refresh assistant prompt suggestions.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
