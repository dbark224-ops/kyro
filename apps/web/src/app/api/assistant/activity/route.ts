import { NextResponse, type NextRequest } from "next/server";
import { getAssistantExternalActivity } from "../../../../lib/assistant/external-activity";
import { getApiWorkspaceContext } from "../../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";

function boundedLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 12;
  }

  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

export async function GET(request: NextRequest) {
  const context = await getApiWorkspaceContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const limit = boundedLimit(request.nextUrl.searchParams.get("limit"));
  const items = await getAssistantExternalActivity(
    context.supabase,
    context.workspace.id,
    limit,
  );

  return NextResponse.json({ data: items });
}
