import {
  appendRealtimeAssistantMessage,
  appendUserAssistantMessage,
  maybeSaveAssistantMemory,
} from "../../../../../lib/assistant/persistence";
import { normalizeAssistantLinks } from "../../../../../lib/assistant/web-search";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  const body = objectRecord(await request.json().catch(() => ({})));
  const threadId = textValue(body.threadId);
  const userTranscript = textValue(body.userTranscript);
  const assistantTranscript = textValue(body.assistantTranscript);
  const links = normalizeAssistantLinks(body.links);
  const model = textValue(body.model) ?? "gpt-realtime-2";
  const provider = textValue(body.provider) ?? "openai";

  if (!threadId) {
    return Response.json({ error: "Thread id is required." }, { status: 400 });
  }

  if (!userTranscript && !assistantTranscript) {
    return Response.json({ error: "No realtime transcript to save." }, { status: 400 });
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let userMessageId: string | null = null;

  if (userTranscript) {
    userMessageId = await appendUserAssistantMessage({
      content: userTranscript,
      inputSource: "realtime_voice",
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

  if (assistantTranscript) {
    await appendRealtimeAssistantMessage({
      content: assistantTranscript,
      links,
      model,
      provider,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
  }

  revalidatePath("/");
  revalidatePath("/assistant");
  revalidatePath("/voice");

  return Response.json({
    data: {
      assistantSaved: Boolean(assistantTranscript),
      userMessageId,
      userSaved: Boolean(userTranscript),
    },
  });
}
