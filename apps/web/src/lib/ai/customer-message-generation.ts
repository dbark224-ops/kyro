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

// There were once two of these thrown as errors and a helper to tell them
// apart, which meant the retry had to guess from a message string which
// failures were worth asking again about. An attempt now carries its own
// reason, so any unusable response is retried once and every one of them is
// recorded -- no matching on prose.

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

/**
 * Whether a missing subject makes a message unusable on this channel.
 *
 * An SMS or WhatsApp has no subject line, and the operator alert builder never
 * reads one -- it returns body, footer and provenance. But a blank subject
 * rejected the whole response, so a perfectly good alert was thrown away and
 * replaced with the code template.
 *
 * Measured across twelve hours of runs: inbound_inquiry_notification failed 5
 * times out of 10 on prompts over 2000 input tokens, and 0 times out of 46
 * below it. Not truncation -- reasoningTokens was 0 and output was ~120 against
 * a 700 cap. The rejected payloads carried a complete, sensible body and an
 * empty subject every time. Longer prompts simply make the model likelier to
 * skip a field it has been given no reason to fill.
 *
 * So the alerts most worth reading -- long threads, complicated jobs -- were
 * the ones most likely to arrive as a template. Which is the fault #45 set out
 * to remove.
 */
function subjectIsRequired(channelType: string) {
  // Split on punctuation first. A word boundary does not fire around an
  // underscore, so "twilio_sms", "voice_call" and "sms_whatsapp" all read as
  // needing a subject -- which would quietly bring back the fault above
  // through a different door. No caller passes those today; every one of them
  // is a real channel name used elsewhere in this codebase.
  const words = channelType.toLowerCase().replace(/[^a-z]+/g, " ");

  return !/\b(sms|whatsapp|text|voice|call)\b/.test(words);
}

async function runCustomerMessage(input: {
  apiKey: string;
  model: string;
  prompt: string;
  subjectRequired: boolean;
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
  // Measured before anything can go wrong with the content. OpenAI served this
  // call and will bill for it whatever came back, so the usage has to survive
  // an unusable response -- these paths used to throw, which meant a blank
  // attempt was neither charged for nor explainable afterwards.
  const usage = {
    ...openAiUsageFromResponse(payload, {
      prompt: input.prompt,
      text: outputText ?? "",
    }),
    providerUsageId: openAiProviderUsageId(payload) ?? null,
  };
  const failed = (failure: string, body = "", subject = "") => ({
    body,
    failure,
    subject,
    usage,
  });

  if (!outputText) {
    return failed(NO_OUTPUT_ERROR);
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(outputText) as Record<string, unknown>;
  } catch {
    // Previously an unguarded throw, so a truncated or malformed response was
    // indistinguishable from a provider outage.
    return failed(
      `OpenAI returned a customer message that was not valid JSON (${outputText.length} characters).`,
    );
  }

  const body = textValue(parsed.body) ?? "";
  const subject = textValue(parsed.subject) ?? "";

  if (!body || (input.subjectRequired && !subject)) {
    return failed(EMPTY_MESSAGE_ERROR, body, subject);
  }

  return { body, failure: null as string | null, subject, usage };
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
  // An unusable response is worth one more ask.
  //
  // A missing required literal always got a corrective pass; a blank body or
  // subject got none, so a single flaky empty response dropped the whole alert
  // to the code template. Caught live: two near-identical inquiries minutes
  // apart, one written and one a template.
  //
  // Each attempt is kept whether it worked or not. Every one of them was
  // served and billed by the provider, and a discarded attempt that records
  // nothing is both an unbilled cost and an undiagnosable failure -- which is
  // why "why did this fall back twice in a row" had no answer.
  const subjectRequired = subjectIsRequired(input.channelType);
  let attempt = await runCustomerMessage({
    apiKey,
    model,
    prompt,
    subjectRequired,
  });
  const attempts = [attempt];

  if (attempt.failure) {
    console.warn(
      `Unusable ${input.taskType} from the model (${attempt.failure}), asking once more.`,
    );

    attempt = await runCustomerMessage({ apiKey, model, prompt, subjectRequired });
    attempts.push(attempt);
  }

  if (attempt.failure) {
    const failureReason = attempt.failure;

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

    throw new Error(failureReason);
  }
  let missing = missingLiterals(attempt.body, mustInclude);

  if (missing.length > 0) {
    // One corrective pass rather than patching the text ourselves: inserting
    // the link in code would mean code deciding how it is introduced, which is
    // the thing this module exists to avoid.
    attempt = await runCustomerMessage({
      apiKey,
      model,
      subjectRequired,
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
