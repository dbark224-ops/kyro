import { fetchAiProvider } from "../http/fetch-with-timeout";
import {
  buildAssistantCurrentTimeContext,
  type AssistantCurrentTimeContext,
} from "../assistant/current-time";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConversationReview } from "../crm/queries";
import {
  DEFAULT_REPLY_WRITING_SETTINGS,
  getCommunicationSettings,
  replyWritingPromptRules,
  type ReplyWritingSettings,
} from "../communication/settings";
import {
  buildLlmUsageEvents,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  recordUsageEvents,
  usageEventTotals,
} from "../usage/openai";
import { openAiBalancedModel, openAiReasoningRequest } from "./openai-models";
import {
  customerReplyConversationRules,
  firstCustomerTurnFromThread,
  isSmsLikeChannel,
} from "./customer-reply-style";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import type { TriageResponseMode } from "./triage";
import { objectRecord, textValue } from "@kyro/core";

export type ReplyDraftContext = {
  /**
   * What "today" is, in the workspace's timezone.
   *
   * Without this the model wrote customer-facing dates from its own sense of
   * now: asked on Sunday 26 July 2026 to offer a time "on Monday", it offered
   * Monday the 20th -- six days in the past. The date parser was never the
   * problem; the writer simply did not know what day it was.
   */
  currentTime?: AssistantCurrentTimeContext | null;
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
  contactPhone?: string | null;
  contactAddress?: string | null;
  channelType?: string | null;
  conversationId?: string;
  eventId?: string;
  latestSubject?: string | null;
  leadTitle?: string | null;
  inquiryFacts?: {
    address: string | null;
    missingInfo: string[];
    preferredTime: string | null;
    responseMode?: TriageResponseMode | null;
  } | null;
  prompt: string | null;
  replyWriting?: ReplyWritingSettings;
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
  verifiedAvailability?: {
    endsAt: string;
    label: string;
    startsAt: string;
    timeZone: string;
  } | null;
  thread?: Array<{
    body: string | null;
    channelType?: string | null;
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
  return envValue("OPENAI_REPLY_DRAFT_MODEL") || openAiBalancedModel();
}

function replyDraftMaxOutputTokens() {
  const parsed = Number(envValue("OPENAI_REPLY_DRAFT_MAX_OUTPUT_TOKENS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 520;
}

export function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);

  return textValue(error.message) ?? "OpenAI reply generation failed.";
}

export function responseOutputText(payload: unknown) {
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
      const value = textValue(objectRecord(part).text);

      if (value) {
        return value;
      }
    }
  }

  return null;
}

function replySubject(value: string | null) {
  const subject = value?.trim() || "Follow-up";

  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function triageResponseMode(value: unknown): TriageResponseMode | null {
  return value === "known_business_fact" ||
    value === "simple_business_message" ||
    value === "service_inquiry"
    ? value
    : null;
}

function requiredConversationReplyRules(context: ReplyDraftContext) {
  if (context.source !== "conversation") {
    return [];
  }

  const responseMode = context.inquiryFacts?.responseMode ?? null;

  if (
    responseMode === "known_business_fact" ||
    responseMode === "simple_business_message"
  ) {
    return [
      "The latest customer message was classified as a direct business question or simple business message. Answer or acknowledge that message naturally and directly.",
      "Do not add a quote-intake checklist, ask for unrelated job details, or turn this into a service-booking flow.",
      "If the requested answer is not available in context, ask only the single most useful clarification or say the team can confirm it.",
    ];
  }

  const missingInfo = context.inquiryFacts?.missingInfo ?? [];
  const hasAddress =
    Boolean(context.contactAddress?.trim()) ||
    Boolean(context.inquiryFacts?.address?.trim());
  const hasPreferredTime = Boolean(
    context.inquiryFacts?.preferredTime?.trim() ||
    context.verifiedAvailability?.startsAt,
  );
  const hasPhone = Boolean(context.contactPhone?.trim());
  const hasEmail = Boolean(context.contactEmail?.trim());

  const serviceRules = [
    "For this genuine service inquiry, an attendable job address is needed before a quote or site visit can happen. If the thread and CRM profile do not contain one and it is needed for the next step, ask for it.",
    context.verifiedAvailability
      ? `Kyro has checked the workspace calendar and verified that ${context.verifiedAvailability.label} is available. Offer that specific time naturally as the business's proposed appointment time. Do not ask the customer for a preferred day or time instead.`
      : "For this genuine service inquiry, a preferred day or time is needed before attendance can be arranged. If the user explicitly supplies one in their reply instruction, use it. Otherwise ask only when it is needed for the next step. Do not claim calendar availability unless the user instruction or context explicitly provides it.",
    "For an email-originated service inquiry, ask for a phone number if the CRM profile and thread do not contain one and it is needed to progress the job.",
    "For an SMS or phone-originated service inquiry, ask for an email address if the CRM profile and thread do not contain one and it is needed to progress the job.",
    hasAddress ? null : "Required missing detail: job address.",
    hasPreferredTime
      ? null
      : "Required missing detail: preferred day or time, unless supplied by the user's reply instruction.",
    hasPhone
      ? null
      : "Required missing detail for email-originated inquiry: phone number.",
    hasEmail
      ? null
      : "Required missing detail for SMS/phone-originated inquiry: email address.",
    missingInfo.length
      ? `Existing inquiry missing-info labels: ${missingInfo.join(", ")}.`
      : null,
  ].filter((rule): rule is string => Boolean(rule));

  if (responseMode === "service_inquiry") {
    return serviceRules;
  }

  return [
    "The stored conversation predates response-mode classification. Infer the latest customer message's intent from the thread before applying any workflow.",
    "If it is a simple question, business-information request, acknowledgement, or other standalone message, answer it directly and ignore unrelated legacy missing-info labels.",
    "Use the available inquiry facts only if the latest customer message is genuinely requesting or progressing specific work, a quote, attendance, or an appointment, and ask only for the next detail actually needed.",
    "For a genuine service inquiry, a preferred day or time remains missing unless supplied by the user's reply instruction or already present in the conversation; when supplied, use it and do not ask again.",
    missingInfo.length
      ? `Potential service-inquiry details recorded as missing, to use only when relevant to the latest message: ${missingInfo.join(", ")}.`
      : "No service-inquiry details are currently recorded as missing.",
  ];
}

export function buildReplyDraftPrompt(context: ReplyDraftContext) {
  const replyWriting = context.replyWriting ?? DEFAULT_REPLY_WRITING_SETTINGS;
  const promptContext: ReplyDraftContext = {
    ...context,
    replyWriting,
  };
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
      context: promptContext,
      outputContract: {
        body: "string",
        calendarCommitment:
          "boolean - true when this reply proposes or confirms a concrete attendance date and time that Kyro should reserve on the calendar",
        subject: "string",
      },
      rules: [
        "Return JSON only.",
        // Every date the customer reads is written here, so the writer needs
        // the workspace's own clock. First, because everything after it about
        // weekdays and relative dates depends on knowing what day it is.
        ...(context.currentTime ? [context.currentTime.promptLine] : []),
        "Write as Kyro on behalf of the business owner, not as an AI assistant.",
        "Apply context.replyWriting to tone, wording style, message length, sign-off behavior, trade phrasing, and reusable instructions.",
        "Do not invent prices, availability, addresses, phone numbers, or promises not present in context.",
        "Follow the user's direction prompt if provided, unless it conflicts with the available context.",
        "First understand the latest customer message and the user's reply instruction. A CRM conversation is not automatically a job-intake request.",
        "Prefer the shortest complete and useful answer. Do not ask for unrelated details merely because the conversation has missing-info labels.",
        "Treat a day or time explicitly supplied by the user in context.prompt as authorized business availability for this reply.",
        "Treat context.verifiedAvailability as an authoritative calendar check. Use its exact date and time in the reply when present; do not invent another slot and do not ask the customer what time they prefer.",
        "Set calendarCommitment to true when the drafted reply makes a concrete commitment or proposal with a specific date and time for attendance, including an option that is still waiting for the customer to accept.",
        "Set calendarCommitment to false when the reply merely asks what time suits, asks for availability, requests missing information without offering a concrete time, or does not contain a sufficiently specific attendance date and time.",
        // A text message has no subject line, so asking for one only invites
        // the model to write a header the customer will never see.
        ...(isSmsLikeChannel(context.channelType)
          ? [
              "This is a text message, not an email. There is no subject line -- put everything in the body.",
            ]
          : ["Use a normal email subject beginning with Re: when appropriate."]),
        ...customerReplyConversationRules({
          channel: context.channelType,
          isFirstCustomerTurn: firstCustomerTurnFromThread(context.thread),
        }),
        ...replyWritingPromptRules(replyWriting, context.channelType, firstCustomerTurnFromThread(context.thread)).map(
          (rule) => `Writing style - ${rule}`,
        ),
        ...skippedEmailRules,
        ...requiredConversationReplyRules(promptContext),
      ],
      task: "Draft an outbound reply that follows the user's latest instruction and is ready to send.",
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
    calendarCommitment: parsed.calendarCommitment === true,
    subject: textValue(parsed.subject) ?? fallbackSubject,
  };
}

async function runOpenAiReplyDraft(context: ReplyDraftContext) {
  const apiKey = openAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for reply generation.");
  }

  const model = replyDraftModel();
  const prompt = buildReplyDraftPrompt(context);
  const response = await fetchAiProvider(
    "https://api.openai.com/v1/responses",
    {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You draft customer replies for Kyro, a trades/service CRM. Apply the workspace writing style in the prompt and return compact JSON matching the schema.",
        max_output_tokens: replyDraftMaxOutputTokens(),
        model,
        ...openAiReasoningRequest(
          model,
          "OPENAI_REPLY_DRAFT_REASONING_EFFORT",
          "low",
        ),
        text: {
          format: {
            name: "kyro_reply_draft",
            schema: {
              additionalProperties: false,
              properties: {
                body: { type: "string" },
                calendarCommitment: { type: "boolean" },
                subject: { type: "string" },
              },
              required: ["subject", "body", "calendarCommitment"],
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
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload));
  }

  const outputText = responseOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI returned an empty reply draft.");
  }

  const usage = openAiUsageFromResponse(payload, {
    prompt,
    text: outputText,
  });

  return {
    ...parseDraft(outputText, replySubject(context.latestSubject ?? null)),
    model,
    usage: {
      ...usage,
      providerUsageId: openAiProviderUsageId(payload) ?? null,
    },
  };
}

async function conversationContext(
  supabase: SupabaseClient,
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
  const latestInboundMessage = [...review.messages]
    .reverse()
    .find((message) => message.direction === "inbound");

  return {
    channelType: latestInboundMessage?.channelType ?? null,
    contactAddress: review.contact?.address ?? null,
    contactEmail: review.contact?.email ?? null,
    contactName: review.contact?.name ?? null,
    contactPhone: review.contact?.phone ?? null,
    conversationId,
    inquiryFacts: review.inquiryFacts
      ? {
          address: review.inquiryFacts.address,
          missingInfo: review.inquiryFacts.missingInfo,
          preferredTime: review.inquiryFacts.preferredTime,
          responseMode: triageResponseMode(
            review.inquiryFacts.metadata.responseMode,
          ),
        }
      : null,
    latestSubject: latestSubject ?? review.lead?.title ?? null,
    leadTitle: review.lead?.title ?? null,
    prompt,
    source: "conversation",
    thread: review.messages.slice(-10).map((message) => ({
      body: message.bodyText,
      channelType: message.channelType,
      direction: message.direction,
      subject: message.subject,
    })),
  };
}

async function skippedEmailContext(
  supabase: SupabaseClient,
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
    channelType: "email",
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

export async function loadBusinessProfile(
  supabase: SupabaseClient,
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

export async function generateReplyDraft({
  conversationId,
  currentTime,
  prompt,
  skippedEmailId,
  supabase,
  userId,
  verifiedAvailability,
  workspaceId,
}: {
  conversationId?: string | null;
  /** Pass the caller's clock when it already has one; otherwise it is loaded. */
  currentTime?: AssistantCurrentTimeContext | null;
  prompt?: string | null;
  skippedEmailId?: string | null;
  supabase: SupabaseClient;
  userId: string;
  verifiedAvailability?: ReplyDraftContext["verifiedAvailability"];
  workspaceId: string;
}) {
  if (!conversationId && !skippedEmailId) {
    throw new Error("A conversation or skipped email is required.");
  }

  await assertWorkspaceAutomationAllowed(workspaceId);
  const context = conversationId
    ? await conversationContext(
        supabase,
        workspaceId,
        conversationId,
        textValue(prompt),
      )
    : await skippedEmailContext(
        supabase,
        workspaceId,
        String(skippedEmailId),
        textValue(prompt),
      );

  if (!context) {
    throw new Error("Unable to find reply context.");
  }

  const [businessProfile, communicationSettings, generalSettings] =
    await Promise.all([
      loadBusinessProfile(supabase, workspaceId),
      getCommunicationSettings(supabase, workspaceId),
      // Only needed for the timezone, and only when the caller has no clock.
      currentTime
        ? Promise.resolve(null)
        : getWorkspaceGeneralSettings(supabase, workspaceId),
    ]);
  context.businessProfile = businessProfile;
  context.replyWriting = communicationSettings.replyWriting;
  context.verifiedAvailability = verifiedAvailability ?? null;
  context.currentTime =
    currentTime ??
    buildAssistantCurrentTimeContext(generalSettings?.timeZone ?? "UTC");

  const startedAt = Date.now();
  const draft = await runOpenAiReplyDraft(context);
  const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
    supabase,
    workspaceId,
    "OPENAI_LLM_MARKUP_RATE",
  );
  const usageEvents = buildLlmUsageEvents({
    context: {
      metadata: { source: context.source },
      providerUsageId: draft.usage.providerUsageId,
      usageMarkupRate,
      userId,
      workspaceId,
    },
    model: draft.model,
    provider: "openai",
    service: "llm",
    usage: draft.usage,
  });
  const usageTotals = usageEventTotals(usageEvents);
  const { data: aiRun, error: aiRunError } = await supabase
    .from("ai_runs")
    .insert({
      actual_cost: String(usageTotals.costSnapshot),
      completed_at: new Date().toISOString(),
      estimated_cost: String(usageTotals.costSnapshot),
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
        calendarCommitment: draft.calendarCommitment,
        subject: draft.subject,
      },
      provider: "openai",
      risk_level: "medium",
      status: "completed",
      task_type: "reply_draft_generation",
      tool_calls: [],
      usage: {
        cachedInputTokens: draft.usage.cachedInputTokens,
        customerCharge: usageTotals.customerChargeSnapshot,
        inputTokens: draft.usage.inputTokens,
        outputTokens: draft.usage.outputTokens,
        reasoningTokens: draft.usage.reasoningTokens,
        totalTokens: draft.usage.totalTokens,
      },
      user_id: userId,
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  // See customer-message-generation: the model has already been paid for, so
  // record the charge even if the ai_runs row failed, and never drop it silently.
  if (aiRunError) {
    console.error(`Unable to record ai_run for reply draft: ${aiRunError.message}`);
  }

  const aiRunId = aiRun?.id ? String(aiRun.id) : null;

  await recordUsageEvents(supabase, {
    context: "reply_draft",
    events: usageEvents.map((event) => ({
      ...event,
      ...(aiRunId
        ? { aiRunId, sourceId: aiRunId, sourceType: "ai_run" as const }
        : {}),
    })),
    userId,
    workspaceId,
  });

  return {
    body: draft.body,
    calendarCommitment: draft.calendarCommitment,
    subject: draft.subject,
  };
}
