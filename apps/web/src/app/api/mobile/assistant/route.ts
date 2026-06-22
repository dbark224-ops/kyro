import { runAssistantTurn } from "../../../../lib/assistant/engine";
import {
  appendStoredAttachmentContext,
  storeAssistantAttachmentsFromFormData,
} from "../../../../lib/assistant/attachments";
import {
  appendAssistantTurnMessage,
  appendUserAssistantMessage,
  getAssistantThreadState,
  getAssistantTurnContext,
  getOrCreateAssistantThread,
  maybeSaveAssistantMemory,
  updateAssistantThreadSummary,
} from "../../../../lib/assistant/persistence";
import { getAssistantRouteMetrics } from "../../../../lib/assistant/route-metrics";
import type { AssistantThreadState } from "../../../../lib/assistant/types";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const state = await getMobileAssistantState({
      supabase,
      threadId: null,
      user,
      workspace,
    });

    return Response.json(state);
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = await readAssistantRequestPayload(request, {
      supabase,
      user,
      workspaceId: workspace.id,
    });
    const inputSource = payload.inputSource;
    const prompt = payload.prompt;

    if (!prompt.trim()) {
      return Response.json({ error: "Ask Kyro something first." }, { status: 400 });
    }

    const thread = await getOrCreateAssistantThread(supabase, workspace, user);
    const threadId = String(thread.id);
    const userMessageId = await appendUserAssistantMessage({
      content: prompt,
      inputSource,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const context = await getAssistantTurnContext({
      prompt,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const assistantMessage = await runAssistantTurn({
      inputSource,
      memories: context.memories,
      prompt,
      recentMessages: context.recentMessages,
      supabase,
      threadId,
      threadSummary: context.summary,
      user,
      workspace,
    });
    const memorySaved = await maybeSaveAssistantMemory({
      prompt,
      sourceMessageId: userMessageId,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });

    await appendAssistantTurnMessage({
      memorySaved,
      result: assistantMessage,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    await updateAssistantThreadSummary({
      prompt,
      result: assistantMessage,
      supabase,
      threadId,
      workspaceId: workspace.id,
    });

    return Response.json(
      await getMobileAssistantState({
        supabase,
        threadId,
        user,
        workspace,
      }),
    );
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

async function readAssistantRequestPayload(
  request: Request,
  context: {
    supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
    user: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["user"];
    workspaceId: string;
  },
) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const formData = await request.formData();
    const submittedPrompt = formString(formData, "prompt");
    const inputSource =
      formString(formData, "inputSource") === "voice" ? "voice" : "typed";
    const storedAttachments = await storeAssistantAttachmentsFromFormData({
      formData,
      supabase: context.supabase,
      user: context.user,
      workspaceId: context.workspaceId,
    });

    return {
      inputSource,
      prompt: appendStoredAttachmentContext(submittedPrompt, storedAttachments),
    };
  }

  const body = objectRecord(await request.json().catch(() => ({})));

  return {
    inputSource: textValue(body.inputSource) === "voice" ? "voice" : "typed",
    prompt: textValue(body.prompt) ?? "",
  };
}

async function getMobileAssistantState({
  supabase,
  threadId,
  user,
  workspace,
}: Parameters<typeof getAssistantThreadState>[0]) {
  const metrics = await getAssistantRouteMetrics(supabase, workspace.id);
  const welcomeMessage: AssistantThreadState["messages"][number] = {
    content:
      "I am connected to Kyro's CRM data, help manual, and assistant model. Ask me about the work queue, quotes, customers, settings, or how to use Kyro.",
    createdAt: new Date().toISOString(),
    id: "assistant-welcome",
    links: [
      { href: "/inbox", label: "Inbox", meta: `${metrics.needsReply} need reply` },
      {
        href: "/documents",
        label: "Documents",
        meta: `${metrics.readyQuotes} ready quotes`,
      },
    ],
    role: "assistant",
  };
  const state = await getAssistantThreadState({
    supabase,
    threadId,
    user,
    welcomeMessage,
    workspace,
  });

  return {
    ...state,
    metrics,
    workspace,
  };
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}
