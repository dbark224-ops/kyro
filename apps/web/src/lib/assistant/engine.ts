import { createUsageEvent } from "@kyro/api";
import type { UsageEventCreate } from "@kyro/contracts";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { selectModelRoute } from "@kyro/ai";
import { insertAuditLog } from "../engine/event-action-audit";
import { resolveAssistantCommand } from "./commands";
import { runAssistantModel } from "./providers";
import { linkCardsBlock } from "./ui-blocks";
import { dedupeAssistantLinks } from "./web-search";
import type {
  AssistantMemoryItem,
  AssistantModelRoute,
  AssistantToolCallRecord,
  AssistantTurnResult,
} from "./types";

type WorkspaceInput = {
  id: string;
  name: string;
};

type RunAssistantTurnInput = {
  inputSource?: "typed" | "voice" | string;
  memories?: AssistantMemoryItem[];
  prompt: string;
  recentMessages?: Array<{
    content: string;
    intent?: string | null;
    role: "assistant" | "user";
  }>;
  supabase: SupabaseClient;
  threadId?: string | null;
  threadSummary?: string | null;
  user: User;
  workspace: WorkspaceInput;
};

const MARKUP_RATE = 0.25;

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function assistantProviderMode() {
  return (
    envValue("ASSISTANT_PROVIDER") ||
    envValue("AI_PROVIDER") ||
    "ollama"
  ).toLowerCase();
}

function assistantModel() {
  return envValue("ASSISTANT_MODEL") || envValue("OLLAMA_MODEL") || "qwen3:8b";
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function routeAssistantModel(workspace: WorkspaceInput, user: User): AssistantModelRoute {
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

function priceUsage(quantity: number, provider: string) {
  const unitCost = provider === "ollama" ? 0 : 0;
  const cost = quantity * unitCost;
  const customerCharge = cost * (1 + MARKUP_RATE);

  return {
    costSnapshot: Number(cost.toFixed(8)),
    customerChargeSnapshot: Number(customerCharge.toFixed(8)),
    markupSnapshot: MARKUP_RATE,
    unitCostSnapshot: unitCost,
  };
}

function toUsageEvent(input: UsageEventCreate) {
  const event = createUsageEvent(input);

  return {
    action_id: event.actionId ?? null,
    ai_run_id: event.aiRunId ?? null,
    cost_snapshot: String(event.costSnapshot),
    currency: event.currency,
    customer_charge_snapshot: String(event.customerChargeSnapshot),
    markup_snapshot: String(event.markupSnapshot),
    metadata: {},
    model: event.model ?? null,
    provider: event.provider,
    quantity: String(event.quantity),
    service: event.service,
    source_id: event.sourceId ?? null,
    source_type: event.sourceType ?? null,
    unit: event.unit,
    unit_cost_snapshot: String(event.unitCostSnapshot),
    unit_price_snapshot: event.unitPriceSnapshot
      ? String(event.unitPriceSnapshot)
      : null,
    usage_type: event.usageType,
    user_id: event.userId ?? null,
    workflow_run_id: event.workflowRunId ?? null,
    workspace_id: event.workspaceId,
  };
}

export async function runAssistantTurn({
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

  const command = await resolveAssistantCommand({
    prompt: trimmedPrompt,
    supabase,
    user,
    workspace,
  });
  const commandToolCalls = commandToToolCalls(command, trimmedPrompt);
  const route = routeAssistantModel(workspace, user);
  const inputTokensEstimate = estimateTokens(
    JSON.stringify({ command, prompt: trimmedPrompt }),
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
    throw new Error(`Unable to create assistant AI run: ${aiRunError?.message ?? "unknown error"}`);
  }

  const aiRunId = String(aiRun.id);
  const modelOutput = await runAssistantModel(route, {
    command,
    inputSource,
    memories,
    prompt: trimmedPrompt,
    recentMessages,
    threadSummary,
  });
  const webSourceLinks = modelOutput.webSources ?? [];
  const resultLinks = dedupeAssistantLinks([...command.links, ...webSourceLinks]);
  const toolCalls = [
    ...commandToolCalls,
    ...webSearchToToolCalls(modelOutput, trimmedPrompt),
  ];
  const inputTokens = modelOutput.inputTokens || inputTokensEstimate;
  const outputTokens =
    modelOutput.outputTokens || estimateTokens(modelOutput.text);
  const inputPrice = priceUsage(inputTokens, route.provider);
  const outputPrice = priceUsage(outputTokens, route.provider);
  const actualCost = Number(
    (inputPrice.costSnapshot + outputPrice.costSnapshot).toFixed(8),
  );
  const customerCharge = Number(
    (
      inputPrice.customerChargeSnapshot +
      outputPrice.customerChargeSnapshot
    ).toFixed(8),
  );

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
    throw new Error(`Unable to record assistant model route: ${routeError.message}`);
  }

  const usageRows = [
    toUsageEvent({
      aiRunId,
      costSnapshot: inputPrice.costSnapshot,
      currency: "USD",
      customerChargeSnapshot: inputPrice.customerChargeSnapshot,
      markupSnapshot: inputPrice.markupSnapshot,
      model: route.model,
      provider: route.provider,
      quantity: inputTokens,
      service: "llm",
      sourceId: aiRunId,
      sourceType: "ai_run",
      unit: "token",
      unitCostSnapshot: inputPrice.unitCostSnapshot,
      usageType: "llm_input_tokens",
      userId: user.id,
      workspaceId: workspace.id,
    }),
    toUsageEvent({
      aiRunId,
      costSnapshot: outputPrice.costSnapshot,
      currency: "USD",
      customerChargeSnapshot: outputPrice.customerChargeSnapshot,
      markupSnapshot: outputPrice.markupSnapshot,
      model: route.model,
      provider: route.provider,
      quantity: outputTokens,
      service: "llm",
      sourceId: aiRunId,
      sourceType: "ai_run",
      unit: "token",
      unitCostSnapshot: outputPrice.unitCostSnapshot,
      usageType: "llm_output_tokens",
      userId: user.id,
      workspaceId: workspace.id,
    }),
  ];
  const { error: usageError } = await supabase.from("usage_events").insert(usageRows);

  if (usageError) {
    throw new Error(`Unable to record assistant usage: ${usageError.message}`);
  }

  const output = {
    answer: modelOutput.text,
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
      actual_cost: String(actualCost),
      completed_at: new Date().toISOString(),
      latency_ms: 0,
      output,
      status: "completed",
      tool_calls: toolCalls,
      usage: {
        customerCharge,
        inputTokens,
        outputTokens,
      },
    })
    .eq("id", aiRunId);

  if (completeError) {
    throw new Error(`Unable to complete assistant run: ${completeError.message}`);
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
    content: modelOutput.text,
    fallbackReason: modelOutput.fallbackReason,
    id: aiRunId,
    intent: command.intent,
    links: resultLinks,
    model: route.model,
    provider: route.provider,
    role: "assistant",
    toolCalls,
    uiBlocks: [
      ...linkCardsBlock(command.title, command.links),
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
