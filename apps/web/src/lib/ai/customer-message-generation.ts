import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import {
  getCommunicationSettings,
  replyWritingPromptRules,
} from "../communication/settings";
import { fetchAiProvider } from "../http/fetch-with-timeout";
import { buildAssistantCurrentTimeContext } from "../assistant/current-time";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import {
  buildLlmUsageEvents,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  recordUsageEvents,
  usageEventTotals,
} from "../usage/openai";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import { openAiBalancedModel, openAiReasoningRequest } from "./openai-models";
import {
  loadBusinessProfile,
  providerErrorMessage,
  responseOutputText,
} from "./reply-draft-generation";
import { textValue } from "@kyro/core";

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

/**
 * Shared so the throw and the retry check cannot drift apart. Matching on a
 * message is fragile; matching on two copies of a message is worse.
 */
const EMPTY_MESSAGE_ERROR =
  "OpenAI returned a customer message without a subject or body.";
const NO_OUTPUT_ERROR = "OpenAI returned an empty customer message.";

/**
 * Both ways the provider can come back with nothing usable.
 *
 * The retry originally covered only the parsed-but-blank case. The other --
 * no output text at all -- went straight to the fallback, and a live run hit
 * exactly that: "OpenAI returned an empty customer message" and a code
 * template in front of the owner. Two doors, one of them left open.
 */
function isEmptyMessageError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === EMPTY_MESSAGE_ERROR || error.message === NO_OUTPUT_ERROR)
  );
}

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

function missingLiterals(message: string, mustInclude: string[]) {
  return mustInclude.filter((literal) => !message.includes(literal));
}

function buildPrompt(input: {
  contextFacts: Record<string, unknown>;
  correction?: string[];
  currentTimeLine?: string | null;
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
        // Same reason as the reply writer: anything this composes may name a
        // day or a date, and it cannot do that correctly without knowing what
        // today is in the workspace's timezone.
        ...(input.currentTimeLine ? [input.currentTimeLine] : []),
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
    throw new Error(NO_OUTPUT_ERROR);
  }

  const parsed = JSON.parse(outputText) as Record<string, unknown>;
  const body = textValue(parsed.body);
  const subject = textValue(parsed.subject);

  if (!body || !subject) {
    throw new Error(EMPTY_MESSAGE_ERROR);
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

type CustomerMessageAttempt = Awaited<ReturnType<typeof runCustomerMessage>>;

/**
 * Bill every call the provider actually served, not just the one we used.
 *
 * Two ways spend used to vanish. A corrective pass that fixed a missing literal
 * left the first attempt's tokens unrecorded, because only the final attempt
 * was metered. And a corrective pass that failed threw before any metering ran
 * at all, so a workspace could burn two calls and see nothing on its bill --
 * which is also why the failure was invisible when looking for it in
 * usage_events.
 *
 * Each attempt keeps its own provider usage id so the rows stay reconcilable
 * against OpenAI's own record; the ai_run row carries the summed totals.
 */
async function recordAttemptUsage(input: {
  attempts: CustomerMessageAttempt[];
  channelType: string;
  failureReason?: string;
  model: string;
  startedAt: number;
  supabase: SupabaseClient;
  taskType: string;
  userId: string | null;
  workspaceId: string;
}) {
  const attempts = input.attempts.filter(Boolean);

  if (attempts.length === 0) {
    return;
  }

  const failed = Boolean(input.failureReason);
  const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
    input.supabase,
    input.workspaceId,
    "OPENAI_LLM_MARKUP_RATE",
  );
  const usageEvents = attempts.flatMap((attempt, index) =>
    buildLlmUsageEvents({
      context: {
        metadata: {
          attempt: index + 1,
          ...(failed ? { outcome: "failed" } : {}),
          source: input.taskType,
        },
        providerUsageId: attempt.usage.providerUsageId,
        usageMarkupRate,
        userId: input.userId,
        workspaceId: input.workspaceId,
      },
      model: input.model,
      provider: "openai",
      service: "llm",
      usage: attempt.usage,
    }),
  );
  const usageTotals = usageEventTotals(usageEvents);
  const tokens = attempts.reduce(
    (running, attempt) => ({
      cachedInputTokens:
        running.cachedInputTokens + attempt.usage.cachedInputTokens,
      inputTokens: running.inputTokens + attempt.usage.inputTokens,
      outputTokens: running.outputTokens + attempt.usage.outputTokens,
      reasoningTokens: running.reasoningTokens + attempt.usage.reasoningTokens,
      totalTokens: running.totalTokens + attempt.usage.totalTokens,
    }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    },
  );
  const last = attempts[attempts.length - 1];
  const { data: aiRun, error: aiRunError } = await input.supabase
    .from("ai_runs")
    .insert({
      actual_cost: String(usageTotals.costSnapshot),
      completed_at: new Date().toISOString(),
      ...(failed ? { error: input.failureReason } : {}),
      estimated_cost: String(usageTotals.costSnapshot),
      input_refs: {
        attempts: attempts.length,
        channelType: input.channelType,
        source: input.taskType,
      },
      latency_ms: Date.now() - input.startedAt,
      mode: "copilot",
      model: input.model,
      // Keep the rejected draft. Without it the only record of a failed
      // generation is a cost with nothing to show for it.
      output: failed
        ? { rejectedBody: last.body, rejectedSubject: last.subject }
        : { body: last.body, subject: last.subject },
      provider: "openai",
      risk_level: "medium",
      status: failed ? "failed" : "completed",
      task_type: input.taskType,
      tool_calls: [],
      usage: {
        ...tokens,
        customerCharge: usageTotals.customerChargeSnapshot,
      },
      user_id: input.userId,
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  // The model has already run and been charged for by this point, so a failure
  // to record the charge must not discard the message -- but it must not pass
  // silently either. recordUsageEvents writes the payload to the audit log so
  // the charge stays reconstructable.
  if (aiRunError) {
    console.error(
      `Unable to record ai_run for ${input.taskType}: ${aiRunError.message}`,
    );
  }

  const aiRunId = aiRun?.id ? String(aiRun.id) : null;

  await recordUsageEvents(input.supabase, {
    context: `customer_message:${input.taskType}`,
    events: usageEvents.map((event) => ({
      ...event,
      ...(aiRunId
        ? { aiRunId, sourceId: aiRunId, sourceType: "ai_run" as const }
        : {}),
    })),
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
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
    // A customer wrote in French and the whole alert came back in French. The
    // alert exists so the owner can act in seconds; one they cannot read is
    // worse than none, because it still interrupts them.
    "Write in the language the business itself uses, which is the language of context.businessProfile. Match the customer's language only inside a direct quotation -- if they wrote in another language, quote their words as they wrote them and put your own translation or summary around it, so the owner can read the alert and still see exactly what was said.",
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
  /** Null for system-initiated work. Never a sentinel -- the usage schema
   * requires a real uuid, and "system" threw on every call. */
  userId: string | null;
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
  /** Null for system-initiated work. Never a sentinel -- the usage schema
   * requires a real uuid, and "system" threw on every call. */
  userId: string | null;
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
  const [businessProfile, communicationSettings, generalSettings] =
    await Promise.all([
      loadBusinessProfile(input.supabase, input.workspaceId),
      getCommunicationSettings(input.supabase, input.workspaceId),
      getWorkspaceGeneralSettings(input.supabase, input.workspaceId),
    ]);
  const currentTimeLine = buildAssistantCurrentTimeContext(
    generalSettings.timeZone,
  ).promptLine;
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

  const prompt = buildPrompt({
    contextFacts,
    currentTimeLine,
    mustInclude,
    purposeRules: input.purposeRules,
    task: input.task,
    writingRules,
  });
  // An empty response is worth one more ask.
  //
  // runCustomerMessage throws when the model returns valid JSON with a blank
  // body or subject. That got no retry, while a merely missing literal got a
  // corrective pass -- so a single flaky blank dropped the whole alert to the
  // code template. Caught in a live run: two identical inquiries minutes
  // apart, one written, one "OpenAI returned a customer message without a
  // subject or body" and a template in front of the owner.
  //
  // Only for the empty case. A provider outage or a refusal should surface,
  // not be asked twice.
  let attempt = await runCustomerMessage({ apiKey, model, prompt }).catch(
    (error: unknown) => {
      if (!isEmptyMessageError(error)) {
        throw error;
      }

      console.warn(
        `Empty ${input.taskType} from the model, asking once more.`,
      );

      return runCustomerMessage({ apiKey, model, prompt });
    },
  );
  // Every attempt costs tokens whether or not its output is used. Usage is
  // recorded further down, past a throw that a failed corrective pass can
  // reach -- so a generation that gave up billed the workspace nothing and
  // showed nothing, and the spend was invisible.
  const attempts = [attempt];
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
        currentTimeLine,
        mustInclude,
        purposeRules: input.purposeRules,
        task: input.task,
        writingRules,
      }),
    });
    attempts.push(attempt);
    missing = missingLiterals(attempt.body, mustInclude);
  }

  if (missing.length > 0) {
    const failureReason = `missing required literals: ${missing.join(", ")}`;

    // Metering must not swallow the real failure. The operator needs the
    // "could not write this" error below, not a usage-write error on top of it.
    await recordAttemptUsage({
      attempts,
      channelType: input.channelType,
      failureReason,
      model,
      startedAt,
      supabase: input.supabase,
      taskType: input.taskType,
      userId: input.userId,
      workspaceId: input.workspaceId,
    }).catch((usageError: unknown) => {
      console.error(
        `Unable to record usage for a failed ${input.taskType}: ${
          usageError instanceof Error ? usageError.message : String(usageError)
        }`,
      );
    });

    throw new Error(
      `Kyro could not write this message with the required details (${missing.join(
        ", ",
      )}). Nothing was sent -- try again, or write the message yourself.`,
    );
  }

  await recordAttemptUsage({
    attempts,
    channelType: input.channelType,
    model,
    startedAt,
    supabase: input.supabase,
    taskType: input.taskType,
    userId: input.userId,
    workspaceId: input.workspaceId,
  });

  return { body: attempt.body, model, subject: attempt.subject };
}
