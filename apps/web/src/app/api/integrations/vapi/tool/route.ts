import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { resolveAssistantCommand } from "../../../../../lib/assistant/commands";
import {
  assistantWebSearchEnabled,
  runAssistantWebSearch,
} from "../../../../../lib/assistant/web-search";
import {
  syncInboundEmail,
  type InboundEmailProvider,
} from "../../../../../lib/integrations/inbound-email-sync";
import { verifyVapiToolRequest } from "../../../../../lib/integrations/vapi";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import {
  buildLlmUsageEvents,
  buildOpenAiWebSearchCallUsageEvent,
  openAiUsageFromTokenCounts,
  toUsageEventRows,
  usageEventTotals,
} from "../../../../../lib/usage/openai";
import {
  lookupVoiceContactsForTool,
  recordVoiceToolEvent,
  vapiToolCallPayload,
  vapiToolUserId,
  vapiToolWorkspaceId,
} from "../../../../../lib/voice/calls";
import type { WorkspaceSummary } from "../../../../../lib/workspace/bootstrap";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toolResultText(result: Record<string, unknown>) {
  const answer = textValue(result.answer) ?? textValue(result.message);
  const sources = Array.isArray(result.sources)
    ? result.sources
        .map((source) => {
          const sourceRecord =
            source && typeof source === "object"
              ? (source as Record<string, unknown>)
              : {};
          const label = textValue(sourceRecord.label);
          const href = textValue(sourceRecord.href);

          return label && href ? `${label}: ${href}` : href;
        })
        .filter((source): source is string => Boolean(source))
    : [];

  if (answer) {
    return singleLine(
      sources.length > 0
        ? `${answer} Sources: ${sources.slice(0, 4).join("; ")}`
        : answer,
    );
  }

  return singleLine(JSON.stringify(result));
}

function toolResponse(
  result: Record<string, unknown>,
  toolCallId?: string | null,
) {
  const resultText = toolResultText(result);

  return NextResponse.json({
    ...result,
    result,
    results: toolCallId
      ? [
          {
            result: resultText,
            toolCallId,
          },
        ]
      : undefined,
  });
}

function toolUser(userId: string): User {
  return { id: userId } as User;
}

async function loadWorkspace(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  workspaceId: string,
): Promise<WorkspaceSummary> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `Unable to load Vapi tool workspace: ${error?.message ?? "not found"}`,
    );
  }

  return {
    id: String(data.id),
    name: String(data.name),
    slug: String(data.slug),
  };
}

async function recordWebSearchUsage({
  prompt,
  result,
  supabase,
  userId,
  workspaceId,
}: {
  prompt: string;
  result: Awaited<ReturnType<typeof runAssistantWebSearch>>;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  userId: string;
  workspaceId: string;
}) {
  if (result.fallbackReason) {
    return;
  }

  const model =
    process.env.ASSISTANT_WEB_SEARCH_MODEL?.trim() ||
    process.env.OPENAI_BALANCED_MODEL?.trim() ||
    process.env.ASSISTANT_MODEL?.trim() ||
    "gpt-4.1-mini";
  const tokenUsage =
    result.tokenUsage ??
    openAiUsageFromTokenCounts({
      estimated: true,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  const usageEvents = buildLlmUsageEvents({
    context: {
      metadata: { source: "vapi_internal_voice_web_search_tool" },
      providerUsageId: result.providerUsageId,
      userId,
      workspaceId,
    },
    model,
    provider: "openai",
    service: "llm",
    usage: tokenUsage,
  });

  if (result.webSearchUsed) {
    usageEvents.push(
      buildOpenAiWebSearchCallUsageEvent({
        context: {
          metadata: { source: "vapi_internal_voice_web_search_tool" },
          providerUsageId: result.providerUsageId,
          userId,
          workspaceId,
        },
        model,
      }),
    );
  }

  const totals = usageEventTotals(usageEvents);
  const { data: aiRun } = await supabase
    .from("ai_runs")
    .insert({
      actual_cost: String(totals.costSnapshot),
      completed_at: new Date().toISOString(),
      estimated_cost: String(totals.costSnapshot),
      input_refs: { prompt, source: "vapi_internal_voice_tool" },
      mode: "tool",
      model,
      output: {
        sourceCount: result.sources.length,
        webSearchUsed: result.webSearchUsed,
      },
      provider: "openai",
      risk_level: "low",
      status: "completed",
      task_type: "web_search",
      tool_calls: [],
      usage: {
        cachedInputTokens: tokenUsage.cachedInputTokens,
        customerCharge: totals.customerChargeSnapshot,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        reasoningTokens: tokenUsage.reasoningTokens,
        totalTokens: tokenUsage.totalTokens,
      },
      user_id: userId,
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (!aiRun?.id) {
    return;
  }

  const aiRunId = String(aiRun.id);

  await supabase.from("usage_events").insert(
    toUsageEventRows(
      usageEvents.map((event) => ({
        ...event,
        aiRunId,
        sourceId: aiRunId,
        sourceType: "ai_run",
      })),
    ),
  );
}

export async function POST(request: Request) {
  if (!verifyVapiToolRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  let toolCallId: string | null = null;

  try {
    const toolCall = vapiToolCallPayload(payload);
    toolCallId = toolCall.id ?? null;
    const workspaceId = vapiToolWorkspaceId(payload);

    if (!workspaceId) {
      return toolResponse(
        {
          message: "Kyro could not resolve a workspace for this tool call.",
          ok: false,
        },
        toolCallId,
      );
    }

    const supabase = createServiceSupabaseClient();
    const args = toolCall.arguments;
    const userId = vapiToolUserId(payload);
    const prompt =
      textValue(args.prompt) ??
      textValue(args.query) ??
      textValue(args.request) ??
      textValue(args.message);

    await recordVoiceToolEvent({
      eventType: `tool.${toolCall.name ?? "unknown"}.requested`,
      payload,
      providerCallId: toolCall.callId,
      supabase,
      workspaceId,
    });

    if (toolCall.name === "kyro_lookup_contact") {
      const contacts = await lookupVoiceContactsForTool({
        phoneNumber: textValue(args.phoneNumber),
        query: textValue(args.query),
        supabase,
        workspaceId,
      });

      return toolResponse(
        {
          contacts,
          count: contacts.length,
          ok: true,
        },
        toolCallId,
      );
    }

    if (
      toolCall.name === "kyro_context_lookup" ||
      toolCall.name === "kyro_assistant_command"
    ) {
      if (!prompt || !userId) {
        return toolResponse(
          {
            message: "Kyro needs a prompt and user id for assistant context tools.",
            ok: false,
          },
          toolCallId,
        );
      }

      const workspace = await loadWorkspace(supabase, workspaceId);
      const result = await resolveAssistantCommand({
        prompt,
        supabase,
        user: toolUser(userId),
        workspace,
      });

      return toolResponse(
        {
          answer: result.fallbackAnswer,
          context: result.context,
          intent: result.intent,
          links: result.links,
          mutation: result.mutation ?? null,
          ok: true,
          title: result.title,
          uiBlocks: result.uiBlocks ?? [],
        },
        toolCallId,
      );
    }

    if (toolCall.name === "kyro_web_search") {
      if (!prompt || !userId) {
        return toolResponse(
          {
            message: "Kyro needs a search prompt and user id for web search.",
            ok: false,
          },
          toolCallId,
        );
      }

      if (!assistantWebSearchEnabled()) {
        return toolResponse(
          {
            message: "Web search is disabled for this Kyro environment.",
            ok: false,
          },
          toolCallId,
        );
      }

      const result = await runAssistantWebSearch({ prompt });

      await recordWebSearchUsage({
        prompt,
        result,
        supabase,
        userId,
        workspaceId,
      });

      return toolResponse(
        {
          answer: result.text,
          fallbackReason: result.fallbackReason ?? null,
          ok: true,
          sourceCount: result.sources.length,
          sources: result.sources,
          webSearchUsed: result.webSearchUsed,
        },
        toolCallId,
      );
    }

    if (toolCall.name === "kyro_check_recent_email") {
      if (!userId) {
        return toolResponse(
          {
            message: "Kyro needs a user id to check connected inboxes.",
            ok: false,
          },
          toolCallId,
        );
      }

      const providerArg = textValue(args.provider);
      const provider: InboundEmailProvider | undefined =
        providerArg === "google" || providerArg === "microsoft"
          ? providerArg
          : undefined;
      const result = await syncInboundEmail({
        provider,
        supabase,
        trigger: "assistant",
        user: toolUser(userId),
        workspaceId,
      });
      const answer =
        result.needsReconnect.length > 0
          ? `I checked email, but ${result.needsReconnect.length} connected account needs reconnecting with inbox-read permission. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
          : result.errors.length > 0
            ? `I checked email with ${result.errors.length} issue(s). I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
            : `I checked email. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages} into Kyro, observed ${result.observedMessages}, and skipped ${result.duplicates} duplicate(s).`;

      return toolResponse(
        {
          answer,
          ok: true,
          result,
        },
        toolCallId,
      );
    }

    if (toolCall.name === "kyro_record_call_note") {
      await recordVoiceToolEvent({
        eventType: "tool.kyro_record_call_note.completed",
        payload: {
          ...payload,
          kyroNote: textValue(args.note),
          kyroPriority: textValue(args.priority),
        },
        providerCallId: toolCall.callId,
        supabase,
        workspaceId,
      });

      return toolResponse(
        {
          ok: true,
          recorded: true,
        },
        toolCallId,
      );
    }

    return toolResponse(
      {
        message: `Unsupported Kyro voice tool: ${toolCall.name ?? "unknown"}.`,
        ok: false,
      },
      toolCallId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run Vapi tool.";

    return toolResponse(
      {
        message,
        ok: false,
      },
      toolCallId,
    );
  }
}
