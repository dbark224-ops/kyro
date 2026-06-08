import {
  appendRealtimeAssistantMessage,
  appendUserAssistantMessage,
  maybeSaveAssistantMemory,
} from "../../../../../lib/assistant/persistence";
import {
  mobileErrorResponse,
  MobileApiError,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const body = objectRecord(await request.json().catch(() => ({})));
    const threadId = textValue(body.threadId);
    const userTranscript = textValue(body.userTranscript);
    const assistantTranscript = textValue(body.assistantTranscript);

    if (!threadId) {
      throw new MobileApiError("Thread id is required.", 400);
    }

    if (!userTranscript && !assistantTranscript) {
      throw new MobileApiError("No Vapi transcript was provided.", 400);
    }

    let userMessageId: string | null = null;

    if (userTranscript) {
      userMessageId = await appendUserAssistantMessage({
        content: userTranscript,
        inputSource: "vapi_internal_voice",
        supabase,
        threadId,
        user,
        workspaceId: workspace.id,
      });

      await maybeSaveAssistantMemory({
        prompt: userTranscript,
        sourceMessageId: userMessageId,
        supabase,
        threadId,
        user,
        workspaceId: workspace.id,
      });
    }

    let assistantMessageId: string | null = null;

    if (assistantTranscript) {
      assistantMessageId = await appendRealtimeAssistantMessage({
        content: assistantTranscript,
        model: "vapi-mobile-internal",
        provider: "vapi",
        supabase,
        threadId,
        user,
        workspaceId: workspace.id,
      });
    }

    return Response.json({
      assistantMessageId,
      assistantSaved: Boolean(assistantTranscript),
      userMessageId,
      userSaved: Boolean(userTranscript),
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
