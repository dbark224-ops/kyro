import { NextResponse, type NextRequest } from "next/server";
import { getAssistantThreadState } from "../../../../../../lib/assistant/persistence";
import { getVapiInternalVoiceSession } from "../../../../../../lib/assistant/vapi-internal";
import { getApiWorkspaceContext } from "../../../../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const context = await getApiWorkspaceContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const { supabase, user, workspace } = context;
  const threadId = textValue(request.nextUrl.searchParams.get("threadId"));
  const threadState = await getAssistantThreadState({
    supabase,
    threadId,
    user,
    workspace,
  });
  const session = await getVapiInternalVoiceSession({
    supabase,
    threadState,
    user,
    workspace,
  });

  return NextResponse.json({
    data: {
      session,
      thread: {
        messages: threadState.messages.slice(-12),
        summary: threadState.summary ?? null,
        threadId: threadState.threadId ?? null,
      },
    },
  });
}
