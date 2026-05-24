import { NextResponse } from "next/server";
import {
  documentTemplateRevisionPayload,
  runDocumentTemplateRevision,
} from "../../../../../lib/documents/template-revision";
import {
  buildLlmUsageEvents,
  toUsageEventRows,
  usageEventTotals,
} from "../../../../../lib/usage/openai";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

type TemplateRevisionRequest = {
  instruction?: unknown;
  template?: unknown;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } = await requireWorkspaceContext();
    const body = (await request.json()) as TemplateRevisionRequest;
    const instruction = textValue(body.instruction);

    if (!instruction) {
      return NextResponse.json(
        { error: "Describe the edit you want Kyro to make." },
        { status: 400 },
      );
    }

    const template = documentTemplateRevisionPayload(body.template);

    if (!template.label) {
      template.label = "Custom quote template";
    }

    const result = await runDocumentTemplateRevision({
      instruction,
      template,
      workspaceName: workspace.name,
    });
    const usageEvents = buildLlmUsageEvents({
      context: {
        metadata: { source: "document_template_revision" },
        providerUsageId: result.usage.providerUsageId,
        userId: user.id,
        workspaceId: workspace.id,
      },
      model: result.model,
      provider: "openai",
      service: "llm",
      usage: result.usage,
    });
    const usageTotals = usageEventTotals(usageEvents);
    const { data: aiRun } = await supabase
      .from("ai_runs")
      .insert({
        actual_cost: String(usageTotals.costSnapshot),
        completed_at: new Date().toISOString(),
        estimated_cost: String(usageTotals.costSnapshot),
        input_refs: {
          instruction,
          source: "document_template_revision",
          templateLabel: template.label,
        },
        mode: "copilot",
        model: result.model,
        output: {
          templateLabel: result.data.label,
        },
        provider: "openai",
        risk_level: "low",
        status: "completed",
        task_type: "document_template_revision",
        tool_calls: [],
        usage: {
          cachedInputTokens: result.usage.cachedInputTokens,
          customerCharge: usageTotals.customerChargeSnapshot,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          totalTokens: result.usage.totalTokens,
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

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to revise document template.",
      },
      { status: 502 },
    );
  }
}
