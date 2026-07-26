import { NextResponse } from "next/server";
import {
  buildReplyDraftPrompt,
  generateReplyDraft,
  type ReplyDraftContext,
} from "../../../../lib/ai/reply-draft-generation";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { textValue } from "@kyro/core";

export { buildReplyDraftPrompt, type ReplyDraftContext };

type ReplyDraftRequest = {
  conversationId?: unknown;
  prompt?: unknown;
  skippedEmailId?: unknown;
};

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as ReplyDraftRequest;
    const conversationId = textValue(input.conversationId);
    const skippedEmailId = textValue(input.skippedEmailId);
    const prompt = textValue(input.prompt);

    if (!conversationId && !skippedEmailId) {
      return NextResponse.json(
        { error: "A conversation or skipped email is required." },
        { status: 400 },
      );
    }

    const { supabase, user, workspace } = await requireWorkspaceContext();
    const draft = await generateReplyDraft({
      conversationId,
      prompt,
      skippedEmailId,
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    });

    return NextResponse.json({
      body: draft.body,
      subject: draft.subject,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to generate reply draft.";

    return NextResponse.json(
      { error: message },
      { status: message === "Unable to find reply context." ? 404 : 500 },
    );
  }
}
