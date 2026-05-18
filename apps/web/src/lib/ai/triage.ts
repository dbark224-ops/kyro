import { selectModelRoute } from "@kyro/ai";
import { getInitialActionStatus, createUsageEvent } from "@kyro/api";
import type { ModelRouteRequest, UsageEventCreate } from "@kyro/contracts";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";

export type AiRunItem = {
  id: string;
  taskType: string;
  status: string;
  provider: string;
  model: string;
  actualCost: string | null;
  createdAt: string;
};

export type UsageLedgerItem = {
  id: string;
  service: string;
  usageType: string;
  quantity: string;
  costSnapshot: string;
  customerChargeSnapshot: string;
  currency: string;
  createdAt: string;
};

export type ModelRouteItem = {
  id: string;
  taskType: string;
  selectedProvider: string;
  selectedModel: string;
  decisionReason: string;
  createdAt: string;
};

export type StubAiTriageContext = {
  source?: string;
  sourceEventId?: string;
  contactId?: string;
  leadId?: string;
  conversationId?: string;
  messageId?: string;
  leadTitle?: string;
  serviceType?: string | null;
  contactAddress?: string | null;
  summary?: string;
  threadMessageCount?: number;
  threadSummary?: string;
  inquiryFactsOverride?: InquiryFacts;
};

export type InquiryFacts = {
  jobType: string | null;
  address: string | null;
  preferredTime: string | null;
  urgency: "low" | "normal" | "urgent";
  budget: string | null;
  fit: "likely_fit" | "needs_review" | "not_fit";
  missingInfo: string[];
};

type ProposedActionInput = {
  type: string;
  targetType: string;
  targetId: string | null;
  input: Record<string, unknown>;
  policyReason: string;
};

type TriageDecision = {
  inquiryFacts: InquiryFacts;
  summary: string;
  replyDraft: {
    subject: string | null;
    body: string | null;
  };
  providerUsed: "stub" | "ollama" | "openai";
  fallbackReason?: string;
  inputTokens?: number;
  outputTokens?: number;
};

const INPUT_TOKEN_UNIT_COST = 0.00000015;
const OUTPUT_TOKEN_UNIT_COST = 0.0000006;
const MARKUP_RATE = 0.25;

function priceUsage(quantity: number, unitCost: number) {
  const cost = quantity * unitCost;
  const customerCharge = cost * (1 + MARKUP_RATE);

  return {
    unitCostSnapshot: unitCost,
    markupSnapshot: MARKUP_RATE,
    costSnapshot: Number(cost.toFixed(8)),
    customerChargeSnapshot: Number(customerCharge.toFixed(8))
  };
}

function toUsageEvent(input: UsageEventCreate) {
  const event = createUsageEvent(input);

  return {
    workspace_id: event.workspaceId,
    user_id: event.userId ?? null,
    source_type: event.sourceType ?? null,
    source_id: event.sourceId ?? null,
    ai_run_id: event.aiRunId ?? null,
    workflow_run_id: event.workflowRunId ?? null,
    action_id: event.actionId ?? null,
    provider: event.provider,
    service: event.service,
    model: event.model ?? null,
    usage_type: event.usageType,
    quantity: String(event.quantity),
    unit: event.unit,
    unit_price_snapshot: event.unitPriceSnapshot ? String(event.unitPriceSnapshot) : null,
    unit_cost_snapshot: String(event.unitCostSnapshot),
    markup_snapshot: String(event.markupSnapshot),
    currency: event.currency,
    cost_snapshot: String(event.costSnapshot),
    customer_charge_snapshot: String(event.customerChargeSnapshot),
    metadata: {}
  };
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function titleCaseJobType(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[a-zA-Z][a-zA-Z'/-]*/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) {
      return word;
    }

    return word
      .split(/([/-])/)
      .map((part) =>
        part === "/" || part === "-"
          ? part
          : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`
      )
      .join("");
  });
}

function stripLeadTitleSuffix(value: string) {
  return value
    .replace(/\s+(?:enquiry|inquiry|request)\s+from\s+.+$/i, "")
    .replace(/\s+from\s+.+$/i, "")
    .trim();
}

function isGenericJobType(value: string | null) {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();

  return [
    /^(?:new\s+)?(?:enquiry|inquiry|lead|message|request)(?:\s+from\s+.+)?$/,
    /^(?:quote\s+)?(?:enquiry|inquiry|request)(?:\s+from\s+.+)?$/,
    /^(?:manual\s+)?inbound(?:\s+(?:enquiry|inquiry))?(?:\s+from\s+.+)?$/,
    /^new\s+(?:enquiry|inquiry)\s+from\s+.+$/
  ].some((pattern) => pattern.test(normalized));
}

function normalizeJobTypeCandidate(value: string | null) {
  const titled = titleCaseJobType(value);

  if (!titled) {
    return null;
  }

  const stripped = titleCaseJobType(stripLeadTitleSuffix(titled));

  if (!stripped || isGenericJobType(stripped)) {
    return null;
  }

  return stripped;
}

function quoteAwareLabel(base: string, text: string) {
  return /\b(quote|estimate|price|pricing)\b/i.test(text) && !/\bquote\b/i.test(base)
    ? `${base} Quote`
    : base;
}

function inferSpecificTradeJobType(text: string) {
  if (/\bbathroom\b/i.test(text)) {
    const base = /\b(renovat|reno|remodel|redo|upgrade)\w*\b/i.test(text)
      ? "Bathroom Renovation"
      : "Bathroom";

    return quoteAwareLabel(base, text);
  }

  if (/\bkitchen\b/i.test(text)) {
    const base = /\b(renovat|reno|remodel|redo|upgrade)\w*\b/i.test(text)
      ? "Kitchen Renovation"
      : "Kitchen";

    return quoteAwareLabel(base, text);
  }

  if (/\blaundry\b/i.test(text)) {
    return quoteAwareLabel("Laundry Renovation", text);
  }

  if (/\bhot water\b/i.test(text)) {
    return quoteAwareLabel("Hot Water Service", text);
  }

  if (/\b(blocked|blockage)\b/i.test(text) || /\bdrain\b/i.test(text)) {
    return quoteAwareLabel("Blocked Drain", text);
  }

  if (/\b(leak|leaking|burst|flood)\b/i.test(text)) {
    return quoteAwareLabel("Leak Repair", text);
  }

  if (/\btoilet\b/i.test(text)) {
    const base = /\b(replace|replacement|install|installation)\w*\b/i.test(text)
      ? "Toilet Replacement"
      : "Toilet Repair";

    return quoteAwareLabel(base, text);
  }

  if (/\b(shower|screen)\b/i.test(text)) {
    return quoteAwareLabel("Shower Repair", text);
  }

  if (/\b(tap|mixer|faucet)\b/i.test(text)) {
    return quoteAwareLabel("Tap Repair", text);
  }

  if (/\b(tile|tiling|tiles)\b/i.test(text)) {
    return quoteAwareLabel("Tiling", text);
  }

  if (/\b(paint|painting)\b/i.test(text)) {
    return quoteAwareLabel("Painting", text);
  }

  if (/\b(plaster|plastering|drywall)\b/i.test(text)) {
    return quoteAwareLabel("Plastering", text);
  }

  if (/\b(electrical|electrician|power point|lights?|lighting)\b/i.test(text)) {
    return quoteAwareLabel("Electrical", text);
  }

  if (/\b(air con|air conditioning|ac unit)\b/i.test(text)) {
    return quoteAwareLabel("Air Conditioning", text);
  }

  if (/\b(deck|decking)\b/i.test(text)) {
    return quoteAwareLabel("Decking", text);
  }

  if (/\b(fence|fencing|gate)\b/i.test(text)) {
    return quoteAwareLabel("Fencing", text);
  }

  if (/\b(renovat|reno|remodel)\w*\b/i.test(text)) {
    return quoteAwareLabel("Renovation", text);
  }

  if (/\bquote\b/i.test(text)) {
    return "Quote Request";
  }

  return null;
}

function inferJobType(text: string, context: StubAiTriageContext) {
  const serviceType = normalizeJobTypeCandidate(context.serviceType ?? null);

  if (serviceType) {
    return serviceType;
  }

  const specificJobType = inferSpecificTradeJobType(text);

  if (specificJobType) {
    return specificJobType;
  }

  const leadTitle = normalizeJobTypeCandidate(context.leadTitle ?? null);

  if (leadTitle) {
    return leadTitle;
  }

  const lowered = text.toLowerCase();

  if (lowered.includes("hot water")) {
    return "Hot water service";
  }

  if (lowered.includes("leak") || lowered.includes("burst")) {
    return "Leak repair";
  }

  if (lowered.includes("blocked") || lowered.includes("drain")) {
    return "Blocked drain";
  }

  if (lowered.includes("quote")) {
    return "Quote request";
  }

  return null;
}

function inferAddress(text: string, context: StubAiTriageContext) {
  if (context.contactAddress?.trim()) {
    return context.contactAddress.trim();
  }

  return firstMatch(text, [
    /\b(?:at|address is|job is at|located at)\s+([0-9][a-z0-9\s,'/-]+(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|lane|ln|place|pl|terrace|tce|way)\b[^\n.]*)/i,
    /\b([0-9]{1,5}\s+[a-z0-9\s,'/-]+(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|lane|ln|place|pl|terrace|tce|way)\b[^\n.]*)/i
  ]);
}

function inferPreferredTime(text: string) {
  return firstMatch(text, [
    /\b((?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening|night))?)\b/i,
    /\b((?:next week|this week|as soon as possible|asap|morning|afternoon|evening))\b/i
  ]);
}

function inferUrgency(text: string): InquiryFacts["urgency"] {
  return /\b(urgent|emergency|asap|burst|flood|no hot water|leaking badly)\b/i.test(text)
    ? "urgent"
    : "normal";
}

function inferBudget(text: string) {
  return firstMatch(text, [/\b(\$[0-9][0-9,]*(?:\.\d{2})?)\b/i]);
}

function inferFit(text: string, jobType: string | null): InquiryFacts["fit"] {
  if (/\b(not interested|wrong number|not needed|cancel|do not contact)\b/i.test(text)) {
    return "not_fit";
  }

  return jobType ? "likely_fit" : "needs_review";
}

function extractInquiryFacts(context: StubAiTriageContext): InquiryFacts {
  const text = [
    context.leadTitle,
    context.serviceType,
    context.summary,
    context.threadSummary
  ]
    .filter(Boolean)
    .join("\n");
  const jobType = titleCaseJobType(inferJobType(text, context));
  const address = inferAddress(text, context);
  const preferredTime = inferPreferredTime(text);
  const budget = inferBudget(text);
  const fit = inferFit(text, jobType);
  const missingInfo = [
    jobType ? null : "Job type",
    address ? null : "Job address",
    preferredTime ? null : "Preferred time",
    fit === "needs_review" ? "Confirm this is a serviceable inquiry" : null
  ].filter((value): value is string => Boolean(value));

  return {
    address,
    budget,
    fit,
    jobType,
    missingInfo,
    preferredTime,
    urgency: inferUrgency(text)
  };
}

function buildReplyBody(facts: InquiryFacts) {
  if (facts.fit === "not_fit") {
    return "Thanks for letting me know. I will close this off on my side.";
  }

  if (facts.missingInfo.length > 0) {
    return `Thanks for getting in touch. I can help with that. Could you send through ${facts.missingInfo
      .map((item) => item.toLowerCase())
      .join(", ")} so I can work out the next step?`;
  }

  if (facts.address && facts.preferredTime) {
    return `Thanks, I have noted the job at ${facts.address}. ${facts.preferredTime} should work as a target, and I can line up the next step from here.`;
  }

  return "Thanks for the extra details. I have got that noted and can line up the next step from here.";
}

function buildQuoteLineItems(facts: InquiryFacts) {
  return [
    {
      description: facts.jobType ?? "Trade service",
      quantity: 1,
      unit: "job",
      unitPrice: null,
      total: null,
      notes: "Draft placeholder. Pricing to be confirmed by the user."
    }
  ];
}

function aiProviderMode() {
  return process.env.AI_PROVIDER?.trim().toLowerCase() ?? "stub";
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");
}

function ollamaModel() {
  return process.env.OLLAMA_MODEL?.trim() || "qwen3:8b";
}

function ollamaTimeoutMs() {
  const parsed = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function ollamaNumPredict() {
  const parsed = Number(process.env.OLLAMA_NUM_PREDICT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 320;
}

function ollamaThinkEnabled() {
  const value = process.env.OLLAMA_THINK?.trim().toLowerCase() ?? "";
  return ["1", "true", "yes", "on"].includes(value);
}

function openAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function openAiTriageModel(fallbackModel: string) {
  return (
    process.env.OPENAI_TRIAGE_MODEL?.trim() ||
    process.env.OPENAI_LOW_COST_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    fallbackModel ||
    "gpt-4.1-mini"
  );
}

function openAiTriageMaxOutputTokens() {
  const parsed = Number(process.env.OPENAI_TRIAGE_MAX_OUTPUT_TOKENS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 700;
}

function describeOllamaError(error: unknown, timeoutMs: number) {
  if (error instanceof Error && error.name === "AbortError") {
    return `Local Ollama triage timed out after ${timeoutMs}ms.`;
  }

  return error instanceof Error ? error.message : "Local Ollama triage failed.";
}

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);
  return textValue(error.message) ?? "OpenAI triage request failed.";
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Local model response did not contain a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
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
    outputTokens: numberValue(usage.output_tokens) ?? estimateTokens(text)
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : null))
        .filter((item): item is string => Boolean(item))
    : [];
}

function normalizeUrgency(value: unknown): InquiryFacts["urgency"] {
  return value === "low" || value === "urgent" ? value : "normal";
}

function normalizeFit(value: unknown): InquiryFacts["fit"] {
  return value === "likely_fit" || value === "not_fit" ? value : "needs_review";
}

function normalizeLocalFacts(value: unknown, fallback: InquiryFacts): InquiryFacts {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const modelJobType = normalizeJobTypeCandidate(textValue(raw.jobType));
  const facts = {
    address: textValue(raw.address) ?? fallback.address,
    budget: textValue(raw.budget) ?? fallback.budget,
    fit: normalizeFit(raw.fit ?? fallback.fit),
    jobType: modelJobType ?? fallback.jobType,
    missingInfo: normalizeStringArray(raw.missingInfo),
    preferredTime: textValue(raw.preferredTime) ?? fallback.preferredTime,
    urgency: normalizeUrgency(raw.urgency ?? fallback.urgency)
  };

  if (facts.missingInfo.length === 0) {
    facts.missingInfo = [
      facts.jobType ? null : "Job type",
      facts.address ? null : "Job address",
      facts.preferredTime ? null : "Preferred time",
      facts.fit === "needs_review" ? "Confirm this is a serviceable inquiry" : null
    ].filter((item): item is string => Boolean(item));
  }

  return facts;
}

function buildOllamaPrompt(context: StubAiTriageContext) {
  return JSON.stringify(
    {
      task: context.inquiryFactsOverride
        ? "Draft a concise customer reply from authoritative corrected inquiry facts."
        : "Extract trade inquiry facts and draft a concise customer reply.",
      outputContract: {
        summary: "string",
        inquiryFacts: {
          jobType: "string|null",
          address: "string|null",
          preferredTime: "string|null",
          urgency: "low|normal|urgent",
          budget: "string|null",
          fit: "likely_fit|needs_review|not_fit",
          missingInfo: ["string"]
        },
        replyDraft: {
          subject: "string|null",
          body: "string|null"
        }
      },
      rules: [
        "Return JSON only.",
        "Do not invent an address, price, date, or customer detail.",
        "jobType must describe the trade work being requested, not the lead title or contact name.",
        "Never use placeholder jobType values like 'New inquiry from John', 'Quote request from Sarah', or 'Manual inbound enquiry'.",
        "For example, 'renovating my bathroom' plus 'quote' should become 'Bathroom Renovation Quote'.",
        "If authoritativeInquiryFacts is present, echo it exactly in inquiryFacts and do not reinterpret it.",
        "If required info is missing, put it in missingInfo.",
        "Keep the reply draft friendly, direct, and suitable for a trades business."
      ],
      authoritativeInquiryFacts: context.inquiryFactsOverride ?? null,
      context
    },
    null,
    2
  );
}

function buildStubDecision(context: StubAiTriageContext, fallbackReason?: string): TriageDecision {
  const inquiryFacts = context.inquiryFactsOverride ?? extractInquiryFacts(context);

  return {
    fallbackReason,
    inquiryFacts,
    inputTokens: 900,
    outputTokens: 180,
    providerUsed: "stub",
    replyDraft: {
      body: buildReplyBody(inquiryFacts),
      subject: inquiryFacts.missingInfo.length > 0 ? "A few details for your quote" : "Thanks for the details"
    },
    summary:
      context.summary ??
      context.threadSummary ??
      "Stub triage identified a likely inbound lead and prepared a reply draft."
  };
}

async function runOllamaTriage(context: StubAiTriageContext): Promise<TriageDecision> {
  const fallbackFacts = context.inquiryFactsOverride ?? extractInquiryFacts(context);
  const prompt = buildOllamaPrompt(context);
  const controller = new AbortController();
  const timeoutMs = ollamaTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      body: JSON.stringify({
        format: "json",
        messages: [
          {
            role: "system",
            content:
              "You are Kyro's trades CRM triage engine. Return compact JSON matching the requested contract."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        model: ollamaModel(),
        options: {
          num_predict: ollamaNumPredict(),
          temperature: 0.1
        },
        stream: false,
        think: ollamaThinkEnabled()
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const message = payload.message && typeof payload.message === "object"
      ? (payload.message as Record<string, unknown>)
      : {};
    const content = textValue(message.content);

    if (!content) {
      throw new Error("Ollama returned an empty message.");
    }

    const parsed = extractJsonObject(content);
    const replyDraft = objectRecord(parsed.replyDraft);
    const facts = context.inquiryFactsOverride ?? normalizeLocalFacts(parsed.inquiryFacts, fallbackFacts);

    return {
      inquiryFacts: facts,
      inputTokens:
        typeof payload.prompt_eval_count === "number"
          ? payload.prompt_eval_count
          : estimateTokens(prompt),
      outputTokens:
        typeof payload.eval_count === "number" ? payload.eval_count : estimateTokens(content),
      providerUsed: "ollama",
      replyDraft: {
        body: textValue(replyDraft.body) ?? buildReplyBody(facts),
        subject:
          textValue(replyDraft.subject) ??
          (facts.missingInfo.length > 0 ? "A few details for your quote" : "Thanks for the details")
      },
      summary:
        textValue(parsed.summary) ??
        context.summary ??
        "Local Ollama triage extracted inquiry facts and prepared action proposals."
    };
  } catch (error) {
    throw new Error(describeOllamaError(error, timeoutMs));
  } finally {
    clearTimeout(timeout);
  }
}

async function runOpenAiTriage(
  context: StubAiTriageContext,
  fallbackModel: string
): Promise<TriageDecision> {
  const apiKey = openAiApiKey();
  const fallbackFacts = context.inquiryFactsOverride ?? extractInquiryFacts(context);
  const prompt = buildOllamaPrompt(context);
  const model = openAiTriageModel(fallbackModel);

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for inbound triage.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: prompt,
      instructions:
        "You are Kyro's trades CRM triage engine. Return compact JSON matching the requested contract.",
      max_output_tokens: openAiTriageMaxOutputTokens(),
      model,
      text: {
        format: {
          name: "kyro_inbound_triage",
          schema: {
            additionalProperties: false,
            properties: {
              inquiryFacts: {
                additionalProperties: false,
                properties: {
                  address: { type: ["string", "null"] },
                  budget: { type: ["string", "null"] },
                  fit: { enum: ["likely_fit", "needs_review", "not_fit"], type: "string" },
                  jobType: { type: ["string", "null"] },
                  missingInfo: {
                    items: { type: "string" },
                    type: "array"
                  },
                  preferredTime: { type: ["string", "null"] },
                  urgency: { enum: ["low", "normal", "urgent"], type: "string" }
                },
                required: [
                  "jobType",
                  "address",
                  "preferredTime",
                  "urgency",
                  "budget",
                  "fit",
                  "missingInfo"
                ],
                type: "object"
              },
              replyDraft: {
                additionalProperties: false,
                properties: {
                  body: { type: ["string", "null"] },
                  subject: { type: ["string", "null"] }
                },
                required: ["subject", "body"],
                type: "object"
              },
              summary: { type: "string" }
            },
            required: ["summary", "inquiryFacts", "replyDraft"],
            type: "object"
          },
          strict: true,
          type: "json_schema"
        }
      }
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload));
  }

  const content = responseOutputText(payload);

  if (!content) {
    throw new Error("OpenAI returned an empty triage response.");
  }

  const parsed = extractJsonObject(content);
  const replyDraft = objectRecord(parsed.replyDraft);
  const facts = context.inquiryFactsOverride ?? normalizeLocalFacts(parsed.inquiryFacts, fallbackFacts);

  return {
    ...responseUsage(payload, prompt, content),
    inquiryFacts: facts,
    providerUsed: "openai",
    replyDraft: {
      body: textValue(replyDraft.body) ?? buildReplyBody(facts),
      subject:
        textValue(replyDraft.subject) ??
        (facts.missingInfo.length > 0 ? "A few details for your quote" : "Thanks for the details")
    },
    summary:
      textValue(parsed.summary) ??
      context.summary ??
      "OpenAI triage extracted inquiry facts and prepared action proposals."
  };
}

async function resolveTriageDecision(context: StubAiTriageContext, routeModel: string) {
  if (["local", "ollama"].includes(aiProviderMode())) {
    try {
      return await runOllamaTriage(context);
    } catch (error) {
      return buildStubDecision(
        context,
        error instanceof Error ? error.message : "Local Ollama triage failed."
      );
    }
  }

  if (aiProviderMode() === "openai") {
    try {
      return await runOpenAiTriage(context, routeModel);
    } catch (error) {
      return buildStubDecision(
        context,
        error instanceof Error ? error.message : "OpenAI triage request failed."
      );
    }
  }

  return buildStubDecision(context);
}

function buildActionProposals(
  aiRunId: string,
  eventId: string,
  context: StubAiTriageContext,
  facts: InquiryFacts,
  replyDraft: TriageDecision["replyDraft"]
) {
  const baseInput = {
    sourceAiRunId: aiRunId,
    sourceEventId: context.sourceEventId ?? eventId,
    leadId: context.leadId ?? null,
    contactId: context.contactId ?? null,
    conversationId: context.conversationId ?? null,
    messageId: context.messageId ?? null,
    inquiryFacts: facts,
    threadMessageCount: context.threadMessageCount ?? null,
    threadSummary: context.threadSummary ?? null,
    dryRun: true
  };
  const proposals: ProposedActionInput[] = [
    {
      input: {
        ...baseInput,
        subject:
          replyDraft.subject ??
          (facts.missingInfo.length > 0 ? "A few details for your quote" : "Thanks for the details"),
        body: replyDraft.body ?? buildReplyBody(facts)
      },
      policyReason: "Stub AI triage drafts outbound replies but never sends them.",
      targetId: context.conversationId ?? null,
      targetType: "conversation",
      type: "draft_reply"
    }
  ];

  if (facts.fit === "not_fit") {
    proposals.push({
      input: {
        ...baseInput,
        reason: "The conversation indicates the inquiry should be closed."
      },
      policyReason: "Lead closure proposals require user approval.",
      targetId: context.leadId ?? null,
      targetType: "lead",
      type: "mark_not_fit"
    });

    return proposals;
  }

  if (facts.address && facts.preferredTime) {
    proposals.push({
      input: {
        ...baseInput,
        address: facts.address,
        preferredTime: facts.preferredTime,
        title: `Site visit for ${facts.jobType ?? "quote inquiry"}`
      },
      policyReason: "Calendar or booking work is dry-run only for now.",
      targetId: context.conversationId ?? null,
      targetType: "conversation",
      type: "book_site_visit"
    });
  }

  if (facts.jobType && facts.address) {
    proposals.push({
      input: {
        ...baseInput,
        quoteDraft: {
          title: `${facts.jobType} quote draft`,
          lineItems: buildQuoteLineItems(facts),
          notes: [
            facts.address ? `Job address: ${facts.address}` : null,
            facts.preferredTime ? `Preferred time: ${facts.preferredTime}` : null,
            facts.budget ? `Mentioned budget: ${facts.budget}` : null,
            "Pricing is intentionally blank until the user confirms it."
          ].filter(Boolean)
        }
      },
      policyReason: "Quote drafts are internal documents and require user approval before creation.",
      targetId: context.conversationId ?? null,
      targetType: "conversation",
      type: "create_quote_draft"
    });
  }

  return proposals;
}

export async function runStubAiTriage(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  context: StubAiTriageContext = {}
) {
  const routeRequest: ModelRouteRequest = {
    workspaceId,
    userId: user.id,
    taskType: "inbound_triage",
    riskLevel: "low",
    requiredCapabilities: ["classification", "lead_extraction", "action_proposal"],
    latencyTargetMs: 1500,
    estimatedInputTokens: 900
  };
  const route = selectModelRoute(routeRequest);
  const idempotencyKey = `ai.triage.stub.${crypto.randomUUID()}`;

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      type: "ai.triage.requested",
      source: context.source ?? "web.dashboard",
      idempotency_key: idempotencyKey,
      payload: {
        requestedByUserId: user.id,
        routeRequest,
        sourceEventId: context.sourceEventId ?? null,
        contactId: context.contactId ?? null,
        leadId: context.leadId ?? null,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        threadMessageCount: context.threadMessageCount ?? null
      },
      status: "processed",
      processed_at: new Date().toISOString()
    })
    .select("id,type,status")
    .single();

  if (eventError || !event) {
    throw new Error(`Unable to record AI triage event: ${eventError?.message ?? "unknown error"}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "ai_triage.requested",
    entityType: "event",
    entityId: String(event.id),
    after: {
      type: event.type,
      status: event.status
    }
  });

  const { data: aiRun, error: aiRunError } = await supabase
    .from("ai_runs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      mode: "workflow",
      task_type: routeRequest.taskType,
      risk_level: routeRequest.riskLevel,
      provider: route.provider,
      model: route.model,
      status: "running",
      input_refs: {
        eventId: event.id,
        sourceEventId: context.sourceEventId ?? null,
        contactId: context.contactId ?? null,
        leadId: context.leadId ?? null,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        threadMessageCount: context.threadMessageCount ?? null,
        threadSummary: context.threadSummary ?? null,
        source: context.source ?? "dashboard_smoke_test"
      },
      output: {},
      tool_calls: [],
      usage: {},
      estimated_cost: "0.0003"
    })
    .select("id")
    .single();

  if (aiRunError || !aiRun) {
    throw new Error(`Unable to create AI run: ${aiRunError?.message ?? "unknown error"}`);
  }

  const aiRunId = String(aiRun.id);

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "ai",
    actorId: aiRunId,
    action: "ai_run.started",
    entityType: "ai_run",
    entityId: aiRunId,
    after: {
      provider: route.provider,
      model: route.model,
      taskType: routeRequest.taskType
    }
  });

  const triageDecision = await resolveTriageDecision(context, route.model);
  const { error: routeError } = await supabase.from("model_route_decisions").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    ai_run_id: aiRunId,
    task_type: routeRequest.taskType,
    risk_level: routeRequest.riskLevel,
    selected_provider: route.provider,
    selected_model: route.model,
    fallback_used:
      (route.provider === "ollama" && triageDecision.providerUsed !== "ollama") ||
      (route.provider === "openai" && triageDecision.providerUsed !== "openai"),
    decision_reason: route.reason,
    budget_snapshot: {
      fallbackReason: triageDecision.fallbackReason ?? null,
      estimatedInputTokens: routeRequest.estimatedInputTokens,
      markupRate: MARKUP_RATE,
      providerUsed: triageDecision.providerUsed
    }
  });

  if (routeError) {
    throw new Error(`Unable to record model route decision: ${routeError.message}`);
  }

  const inputTokens = triageDecision.inputTokens ?? 900;
  const outputTokens = triageDecision.outputTokens ?? 180;
  const inputUnitCost = route.provider === "ollama" ? 0 : INPUT_TOKEN_UNIT_COST;
  const outputUnitCost = route.provider === "ollama" ? 0 : OUTPUT_TOKEN_UNIT_COST;
  const inputPrice = priceUsage(inputTokens, inputUnitCost);
  const outputPrice = priceUsage(outputTokens, outputUnitCost);
  const actualCost = Number((inputPrice.costSnapshot + outputPrice.costSnapshot).toFixed(8));
  const customerCharge = Number(
    (inputPrice.customerChargeSnapshot + outputPrice.customerChargeSnapshot).toFixed(8)
  );

  const usageEvents = [
    toUsageEvent({
      workspaceId,
      userId: user.id,
      sourceType: "ai_run",
      sourceId: aiRunId,
      aiRunId,
      provider: route.provider,
      service: "llm",
      model: route.model,
      usageType: "llm_input_tokens",
      quantity: inputTokens,
      unit: "token",
      unitCostSnapshot: inputPrice.unitCostSnapshot,
      markupSnapshot: inputPrice.markupSnapshot,
      costSnapshot: inputPrice.costSnapshot,
      customerChargeSnapshot: inputPrice.customerChargeSnapshot,
      currency: "USD"
    }),
    toUsageEvent({
      workspaceId,
      userId: user.id,
      sourceType: "ai_run",
      sourceId: aiRunId,
      aiRunId,
      provider: route.provider,
      service: "llm",
      model: route.model,
      usageType: "llm_output_tokens",
      quantity: outputTokens,
      unit: "token",
      unitCostSnapshot: outputPrice.unitCostSnapshot,
      markupSnapshot: outputPrice.markupSnapshot,
      costSnapshot: outputPrice.costSnapshot,
      customerChargeSnapshot: outputPrice.customerChargeSnapshot,
      currency: "USD"
    })
  ];

  const { error: usageError } = await supabase.from("usage_events").insert(usageEvents);

  if (usageError) {
    throw new Error(`Unable to record usage events: ${usageError.message}`);
  }

  const inquiryFacts = triageDecision.inquiryFacts;
  const actionProposals = buildActionProposals(
    aiRunId,
    String(event.id),
    context,
    inquiryFacts,
    triageDecision.replyDraft
  );
  const output = {
    classification: "new_lead_follow_up",
    confidence: triageDecision.providerUsed === "ollama" ? 0.76 : 0.86,
    fallbackReason: triageDecision.fallbackReason ?? null,
    inquiryFacts,
    authoritativeFactsUsed: Boolean(context.inquiryFactsOverride),
    providerUsed: triageDecision.providerUsed,
    summary: triageDecision.summary,
    threadMessageCount: context.threadMessageCount ?? null,
    proposedActionTypes: actionProposals.map((proposal) => proposal.type)
  };

  const { error: completeError } = await supabase
    .from("ai_runs")
    .update({
      status: "completed",
      output,
      usage: {
        inputTokens,
        outputTokens,
        customerCharge
      },
      actual_cost: String(actualCost),
      latency_ms: 320,
      completed_at: new Date().toISOString()
    })
    .eq("id", aiRunId);

  if (completeError) {
    throw new Error(`Unable to complete AI run: ${completeError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "ai",
    actorId: aiRunId,
    action: "ai_run.completed",
    entityType: "ai_run",
    entityId: aiRunId,
    after: {
      status: "completed",
      output,
      actualCost,
      customerCharge
    }
  });

  if (context.conversationId) {
    const { data: factsRecord, error: factsError } = await supabase
      .from("inquiry_facts")
      .upsert(
        {
          workspace_id: workspaceId,
          conversation_id: context.conversationId,
          contact_id: context.contactId ?? null,
          lead_id: context.leadId ?? null,
          source_ai_run_id: aiRunId,
          job_type: inquiryFacts.jobType,
          address: inquiryFacts.address,
          preferred_time: inquiryFacts.preferredTime,
          urgency: inquiryFacts.urgency,
          budget: inquiryFacts.budget,
          fit: inquiryFacts.fit,
          missing_info: inquiryFacts.missingInfo,
          source: context.inquiryFactsOverride
            ? "user_corrected_regeneration"
            : triageDecision.providerUsed === "ollama"
              ? "ai_ollama"
              : "ai_stub",
          edited_by_user_id: context.inquiryFactsOverride ? user.id : null,
          metadata: {
            authoritativeFactsUsed: Boolean(context.inquiryFactsOverride),
            fallbackReason: triageDecision.fallbackReason ?? null,
            providerUsed: triageDecision.providerUsed
          }
        },
        {
          onConflict: "workspace_id,conversation_id"
        }
      )
      .select("id")
      .single();

    if (factsError || !factsRecord) {
      throw new Error(`Unable to save inquiry facts: ${factsError?.message ?? "unknown error"}`);
    }

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "ai",
      actorId: aiRunId,
      action: "inquiry_facts.extracted",
      entityType: "inquiry_facts",
      entityId: String(factsRecord.id),
      after: {
        conversationId: context.conversationId,
        inquiryFacts,
        source: triageDecision.providerUsed
      },
      metadata: {
        aiRunId
      }
    });
  }

  const approvalRequired = true;
  const actionStatus = getInitialActionStatus(approvalRequired);
  const { data: actions, error: actionError } = await supabase
    .from("actions")
    .insert(
      actionProposals.map((proposal) => ({
        workspace_id: workspaceId,
        type: proposal.type,
        status: actionStatus,
        requested_by: "ai",
        requested_by_ai_run_id: aiRunId,
        approval_required: approvalRequired,
        target_type: proposal.targetType,
        target_id: proposal.targetId,
        input: proposal.input,
        result: {},
        policy_snapshot: {
          mode: "require_approval",
          reason: proposal.policyReason
        }
      }))
    )
    .select("id,type,status");

  if (actionError || !actions || actions.length === 0) {
    throw new Error(`Unable to create AI proposed action: ${actionError?.message ?? "unknown error"}`);
  }

  for (const action of actions) {
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "ai",
      actorId: aiRunId,
      action: "action.proposed",
      entityType: "action",
      entityId: String(action.id),
      after: {
        type: action.type,
        status: action.status
      },
      metadata: {
        aiRunId,
        route
      }
    });
  }

  const primaryAction = actions.find((action) => String(action.type) === "draft_reply") ?? actions[0];

  if (context.conversationId) {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({
        status: "reply_drafted"
      })
      .eq("workspace_id", workspaceId)
      .eq("id", context.conversationId);

    if (conversationError) {
      throw new Error(`Unable to mark conversation reply drafted: ${conversationError.message}`);
    }

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "ai",
      actorId: aiRunId,
      action: "conversation.reply_drafted",
      entityType: "conversation",
      entityId: context.conversationId,
      after: {
        status: "reply_drafted",
        actionId: String(primaryAction.id),
        proposedActionCount: actions.length
      },
      metadata: {
        aiRunId
      }
    });
  }

  return {
    aiRunId,
    actionId: String(primaryAction.id),
    actionIds: actions.map((action) => String(action.id)),
    actualCost,
    customerCharge
  };
}

export async function getAiLedger(supabase: SupabaseClient, workspaceId: string) {
  const [aiRuns, usageEvents, routeDecisions] = await Promise.all([
    supabase
      .from("ai_runs")
      .select("id,task_type,status,provider,model,actual_cost,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("usage_events")
      .select("id,service,usage_type,quantity,cost_snapshot,customer_charge_snapshot,currency,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("model_route_decisions")
      .select("id,task_type,selected_provider,selected_model,decision_reason,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5)
  ]);

  if (aiRuns.error) {
    throw new Error(`Unable to load AI runs: ${aiRuns.error.message}`);
  }

  if (usageEvents.error) {
    throw new Error(`Unable to load usage events: ${usageEvents.error.message}`);
  }

  if (routeDecisions.error) {
    throw new Error(`Unable to load route decisions: ${routeDecisions.error.message}`);
  }

  return {
    aiRuns: (aiRuns.data ?? []).map((run) => ({
      id: String(run.id),
      taskType: String(run.task_type),
      status: String(run.status),
      provider: String(run.provider),
      model: String(run.model),
      actualCost: run.actual_cost === null || run.actual_cost === undefined ? null : String(run.actual_cost),
      createdAt: String(run.created_at)
    })) satisfies AiRunItem[],
    usageEvents: (usageEvents.data ?? []).map((usage) => ({
      id: String(usage.id),
      service: String(usage.service),
      usageType: String(usage.usage_type),
      quantity: String(usage.quantity),
      costSnapshot: String(usage.cost_snapshot),
      customerChargeSnapshot: String(usage.customer_charge_snapshot),
      currency: String(usage.currency),
      createdAt: String(usage.created_at)
    })) satisfies UsageLedgerItem[],
    routeDecisions: (routeDecisions.data ?? []).map((decision) => ({
      id: String(decision.id),
      taskType: String(decision.task_type),
      selectedProvider: String(decision.selected_provider),
      selectedModel: String(decision.selected_model),
      decisionReason: String(decision.decision_reason),
      createdAt: String(decision.created_at)
    })) satisfies ModelRouteItem[]
  };
}
