import { NextResponse, type NextRequest } from "next/server";
import { normalizeAssistantUiBlocks } from "../../../../../lib/assistant/ui-blocks";
import { isVoiceCallTableMissing } from "../../../../../lib/voice/calls";
import { getApiWorkspaceContext } from "../../../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const context = await getApiWorkspaceContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const { supabase, workspace } = context;
  const params = request.nextUrl.searchParams;
  const callId = textValue(params.get("callId"));
  const threadId = textValue(params.get("threadId"));
  const since = textValue(params.get("since"));

  if (!callId && !threadId) {
    return NextResponse.json({ data: [] });
  }

  let query = supabase
    .from("voice_call_events")
    .select("id,event_type,payload,created_at")
    .eq("workspace_id", workspace.id)
    .like("event_type", "tool.%.completed")
    .order("created_at", { ascending: false })
    .limit(50);

  if (since && !Number.isNaN(Date.parse(since))) {
    query = query.gt("created_at", since);
  }

  const { data, error } = await query;

  if (error) {
    if (isVoiceCallTableMissing(error)) {
      return NextResponse.json({ data: [] });
    }

    return NextResponse.json(
      { error: `Unable to load Vapi tool blocks: ${error.message}` },
      { status: 500 },
    );
  }

  const items = (data ?? [])
    .map((row) => {
      const payload = objectRecord(row.payload);
      const result = objectRecord(payload.kyroToolResult);
      const providerCallId = textValue(payload.kyroProviderCallId);
      const eventThreadId = textValue(payload.kyroThreadId);
      const matchesThread = Boolean(threadId && eventThreadId === threadId);
      const matchesCall = Boolean(callId && providerCallId === callId);

      if ((threadId || callId) && !matchesThread && !matchesCall) {
        return null;
      }

      const uiBlocks =
        normalizeAssistantUiBlocks(payload.uiBlocks).length > 0
          ? normalizeAssistantUiBlocks(payload.uiBlocks)
          : normalizeAssistantUiBlocks(result.uiBlocks);

      if (uiBlocks.length === 0) {
        return null;
      }

      return {
        callId: providerCallId,
        createdAt: String(row.created_at),
        id: String(row.id),
        threadId: eventThreadId,
        toolName: textValue(payload.kyroToolName),
        uiBlocks,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .reverse();

  return NextResponse.json({ data: items });
}
