import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import {
  getCommunicationSettings,
  replyWritingPromptRules,
} from "../communication/settings";
import { fetchAiProvider } from "../http/fetch-with-timeout";
import {
  buildLlmUsageEvents,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  toUsageEventRows,
  usageEventTotals,
} from "../usage/openai";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import { openAiBalancedModel, openAiReasoningRequest } from "./openai-models";
import {
  loadBusinessProfile,
  providerErrorMessage,
  responseOutputText,
} from "./reply-draft-generation";

/**
 * Write a customer-facing message with an LLM.
 *
 * Kyro is an AI assistant, so every word a customer reads is written by the
 * model. Deterministic code's job is to decide *what has to be true* -- which
 * facts are available, what the message must achieve, which literals must
 * survive verbatim -- and to verify the result. It never composes the prose,
 * and it never edits the model's wording afterwards.
 *
 * There is deliberately no canned fallback. If the model cannot produce a
 * usable message the call throws, so the operator sees a real failure they can
 * retry or write themselves, rather than a customer receiving template text
 * signed by an assistant that did not write it.
 */
export type CustomerMessageResult = {
  body: string;
  model: string;
  subject: string;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function customerMessageModel() {
  return envValue("OPENAI_CUSTOMER_MESSAGE_MODEL") || openAiBalancedModel();
}

function customerMessageMaxOutputTokens() {
  const parsed = Number(envValue("OPENAI_CUSTOMER_MESSAGE_MAX_OUTPUT_TOKENS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 700;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function missingLiterals(message: string, mustInclude: string[]) {
  return mustInclude.filter((literal) => !message.includes(literal));
}

function buildPrompt(input: {
  contextFacts: Record<string, unknown>;
  correction?: string[];
  mustInclude: string[];
  purposeRules: string[];
  task: string;
  writingRules: string[];
}) {
  return JSON.stringify(
    {
      context: input.contextFacts,
      outputContract: { body: "string", subject: "string" },
      rules: [
        "Return JSON only.",
        ...input.purposeRules,
        ...(input.mustInclude.length
          ? [
              `Reproduce each string in context.mustIncludeVerbatim exactly as given, character for character, somewhere in the body: ${input.mustInclude.join(
                " | ",
              )}`,
            ]
          : []),
        ...input.writingRules.map((rule) => `Writing style - ${rule}`),
        ...(input.correction ?? []),
      ],
      task: input.task,
    },
    null,
    2,
  );
}

async function runCustomerMessage(input: {
  apiKey: string;
  model: string;
  prompt: string;
}) {
  const response = await fetchAiProvider(
    "https://api.openai.com/v1/responses",
    {
      body: JSON.stringify({
        input: input.prompt,
        instructions:
          "You write customer-facing messages for Kyro, a trades/service CRM. Use the workspace writing style in the prompt and return compact JSON matching the schema.",
        max_output_tokens: customerMessageMaxOutputTokens(),
        model: input.model,
        ...openAiReasoningRequest(
          input.model,
          "OPENAI_CUSTOMER_MESSAGE_REASONING_EFFORT",
          "low",
        ),
        text: {
          format: {
            name: "kyro_customer_message",
            schema: {
              additionalProperties: false,
              properties: {
                body: { type: "string" },
                subject: { type: "string" },
              },
              required: ["subject", "body"],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload));
  }

  const outputText = responseOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI returned an empty customer message.");
  }

  const parsed = JSON.parse(outputText) as Record<string, unknown>;
  const body = textValue(parsed.body);
  const subject = textValue(parsed.subject);

  if (!body || !subject) {
    throw new Error("OpenAI returned a customer message without a subject or body.");
  }

  return {
    body,
    subject,
    usage: {
      ...openAiUsageFromResponse(payload, {
        prompt: input.prompt,
        text: outputText,
      }),
      providerUsageId: openAiProviderUsageId(payload) ?? null,
    },
  };
}

/**
 * How the message should read, which differs by who is reading it.
 *
 * "customer" inherits the workspace's configured tone and sign-off. "operator"
 * is the business owner reading an alert on their phone: no greeting, no
 * sign-off, no selling, and above all a judgement call the old templates could
 * not make -- quote the customer word for word when the exact wording is the
 * point, summarise when it is not.
 */
function audienceWritingRules(input: {
  audience: "customer" | "operator";
  channelType: string;
  replyWriting: Parameters<typeof replyWritingPromptRules>[0];
}) {
  if (input.audience === "customer") {
    return replyWritingPromptRules(input.replyWriting, input.channelType);
  }

  return [
    "You are writing to the business owner, not to their customer. No greeting, no sign-off, no pleasantries.",
    "Lead with what they need to know or do. They are reading this on a phone, probably while working.",
    "Quote the customer's own words when the exact wording carries the meaning -- anger, a specific instruction, an unusual request, anything they would want to see for themselves. Put the quote in quotation marks.",
    "Summarise instead when the wording does not matter and the facts do, for example a routine request for a quote.",
    "Name the customer and where they are when those are known. Do not pad with detail the owner can already see in the app.",
    "Never invent facts. Anything not in the context does not go in the message.",
  ];
}

export async function generateOperatorAlert(input: {
  contextFacts: Record<string, unknown>;
  mustInclude?: string[];
  purposeRules: string[];
  supabase: SupabaseClient;
  task: string;
  taskType: string;
  userId: string;
  workspaceId: string;
}) {
  return generateCustomerMessage({ ...input, audience: "operator", channelType: "sms" });
}

export async function generateCustomerMessage(input: {
  audience?: "customer" | "operator";
  channelType: string;
  contextFacts: Record<string, unknown>;
  /** Literals that must survive verbatim -- an approval URL, a reference code. */
  mustInclude?: string[];
  purposeRules: string[];
  supabase: SupabaseClient;
  task: string;
  taskType: string;
  userId: string;
  workspaceId: string;
}): Promise<CustomerMessageResult> {
  await assertWorkspaceAutomationAllowed(input.workspaceId);

  const apiKey = envValue("OPENAI_API_KEY");

  if (!apiKey) {
    throw new Error(
      "Kyro could not write this message because the AI provider is not configured. Nothing was sent.",
    );
  }

  const mustInclude = (input.mustInclude ?? []).filter(Boolean);
  const [businessProfile, communicationSettings] = await Promise.all([
    loadBusinessProfile(input.supabase, input.workspaceId),
    getCommunicationSettings(input.supabase, input.workspaceId),
  ]);
  const writingRules = audienceWritingRules({
    audience: input.audience ?? "customer",
    channelType: input.channelType,
    replyWriting: communicationSettings.replyWriting,
  });
  const contextFacts = {
    ...input.contextFacts,
    businessProfile,
    channelType: input.channelType,
    ...(mustInclude.length ? { mustIncludeVerbatim: mustInclude } : {}),
  };
  const model = customerMessageModel();
  const startedAt = Date.now();

  let attempt = await runCustomerMessage({
    apiKey,
    model,
    prompt: buildPrompt({
      contextFacts,
      mustInclude,
      purposeRules: input.purposeRules,
      task: input.task,
      writingRules,
    }),
  });
  let missing = missingLiterals(attempt.body, mustInclude);

  if (missing.length > 0) {
    // One corrective pass rather than patching the text ourselves: inserting
    // the link in code would mean code deciding how it is introduced, which is
    // the thing this module exists to avoid.
    attempt = await runCustomerMessage({
      apiKey,
      model,
      prompt: buildPrompt({
        contextFacts,
        correction: [
          `Your previous draft left out these required strings: ${missing.join(
            " | ",
          )}. Rewrite the message so each appears exactly as given, worded naturally.`,
        ],
        mustInclude,
        purposeRules: input.purposeRules,
        task: input.task,
        writingRules,
      }),
    });
    missing = missingLiterals(attempt.body, mustInclude);
  }

  if (missing.length > 0) {
    throw new Error(
      `Kyro could not write this message with the required details (${missing.join(
        ", ",
      )}). Nothing was sent -- try again, or write the message yourself.`,
    );
  }

  const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
    input.supabase,
    input.workspaceId,
    "OPENAI_LLM_MARKUP_RATE",
  );
  const usageEvents = buildLlmUsageEvents({
    context: {
      metadata: { source: input.taskType },
      providerUsageId: attempt.usage.providerUsageId,
      usageMarkupRate,
      userId: input.userId,
      workspaceId: input.workspaceId,
    },
    model,
    provider: "openai",
    service: "llm",
    usage: attempt.usage,
  });
  const usageTotals = usageEventTotals(usageEvents);
  const { data: aiRun } = await input.supabase
    .from("ai_runs")
    .insert({
      actual_cost: String(usageTotals.costSnapshot),
      completed_at: new Date().toISOString(),
      estimated_cost: String(usageTotals.costSnapshot),
      input_refs: {
        channelType: input.channelType,
        source: input.taskType,
      },
      latency_ms: Date.now() - startedAt,
      mode: "copilot",
      model,
      output: { body: attempt.body, subject: attempt.subject },
      provider: "openai",
      risk_level: "medium",
      status: "completed",
      task_type: input.taskType,
      tool_calls: [],
      usage: {
        cachedInputTokens: attempt.usage.cachedInputTokens,
        customerCharge: usageTotals.customerChargeSnapshot,
        inputTokens: attempt.usage.inputTokens,
        outputTokens: attempt.usage.outputTokens,
        reasoningTokens: attempt.usage.reasoningTokens,
        totalTokens: attempt.usage.totalTokens,
      },
      user_id: input.userId,
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  if (aiRun?.id) {
    const aiRunId = String(aiRun.id);

    await input.supabase.from("usage_events").insert(
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

  return { body: attempt.body, model, subject: attempt.subject };
}
