import {
  appendRealtimeAssistantMessage,
  appendUserAssistantMessage,
  maybeSaveAssistantMemory,
} from "../../../../../lib/assistant/persistence";
import { normalizeAssistantLinks } from "../../../../../lib/assistant/web-search";
import {
  buildRealtimeUsageEvents,
  openAiRealtimeUsageFromResponse,
  toUsageEventRows,
  usageEventTotals,
} from "../../../../../lib/usage/openai";
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
  const responseId = textValue(body.responseId);
  const realtimeUsage = openAiRealtimeUsageFromResponse({
    id: responseId,
    usage: body.usage,
  });

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

  let assistantMessageId: string | null = null;

  if (assistantTranscript) {
    assistantMessageId = await appendRealtimeAssistantMessage({
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

  let usageRecorded = false;

  if (assistantTranscript && provider === "openai" && realtimeUsage) {
    const usageEvents = buildRealtimeUsageEvents({
      context: {
        metadata: {
          assistantMessageId,
          linkCount: links.length,
          source: "assistant.realtime_voice",
          threadId,
          userMessageId,
        },
        providerUsageId: responseId,
        userId: user.id,
        workspaceId: workspace.id,
      },
      model,
      usage: realtimeUsage,
    });
    const usageTotals = usageEventTotals(usageEvents);

    if (usageEvents.length > 0) {
      const { data: aiRun, error: aiRunError } = await supabase
        .from("ai_runs")
        .insert({
          actual_cost: String(usageTotals.costSnapshot),
          completed_at: new Date().toISOString(),
          estimated_cost: String(usageTotals.costSnapshot),
          input_refs: {
            responseId,
            source: "assistant.realtime_voice",
            threadId,
            userMessageId,
          },
          mode: "assistant",
          model,
          output: {
            assistantMessageId,
            assistantTranscript,
            linkCount: links.length,
            userTranscript,
          },
          provider,
          risk_level: "low",
          status: "completed",
          task_type: "realtime_voice",
          tool_calls: [],
          usage: {
            audioInputTokens: realtimeUsage.audioInputTokens,
            audioOutputTokens: realtimeUsage.audioOutputTokens,
            cachedInputTokens: realtimeUsage.cachedInputTokens,
            customerCharge: usageTotals.customerChargeSnapshot,
            inputTokens: realtimeUsage.inputTokens,
            outputTokens: realtimeUsage.outputTokens,
            reasoningTokens: realtimeUsage.reasoningTokens,
            textInputTokens: realtimeUsage.textInputTokens,
            textOutputTokens: realtimeUsage.textOutputTokens,
            totalTokens: realtimeUsage.totalTokens,
          },
          user_id: user.id,
          workspace_id: workspace.id,
        })
        .select("id")
        .single();

      if (aiRunError || !aiRun) {
        throw new Error(
          `Unable to record realtime usage run: ${aiRunError?.message ?? "unknown error"}`,
        );
      }

      const aiRunId = String(aiRun.id);
      const { error: usageError } = await supabase
        .from("usage_events")
        .insert(
          toUsageEventRows(
            usageEvents.map((event) => ({
              ...event,
              aiRunId,
              sourceId: aiRunId,
              sourceType: "ai_run",
            })),
          ),
        );

      if (usageError) {
        throw new Error(`Unable to record realtime usage: ${usageError.message}`);
      }

      usageRecorded = true;
    }
  }

  revalidatePath("/");
  revalidatePath("/assistant");
  revalidatePath("/voice");

  return Response.json({
    data: {
      assistantMessageId,
      assistantSaved: Boolean(assistantTranscript),
      userMessageId,
      userSaved: Boolean(userTranscript),
      usageRecorded,
    },
  });
}
