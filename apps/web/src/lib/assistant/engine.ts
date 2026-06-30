import type { SupabaseClient, User } from "@supabase/supabase-js";
import { selectModelRoute } from "@kyro/ai";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  buildLlmUsageEvents,
  buildOpenAiWebSearchCallUsageEvent,
  estimateTokens,
  openAiUsageFromTokenCounts,
  toUsageEventRows,
  usageEventTotals,
} from "../usage/openai";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import { resolveAssistantCommand } from "./commands";
import { runAssistantModel } from "./providers";
import {
  planAssistantToolCall,
  type AssistantToolPlanResult,
} from "./tool-planner";
import { linkCardsBlock } from "./ui-blocks";
import { dedupeAssistantLinks } from "./web-search";
import type {
  AssistantContextSnapshot,
  AssistantMemoryItem,
  AssistantModelRoute,
  AssistantRecentMessage,
  AssistantToolCallRecord,
  AssistantTurnResult,
} from "./types";

type WorkspaceInput = {
  id: string;
  name: string;
};

type RunAssistantTurnInput = {
  contextSnapshots?: AssistantContextSnapshot[];
  inputSource?: "typed" | "voice" | string;
  memories?: AssistantMemoryItem[];
  prompt: string;
  recentMessages?: AssistantRecentMessage[];
  supabase: SupabaseClient;
  threadId?: string | null;
  threadSummary?: string | null;
  user: User;
  workspace: WorkspaceInput;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function assistantProviderMode() {
  const configuredProvider = envValue("ASSISTANT_PROVIDER") || envValue("AI_PROVIDER");

  if (configuredProvider) {
    return configuredProvider.toLowerCase();
  }

  if (envValue("OPENAI_API_KEY") || envValue("VERCEL")) {
    return "openai";
  }

  return "ollama";
}

function assistantModel() {
  return envValue("ASSISTANT_MODEL") || envValue("OLLAMA_MODEL") || "qwen3:8b";
}

function routeAssistantModel(
  workspace: WorkspaceInput,
  user: User,
): AssistantModelRoute {
  const provider = assistantProviderMode();

  if (["ollama", "local"].includes(provider)) {
    return {
      model: assistantModel(),
      provider: "ollama",
      reason: "Local Ollama assistant provider selected for development.",
    };
  }

  const route = selectModelRoute({
    estimatedInputTokens: 1200,
    latencyTargetMs: 2200,
    requiredCapabilities: ["retrieval", "summarization", "command_routing"],
    riskLevel: "low",
    taskType: "assistant_chat",
    userId: user.id,
    workspaceId: workspace.id,
  });

  return route;
}

export async function runAssistantTurn({
  contextSnapshots = [],
  inputSource = "typed",
  memories = [],
  prompt,
  recentMessages = [],
  supabase,
  threadId = null,
  threadSummary = null,
  user,
  workspace,
}: RunAssistantTurnInput): Promise<AssistantTurnResult> {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error("Ask Kyro something first.");
  }

  const route = routeAssistantModel(workspace, user);
  const toolPlan = await planAssistantToolCall({
    contextSnapshots,
    inputSource,
    prompt: trimmedPrompt,
    recentMessages,
    route,
    threadSummary,
  });
  const command = await resolveAssistantCommand({
    prompt: trimmedPrompt,
    recentMessages,
    supabase,
    threadId,
    toolPlanModelPlanned: toolPlan.modelPlanned,
    toolSelection: toolPlan.selection,
    user,
    workspace,
  });
  const commandToolCalls = [
    ...plannerToToolCalls(toolPlan, trimmedPrompt),
    ...commandToToolCalls(command, trimmedPrompt),
  ];
  const inputTokensEstimate = estimateTokens(
    JSON.stringify({
      command,
      prompt: trimmedPrompt,
      toolPlan: {
        fallbackReason: toolPlan.fallbackReason ?? null,
        modelPlanned: toolPlan.modelPlanned,
        selection: toolPlan.selection,
      },
    }),
  );
  const { data: aiRun, error: aiRunError } = await supabase
    .from("ai_runs")
    .insert({
      actual_cost: "0",
      estimated_cost: "0",
      input_refs: {
        commandIntent: command.intent,
        inputSource,
        mutation: command.mutation ?? null,
        source: "assistant.page",
        threadId,
      },
      mode: "assistant",
      model: route.model,
      output: {},
      provider: route.provider,
      risk_level: "low",
      status: "running",
      task_type: "assistant_chat",
      tool_calls: commandToolCalls,
      usage: {},
      user_id: user.id,
      workspace_id: workspace.id,
    })
    .select("id")
    .single();

  if (aiRunError || !aiRun) {
    throw new Error(
      `Unable to create assistant AI run: ${aiRunError?.message ?? "unknown error"}`,
    );
  }

  const aiRunId = String(aiRun.id);
  const modelOutput = await runAssistantModel(route, {
    command,
    contextSnapshots,
    inputSource,
    memories,
    prompt: trimmedPrompt,
    recentMessages,
    threadSummary,
  });
  const webSourceLinks = modelOutput.webSources ?? [];
  const resultLinks = dedupeAssistantLinks([
    ...command.links,
    ...webSourceLinks,
  ]);
  const commandUiBlocks = command.uiBlocks ?? [];
  const commandHasGeneratedImageBlock = commandUiBlocks.some(
    (block) => block.type === "generated_image",
  );
  const assistantContent = commandHasGeneratedImageBlock
    ? command.fallbackAnswer
    : modelOutput.text;
  const toolCalls = [
    ...commandToolCalls,
    ...webSearchToToolCalls(modelOutput, trimmedPrompt),
  ];
  const inputTokens = modelOutput.inputTokens || inputTokensEstimate;
  const outputTokens =
    modelOutput.outputTokens || estimateTokens(modelOutput.text);
  const tokenUsage =
    modelOutput.tokenUsage ??
    openAiUsageFromTokenCounts({
      estimated: Boolean(modelOutput.fallbackReason),
      inputTokens,
      outputTokens,
    });

  const { error: routeError } = await supabase
    .from("model_route_decisions")
    .insert({
      ai_run_id: aiRunId,
      budget_snapshot: {
        commandIntent: command.intent,
        fallbackReason: modelOutput.fallbackReason ?? null,
        memoryCount: memories.length,
        providerMode: assistantProviderMode(),
        recentMessageCount: recentMessages.length,
        contextSnapshotCount: contextSnapshots.length,
        toolPlannerFallbackReason: toolPlan.fallbackReason ?? null,
        toolPlannerModelPlanned: toolPlan.modelPlanned,
        toolPlannerSelection: toolPlan.selection,
        webSearchSourceCount: webSourceLinks.length,
        webSearchUsed: Boolean(modelOutput.webSearchUsed),
        inputSource,
        threadId,
      },
      decision_reason: route.reason,
      fallback_used: Boolean(modelOutput.fallbackReason),
      risk_level: "low",
      selected_model: route.model,
      selected_provider: route.provider,
      task_type: "assistant_chat",
      user_id: user.id,
      workspace_id: workspace.id,
    });

  if (routeError) {
    throw new Error(
      `Unable to record assistant model route: ${routeError.message}`,
    );
  }

  const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
    supabase,
    workspace.id,
    "OPENAI_LLM_MARKUP_RATE",
  );
  const usageEvents = [
    ...(toolPlan.tokenUsage
      ? buildLlmUsageEvents({
          context: {
            aiRunId,
            metadata: {
              selectedTool: toolPlan.selection?.name ?? null,
              source: "assistant.tool_planner",
              contextSnapshotCount: contextSnapshots.length,
            },
            providerUsageId: toolPlan.providerUsageId,
            sourceId: aiRunId,
            sourceType: "ai_run",
            usageMarkupRate,
            userId: user.id,
            workspaceId: workspace.id,
          },
          model: route.model,
          provider: route.provider,
          service: "llm",
          usage: toolPlan.tokenUsage,
        })
      : []),
    ...buildLlmUsageEvents({
      context: {
        aiRunId,
        metadata: {
          source: "assistant.turn",
          contextSnapshotCount: contextSnapshots.length,
          toolPlannerFallbackReason: toolPlan.fallbackReason ?? null,
          toolPlannerModelPlanned: toolPlan.modelPlanned,
          toolPlannerSelection: toolPlan.selection,
          webSearchUsed: Boolean(modelOutput.webSearchUsed),
        },
        providerUsageId: modelOutput.providerUsageId,
        sourceId: aiRunId,
        sourceType: "ai_run",
        usageMarkupRate,
        userId: user.id,
        workspaceId: workspace.id,
      },
      model: route.model,
      provider: route.provider,
      service: "llm",
      usage: tokenUsage,
    }),
  ];

  if (modelOutput.webSearchUsed && route.provider === "openai") {
    usageEvents.push(
      buildOpenAiWebSearchCallUsageEvent({
        context: {
          aiRunId,
          metadata: { source: "assistant.turn" },
          providerUsageId: modelOutput.providerUsageId,
          sourceId: aiRunId,
          sourceType: "ai_run",
          usageMarkupRate,
          userId: user.id,
          workspaceId: workspace.id,
        },
        model: route.model,
      }),
    );
  }

  const usageTotals = usageEventTotals(usageEvents);
  const { error: usageError } = await supabase
    .from("usage_events")
    .insert(toUsageEventRows(usageEvents));

  if (usageError) {
    throw new Error(`Unable to record assistant usage: ${usageError.message}`);
  }

  const output = {
    answer: assistantContent,
    command: {
      context: command.context,
      intent: command.intent,
      links: resultLinks,
      mutation: command.mutation ?? null,
      title: command.title,
    },
    fallbackReason: modelOutput.fallbackReason ?? null,
    webSources: webSourceLinks,
  };
  const { error: completeError } = await supabase
    .from("ai_runs")
    .update({
      actual_cost: String(usageTotals.costSnapshot),
      completed_at: new Date().toISOString(),
      latency_ms: 0,
      output,
      status: "completed",
      tool_calls: toolCalls,
      usage: {
        cachedInputTokens: tokenUsage.cachedInputTokens,
        customerCharge: usageTotals.customerChargeSnapshot,
        inputTokens,
        outputTokens,
        reasoningTokens: tokenUsage.reasoningTokens,
        totalTokens: tokenUsage.totalTokens,
      },
    })
    .eq("id", aiRunId);

  if (completeError) {
    throw new Error(
      `Unable to complete assistant run: ${completeError.message}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    action: "assistant.turn_completed",
    actorId: aiRunId,
    actorType: "ai",
    after: {
      intent: command.intent,
      linkCount: resultLinks.length,
      mutation: command.mutation ?? null,
      provider: route.provider,
      webSearchSourceCount: webSourceLinks.length,
      webSearchUsed: Boolean(modelOutput.webSearchUsed),
    },
    entityId: aiRunId,
    entityType: "ai_run",
    metadata: {
      requestedByUserId: user.id,
    },
  });

  return {
    content: assistantContent,
    fallbackReason: modelOutput.fallbackReason,
    id: aiRunId,
    intent: command.intent,
    links: resultLinks,
    model: route.model,
    provider: route.provider,
    role: "assistant",
    toolCalls,
    uiBlocks: [
      ...commandUiBlocks,
      ...(commandHasGeneratedImageBlock
        ? []
        : linkCardsBlock(command.title, command.links)),
      ...linkCardsBlock("Web sources", webSourceLinks),
    ],
  };
}

function webSearchToToolCalls(
  modelOutput: Awaited<ReturnType<typeof runAssistantModel>>,
  prompt: string,
): AssistantToolCallRecord[] {
  if (!modelOutput.webSearchUsed && !modelOutput.webSources?.length) {
    return [];
  }

  return [
    {
      input: {
        prompt,
      },
      name: "web_search",
      result: {
        sourceCount: modelOutput.webSources?.length ?? 0,
        sources: modelOutput.webSources ?? [],
      },
      status: modelOutput.fallbackReason ? "blocked" : "completed",
    },
  ];
}

function plannerToToolCalls(
  toolPlan: AssistantToolPlanResult,
  prompt: string,
): AssistantToolCallRecord[] {
  return [
    {
      input: {
        prompt,
      },
      name: "assistant_tool_planner",
      result: {
        fallbackReason: toolPlan.fallbackReason ?? null,
        inputTokens: toolPlan.inputTokens,
        modelPlanned: toolPlan.modelPlanned,
        outputTokens: toolPlan.outputTokens,
        selection: toolPlan.selection,
      },
      status: toolPlan.fallbackReason ? "blocked" : "completed",
    },
  ];
}

function commandToToolCalls(
  command: Awaited<ReturnType<typeof resolveAssistantCommand>>,
  prompt: string,
): AssistantToolCallRecord[] {
  return [
    {
      input: {
        prompt,
      },
      name: command.intent,
      result: {
        context: command.context,
        linkCount: command.links.length,
        mutation: command.mutation ?? null,
        title: command.title,
      },
      status: "completed",
    },
  ];
}
