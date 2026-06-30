import { resolveAssistantCommand } from "../../../../../lib/assistant/commands";
import { updateContactFromAssistantTool } from "../../../../../lib/crm/contact-update-tool";
import {
  assistantWebSearchEnabled,
  runAssistantWebSearch,
} from "../../../../../lib/assistant/web-search";
import {
  buildLlmUsageEvents,
  buildOpenAiWebSearchCallUsageEvent,
  openAiUsageFromTokenCounts,
  toUsageEventRows,
  usageEventTotals,
} from "../../../../../lib/usage/openai";
import { resolveWorkspaceUsageMarkupRate } from "../../../../../lib/usage/workspace-markup";
import {
  syncInboundEmail,
  type InboundEmailProvider,
} from "../../../../../lib/integrations/inbound-email-sync";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

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
  const name = textValue(body.name);
  const rawArguments = objectRecord(body.arguments);
  const prompt = textValue(rawArguments.prompt) ?? textValue(rawArguments.query);

  if (
    name !== "kyro_context_lookup" &&
    name !== "kyro_update_contact" &&
    name !== "kyro_web_search" &&
    name !== "kyro_check_recent_email"
  ) {
    return Response.json({ error: "Unsupported realtime tool." }, { status: 400 });
  }

  if (
    name !== "kyro_check_recent_email" &&
    name !== "kyro_update_contact" &&
    !prompt
  ) {
    return Response.json({ error: "Tool prompt is required." }, { status: 400 });
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  if (name === "kyro_check_recent_email") {
    const providerArg = textValue(rawArguments.provider);
    const provider: InboundEmailProvider | undefined =
      providerArg === "google" || providerArg === "microsoft" ? providerArg : undefined;
    const result = await syncInboundEmail({
      provider,
      supabase,
      trigger: "assistant",
      user,
      workspaceId: workspace.id,
    });
    const answer =
      result.needsReconnect.length > 0
        ? `I checked email, but ${result.needsReconnect.length} connected account needs to be reconnected with inbox-read permission. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
        : result.errors.length > 0
          ? `I checked email with ${result.errors.length} issue(s). I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
          : `I checked email. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages} into Kyro, observed ${result.observedMessages}, and skipped ${result.duplicates} duplicate(s).`;

    return Response.json({
      data: {
        answer,
        result,
      },
    });
  }

  if (name === "kyro_update_contact") {
    const result = await updateContactFromAssistantTool({
      args: rawArguments,
      source: "realtime_voice",
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    });

    return Response.json({
      data: {
        answer: result.answer,
        result,
      },
    });
  }

  if (name === "kyro_web_search") {
    if (!assistantWebSearchEnabled()) {
      return Response.json({ error: "Web search is disabled." }, { status: 403 });
    }

    const result = await runAssistantWebSearch({ prompt: prompt ?? "" });

    if (!result.fallbackReason) {
      const tokenUsage =
        result.tokenUsage ??
        openAiUsageFromTokenCounts({
          estimated: true,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
      const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
        supabase,
        workspace.id,
        "OPENAI_LLM_MARKUP_RATE",
      );
      const usageEvents = buildLlmUsageEvents({
        context: {
          metadata: { source: "realtime_web_search_tool" },
          providerUsageId: result.providerUsageId,
          usageMarkupRate,
          userId: user.id,
          workspaceId: workspace.id,
        },
        model:
          process.env.ASSISTANT_WEB_SEARCH_MODEL?.trim() ||
          process.env.OPENAI_BALANCED_MODEL?.trim() ||
          process.env.ASSISTANT_MODEL?.trim() ||
          "gpt-4.1-mini",
        provider: "openai",
        service: "llm",
        usage: tokenUsage,
      });

      if (result.webSearchUsed) {
        usageEvents.push(
          buildOpenAiWebSearchCallUsageEvent({
            context: {
              metadata: { source: "realtime_web_search_tool" },
              providerUsageId: result.providerUsageId,
              usageMarkupRate,
              userId: user.id,
              workspaceId: workspace.id,
            },
            model:
              process.env.ASSISTANT_WEB_SEARCH_MODEL?.trim() ||
              process.env.OPENAI_BALANCED_MODEL?.trim() ||
              process.env.ASSISTANT_MODEL?.trim() ||
              "gpt-4.1-mini",
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
          input_refs: { prompt, source: "realtime_tool" },
          mode: "tool",
          model:
            process.env.ASSISTANT_WEB_SEARCH_MODEL?.trim() ||
            process.env.OPENAI_BALANCED_MODEL?.trim() ||
            process.env.ASSISTANT_MODEL?.trim() ||
            "gpt-4.1-mini",
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
          user_id: user.id,
          workspace_id: workspace.id,
        })
        .select("id")
        .single();

      if (aiRun?.id) {
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
    }

    return Response.json({
      data: {
        answer: result.text,
        fallbackReason: result.fallbackReason ?? null,
        sourceCount: result.sources.length,
        sources: result.sources,
        webSearchUsed: result.webSearchUsed,
      },
    });
  }

  const result = await resolveAssistantCommand({
    prompt: prompt ?? "",
    supabase,
    user,
    workspace,
  });

  return Response.json({
    data: {
      answer: result.fallbackAnswer,
      context: result.context,
      intent: result.intent,
      links: result.links,
      mutation: result.mutation ?? null,
      title: result.title,
    },
  });
}
