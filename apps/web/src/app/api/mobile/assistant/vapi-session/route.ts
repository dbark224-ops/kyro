import { getAssistantThreadState } from "../../../../../lib/assistant/persistence";
import { getVapiInternalVoiceSession } from "../../../../../lib/assistant/vapi-internal";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const threadState = await getAssistantThreadState({
      supabase,
      threadId: null,
      user,
      workspace,
    });
    const session = await getVapiInternalVoiceSession({
      supabase,
      threadState,
      user,
      workspace,
    });

    return Response.json({
      assistantId: session.assistantId,
      assistantOverrides: session.assistantOverrides,
      configured: session.configured,
      missing: session.missing,
      publicKey: session.publicKey,
      threadId: session.threadId,
      voiceLabel: session.voiceLabel,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
