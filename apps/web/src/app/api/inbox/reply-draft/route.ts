import { NextResponse } from "next/server";
import { getConversationReview } from "../../../../lib/crm/queries";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";

const INPUT_TOKEN_UNIT_COST = 0.00000015;
const OUTPUT_TOKEN_UNIT_COST = 0.0000006;
const MARKUP_RATE = 0.25;

type ReplyDraftRequest = {
  conversationId?: unknown;
  prompt?: unknown;
  skippedEmailId?: unknown;
};

type ReplyDraftContext = {
  businessProfile?: {
    businessName: string | null;
    defaultReplyInstructions: string | null;
    description: string | null;
    industry: string | null;
    serviceArea: string | null;
    toneOfVoice: string | null;
  } | null;
  contactEmail?: string | null;
  contactName?: string | null;
  conversationId?: string;
  eventId?: string;
  latestSubject?: string | null;
  leadTitle?: string | null;
  prompt: string | null;
  source: "conversation" | "skipped_email";
  skippedEmail?: {
    category: string | null;
    fromEmail: string | null;
    provider: string | null;
    reason: string | null;
    receivedAt: string | null;
    subject: string;
    summary: string | null;
  };
  thread?: Array<{
    body: string | null;
    direction: string;
    subject: string | null;
  }>;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function replyDraftModel() {
  return (
    envValue("OPENAI_REPLY_DRAFT_MODEL") ||
    envValue("OPENAI_LOW_COST_MODEL") ||
    "gpt-4.1-mini"
  );
}

function replyDraftMaxOutputTokens() {
  const parsed = Number(envValue("OPENAI_REPLY_DRAFT_MAX_OUTPUT_TOKENS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 520;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function priceUsage(quantity: number, unitCost: number) {
  const cost = quantity * unitCost;
  const customerCharge = cost * (1 + MARKUP_RATE);

  return {
    costSnapshot: Number(cost.toFixed(8)),
    customerChargeSnapshot: Number(customerCharge.toFixed(8)),
    markupSnapshot: MARKUP_RATE,
    unitCostSnapshot: unitCost,
  };
}

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);
  const message = textValue(error.message);

  return message ?? "OpenAI reply generation failed.";
}

function responseOutputText(payload: unknown) {
  const root = objectRecord(payload);
  const direct = textValue(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];

  for (const item of output) {
    const content = objectRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const text = textValue(objectRecord(part).text);

      if (text) {
        return text;
      }
    }
  }

  return null;
}

function responseUsage(payload: unknown, prompt: string, text: string) {
  const usage = objectRecord(objectRecord(payload).usage);

  return {
    inputTokens: numberValue(usage.input_tokens) ?? estimateTokens(prompt),
    outputTokens: numberValue(usage.output_tokens) ?? estimateTokens(text),
  };
}

function replySubject(value: string | null) {
  const subject = value?.trim() || "Follow-up";

  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function buildPrompt(context: ReplyDraftContext) {
  const skippedEmailRules =
    context.source === "skipped_email"
      ? [
          "This is a filtered-out email, not a CRM service inquiry. Use context.skippedEmail as the source of truth.",
          "Do not ask for job details, service details, appointment details, customer names, addresses, photos, or quote information unless the skipped email itself is about those things.",
          "If the skipped email is about an account, billing, product, subscription, newsletter, or automated notice, reply in that context.",
          "If the user's direction says to cancel, draft a cancellation-style reply for the thing referenced by the skipped email subject/summary, such as an account, subscription, order, product, booking, or billing issue.",
          "If the sender appears no-reply or automated, still draft the best user-approved reply, but do not pretend the email is a customer lead.",
        ]
      : [
          "This is a CRM conversation. Use the thread, contact, lead, and business profile context as the source of truth.",
          "Ask for missing job/service details only when the conversation context indicates this is a customer inquiry and those details are actually needed.",
        ];

  return JSON.stringify(
    {
      context,
      outputContract: {
        body: "string",
        subject: "string",
      },
      rules: [
        "Return JSON only.",
        "Write as Kyro on behalf of the business owner, not as an AI assistant.",
        "Keep the reply friendly, practical, and concise.",
        "Do not invent prices, availability, addresses, phone numbers, or promises not present in context.",
        "Follow the user's direction prompt if provided, unless it conflicts with the available context.",
        "Use a normal email subject beginning with Re: when appropriate.",
        ...skippedEmailRules,
      ],
      task: "Draft an outbound email reply for the user to review before sending.",
    },
    null,
    2,
  );
}

function parseDraft(text: string, fallbackSubject: string) {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const body = textValue(parsed.body);

  if (!body) {
    throw new Error("OpenAI returned a draft without a reply body.");
  }

  return {
    body,
    subject: textValue(parsed.subject) ?? fallbackSubject,
  };
}

async function runOpenAiReplyDraft(context: ReplyDraftContext) {
  const apiKey = openAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for reply generation.");
  }

  const model = replyDraftModel();
  const prompt = buildPrompt(context);
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: prompt,
      instructions:
        "You draft concise customer email replies for Kyro, a trades/service CRM. Return compact JSON matching the schema.",
      max_output_tokens: replyDraftMaxOutputTokens(),
      model,
      text: {
        format: {
          name: "kyro_reply_draft",
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
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload));
  }

  const outputText = responseOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI returned an empty reply draft.");
  }

  return {
    ...parseDraft(outputText, replySubject(context.latestSubject ?? null)),
    model,
    prompt,
    usage: responseUsage(payload, prompt, outputText),
  };
}

async function conversationContext(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
  conversationId: string,
  prompt: string | null,
): Promise<ReplyDraftContext | null> {
  const review = await getConversationReview(
    supabase,
    workspaceId,
    conversationId,
  );

  if (!review) {
    return null;
  }

  const latestSubject = [...review.messages]
    .reverse()
    .find((message) => message.subject)?.subject;

  return {
    contactEmail: review.contact?.email ?? null,
    contactName: review.contact?.name ?? null,
    conversationId,
    latestSubject: latestSubject ?? review.lead?.title ?? null,
    leadTitle: review.lead?.title ?? null,
    prompt,
    source: "conversation",
    thread: review.messages.slice(-10).map((message) => ({
      body: message.bodyText,
      direction: message.direction,
      subject: message.subject,
    })),
  };
}

async function skippedEmailContext(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
  skippedEmailId: string,
  prompt: string | null,
): Promise<ReplyDraftContext | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id,payload")
    .eq("workspace_id", workspaceId)
    .eq("id", skippedEmailId)
    .eq("type", "inbound.email.received")
    .eq("status", "processed")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load skipped email: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const payload = objectRecord(data.payload);
  const classification = objectRecord(payload.classification);
  const subject = textValue(payload.subject) ?? "Follow-up";

  if (textValue(payload.stage) !== "observed") {
    return null;
  }

  return {
    eventId: String(data.id),
    latestSubject: subject,
    prompt,
    skippedEmail: {
      category: textValue(classification.category),
      fromEmail: textValue(payload.fromEmail),
      provider: textValue(payload.provider),
      reason: textValue(classification.reason),
      receivedAt: textValue(payload.receivedAt),
      subject,
      summary:
        textValue(payload.summary) ??
        textValue(classification.summary) ??
        textValue(classification.actionHint),
    },
    source: "skipped_email",
  };
}

async function loadBusinessProfile(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("business_profiles")
    .select(
      "business_name,industry,description,service_area,tone_of_voice,default_reply_instructions",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    businessName: textValue(data.business_name),
    defaultReplyInstructions: textValue(data.default_reply_instructions),
    description: textValue(data.description),
    industry: textValue(data.industry),
    serviceArea: textValue(data.service_area),
    toneOfVoice: textValue(data.tone_of_voice),
  };
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as ReplyDraftRequest;
    const conversationId = textValue(input.conversationId);
    const skippedEmailId = textValue(input.skippedEmailId);
    const prompt = textValue(input.prompt);

    if (!conversationId && !skippedEmailId) {
      return NextResponse.json(
        { error: "A conversation or skipped email is required." },
        { status: 400 },
      );
    }

    const { supabase, user, workspace } = await requireWorkspaceContext();
    const context = conversationId
      ? await conversationContext(
          supabase,
          workspace.id,
          conversationId,
          prompt,
        )
      : skippedEmailId
        ? await skippedEmailContext(
            supabase,
            workspace.id,
            skippedEmailId,
            prompt,
          )
        : null;

    if (!context) {
      return NextResponse.json(
        { error: "Unable to find reply context." },
        { status: 404 },
      );
    }

    context.businessProfile = await loadBusinessProfile(supabase, workspace.id);

    const startedAt = Date.now();
    const draft = await runOpenAiReplyDraft(context);
    const inputPrice = priceUsage(
      draft.usage.inputTokens,
      INPUT_TOKEN_UNIT_COST,
    );
    const outputPrice = priceUsage(
      draft.usage.outputTokens,
      OUTPUT_TOKEN_UNIT_COST,
    );
    const actualCost = Number(
      (inputPrice.costSnapshot + outputPrice.costSnapshot).toFixed(8),
    );
    const customerCharge = Number(
      (
        inputPrice.customerChargeSnapshot + outputPrice.customerChargeSnapshot
      ).toFixed(8),
    );
    const { data: aiRun } = await supabase
      .from("ai_runs")
      .insert({
        actual_cost: String(actualCost),
        completed_at: new Date().toISOString(),
        estimated_cost: String(actualCost),
        input_refs: {
          conversationId: context.conversationId ?? null,
          eventId: context.eventId ?? null,
          promptProvided: Boolean(prompt),
          source: context.source,
        },
        latency_ms: Date.now() - startedAt,
        mode: "copilot",
        model: draft.model,
        output: {
          body: draft.body,
          subject: draft.subject,
        },
        provider: "openai",
        risk_level: "medium",
        status: "completed",
        task_type: "reply_draft_generation",
        tool_calls: [],
        usage: {
          customerCharge,
          inputTokens: draft.usage.inputTokens,
          outputTokens: draft.usage.outputTokens,
        },
        user_id: user.id,
        workspace_id: workspace.id,
      })
      .select("id")
      .single();

    if (aiRun?.id) {
      const aiRunId = String(aiRun.id);

      await supabase.from("usage_events").insert([
        {
          ai_run_id: aiRunId,
          cost_snapshot: String(inputPrice.costSnapshot),
          currency: "USD",
          customer_charge_snapshot: String(inputPrice.customerChargeSnapshot),
          markup_snapshot: String(inputPrice.markupSnapshot),
          metadata: { source: context.source },
          model: draft.model,
          provider: "openai",
          quantity: String(draft.usage.inputTokens),
          service: "llm",
          source_id: aiRunId,
          source_type: "ai_run",
          unit: "token",
          unit_cost_snapshot: String(inputPrice.unitCostSnapshot),
          usage_type: "llm_input_tokens",
          user_id: user.id,
          workspace_id: workspace.id,
        },
        {
          ai_run_id: aiRunId,
          cost_snapshot: String(outputPrice.costSnapshot),
          currency: "USD",
          customer_charge_snapshot: String(outputPrice.customerChargeSnapshot),
          markup_snapshot: String(outputPrice.markupSnapshot),
          metadata: { source: context.source },
          model: draft.model,
          provider: "openai",
          quantity: String(draft.usage.outputTokens),
          service: "llm",
          source_id: aiRunId,
          source_type: "ai_run",
          unit: "token",
          unit_cost_snapshot: String(outputPrice.unitCostSnapshot),
          usage_type: "llm_output_tokens",
          user_id: user.id,
          workspace_id: workspace.id,
        },
      ]);
    }

    return NextResponse.json({
      body: draft.body,
      subject: draft.subject,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate reply draft.",
      },
      { status: 500 },
    );
  }
}
