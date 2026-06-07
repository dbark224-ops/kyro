import { NextResponse, type NextRequest } from "next/server";
import { createOutboundVoiceCall } from "../../../../lib/voice/calls";
import { getApiWorkspaceContext } from "../../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  try {
    const context = await getApiWorkspaceContext(request);

    if (context instanceof NextResponse) {
      return context;
    }

    const { supabase, user, workspace } = context;
    const phoneNumber = textValue(body.phoneNumber);

    if (!phoneNumber) {
      return NextResponse.json(
        { error: "phoneNumber is required." },
        { status: 400 },
      );
    }

    const result = await createOutboundVoiceCall({
      contactId: textValue(body.contactId),
      conversationId: textValue(body.conversationId),
      instructions: textValue(body.instructions),
      leadId: textValue(body.leadId),
      phoneNumber,
      supabase,
      threadId: textValue(body.threadId),
      user,
      workspaceId: workspace.id,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start outbound call.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
