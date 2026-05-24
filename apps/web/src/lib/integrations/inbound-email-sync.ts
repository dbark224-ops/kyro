import { selectModelRoute } from "@kyro/ai";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { runStubAiTriage } from "../ai/triage";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  GOOGLE_GMAIL_READ_SCOPE,
  GOOGLE_PROVIDER,
  GOOGLE_SERVICE,
  getGoogleOAuthConfig,
} from "./google";
import {
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_PROVIDER,
  MICROSOFT_SERVICE,
  getMicrosoftOAuthConfig,
} from "./microsoft";
import {
  findInboundEmailSenderRule,
  getInboundEmailSettings,
  shouldRunInboundEmailSync,
  type InboundEmailSettings,
  type InboundEmailSenderRule,
} from "./inbound-email-settings";
import {
  decryptIntegrationTokenSet,
  encryptIntegrationTokenSet,
} from "./token-vault";

export type InboundEmailSyncTrigger = "assistant" | "manual" | "scheduled";
export type InboundEmailProvider = "google" | "microsoft";

type ProviderConnectionRow = {
  account_email: string | null;
  id: string;
  last_sync_at: string | null;
  metadata: unknown;
  provider: string;
  scopes: unknown;
  service: string;
  token_set: unknown;
};

type OAuthTokenSet = {
  accessToken?: string;
  expiresIn?: number | null;
  idToken?: string | null;
  obtainedAt?: string | null;
  refreshToken?: string | null;
  scopes?: string[];
  tokenType?: string | null;
};

type InboundEmailMessage = {
  accountEmail: string | null;
  automated: boolean;
  bodyHtml: string | null;
  bodyText: string;
  connectionId: string;
  externalMessageId: string;
  externalThreadId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  headers: Record<string, string>;
  provider: InboundEmailProvider;
  receivedAt: string;
  snippet: string | null;
  subject: string;
  toEmails: string[];
};

type EmailClassificationCategory =
  | "business_actionable"
  | "business_reference"
  | "newsletter_or_automated"
  | "personal_ignore"
  | "personal_possible_relevance"
  | "spam_or_noise";

type EmailClassification = {
  actionHint: string | null;
  category: EmailClassificationCategory;
  confidence: number;
  providerUsed: "heuristic" | "manual" | "openai" | "sender_rule";
  promote: boolean;
  reason: string;
  suggestedServiceType: string | null;
  summary: string;
};

export type InboundEmailSyncResult = {
  checkedConnections: number;
  duplicates: number;
  errors: Array<{
    accountEmail: string | null;
    message: string;
    provider: InboundEmailProvider;
  }>;
  fetchedMessages: number;
  needsReconnect: Array<{
    accountEmail: string | null;
    missingScope: string;
    provider: InboundEmailProvider;
  }>;
  observedMessages: number;
  promotedConversations: Array<{
    conversationId: string;
    provider: InboundEmailProvider;
    subject: string;
  }>;
  promotedMessages: number;
  skippedBySchedule: number;
  trigger: InboundEmailSyncTrigger;
};

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000;
const INPUT_TOKEN_UNIT_COST = 0.00000015;
const OUTPUT_TOKEN_UNIT_COST = 0.0000006;
const MARKUP_RATE = 0.25;
const MAX_CLASSIFIER_BODY_CHARS = 4000;
const TOKEN_DECRYPT_RECONNECT_MESSAGE =
  "Reconnect this account because Kyro cannot decrypt the stored OAuth token with the current integration encryption key.";

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isRecoverableTokenAccessError(message: string) {
  return (
    /unable to authenticate data/i.test(message) ||
    /unsupported state/i.test(message) ||
    /invalid authentication tag/i.test(message) ||
    /bad decrypt/i.test(message)
  );
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeScopes(value: unknown) {
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
    : [];
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

function tokenExpiresAt(tokenSet: OAuthTokenSet) {
  const obtainedAt = textValue(tokenSet.obtainedAt);
  const expiresIn = typeof tokenSet.expiresIn === "number" ? tokenSet.expiresIn : null;

  if (!obtainedAt || !expiresIn) {
    return null;
  }

  return new Date(new Date(obtainedAt).getTime() + expiresIn * 1000).toISOString();
}

function isExpiring(tokenSet: OAuthTokenSet) {
  const expiresAt = tokenExpiresAt(tokenSet);

  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() - Date.now() < ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

function providerFromConnection(connection: ProviderConnectionRow): InboundEmailProvider | null {
  if (connection.provider === GOOGLE_PROVIDER) {
    return "google";
  }

  if (connection.provider === MICROSOFT_PROVIDER) {
    return "microsoft";
  }

  return null;
}

function hasMicrosoftScope(scopes: string[], requested: string) {
  const requestedShort = requested.replace("https://graph.microsoft.com/", "").toLowerCase();

  return scopes.some((scope) => {
    const normalized = scope.toLowerCase();

    return normalized === requestedShort || normalized === requested.toLowerCase();
  });
}

function truncate(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function safeSummaryText(message: InboundEmailMessage) {
  return truncate(message.bodyText || message.snippet || message.subject, 420);
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safeIsoDate(value: string | null, fallback = new Date().toISOString()) {
  if (!value) {
    return fallback;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function parseEmailAddress(value: string | null) {
  if (!value) {
    return { email: null, name: null };
  }

  const angleMatch = value.match(/^(.*?)<([^>]+)>/);
  const rawName = angleMatch?.[1]?.replace(/^"|"$/g, "").trim();
  const email = (angleMatch?.[2] ?? value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const name = rawName || (email ? value.replace(email, "").replace(/[<>]/g, "").trim() : null);

  return {
    email: email?.toLowerCase() ?? null,
    name: name || null,
  };
}

function contactNameFromMessage(message: InboundEmailMessage) {
  if (message.fromName) {
    return message.fromName;
  }

  if (message.fromEmail) {
    const local = message.fromEmail.split("@")[0] ?? "Email contact";

    return local
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ") || "Email contact";
  }

  return "Email contact";
}

function providerLabel(provider: InboundEmailProvider) {
  return provider === "google" ? "Gmail" : "Outlook";
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

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);

  return textValue(error.message) ?? "OpenAI email classification request failed.";
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function normalizeClassificationCategory(value: unknown): EmailClassificationCategory {
  const category = textValue(value);

  if (
    category === "business_actionable" ||
    category === "business_reference" ||
    category === "newsletter_or_automated" ||
    category === "personal_ignore" ||
    category === "personal_possible_relevance" ||
    category === "spam_or_noise"
  ) {
    return category;
  }

  return "business_reference";
}

function normalizeClassification(
  value: unknown,
  fallback: EmailClassification,
  providerUsed: EmailClassification["providerUsed"],
): EmailClassification {
  const raw = objectRecord(value);
  const category = normalizeClassificationCategory(raw.category ?? fallback.category);
  const confidence = Math.max(0, Math.min(1, numberValue(raw.confidence) ?? fallback.confidence));
  const promote = typeof raw.promote === "boolean" ? raw.promote : fallback.promote;

  return {
    actionHint: textValue(raw.actionHint) ?? fallback.actionHint,
    category,
    confidence,
    providerUsed,
    promote: category === "business_actionable" ? promote : false,
    reason: textValue(raw.reason) ?? fallback.reason,
    suggestedServiceType: textValue(raw.suggestedServiceType) ?? fallback.suggestedServiceType,
    summary: textValue(raw.summary) ?? fallback.summary,
  };
}

function heuristicClassify(message: InboundEmailMessage): EmailClassification {
  const text = `${message.subject}\n${message.fromEmail ?? ""}\n${message.bodyText}`.toLowerCase();
  const businessPattern = /\b(quote|estimate|pricing|price|book|booking|appointment|job|site visit|invoice|urgent|emergency|leak|blocked|repair|install|service|availability|reschedule|cancel|supplier|delivery|purchase order|po\b|work order)\b/i;
  const personalPattern = /\b(lol|haha|dinner|weekend|birthday|family|wife|husband|kids|holiday|meme|joke)\b/i;

  if (message.automated || /\b(unsubscribe|newsletter|promotion|sale|marketing|notification|digest)\b/i.test(text)) {
    return {
      actionHint: null,
      category: "newsletter_or_automated",
      confidence: 0.82,
      providerUsed: "heuristic",
      promote: false,
      reason: "Automated, newsletter, or marketing-style email.",
      suggestedServiceType: null,
      summary: truncate(message.snippet ?? message.subject, 180),
    };
  }

  if (businessPattern.test(text)) {
    return {
      actionHint: "Review as an inbound business email and prepare any useful next step.",
      category: "business_actionable",
      confidence: 0.68,
      providerUsed: "heuristic",
      promote: true,
      reason: "Contains business/action keywords such as quote, job, booking, invoice, or service terms.",
      suggestedServiceType: null,
      summary: truncate(message.bodyText || message.subject, 180),
    };
  }

  if (personalPattern.test(text)) {
    return {
      actionHint: null,
      category: "personal_ignore",
      confidence: 0.64,
      providerUsed: "heuristic",
      promote: false,
      reason: "Looks personal or conversational rather than business-actionable.",
      suggestedServiceType: null,
      summary: truncate(message.bodyText || message.subject, 180),
    };
  }

  return {
    actionHint: null,
    category: "business_reference",
    confidence: 0.5,
    providerUsed: "heuristic",
    promote: false,
    reason: "No strong action signal found; keeping it as reference awareness only.",
    suggestedServiceType: null,
    summary: truncate(message.bodyText || message.subject, 180),
  };
}

export function classificationForSenderRule(
  rule: InboundEmailSenderRule,
  message: Pick<InboundEmailMessage, "bodyText" | "fromEmail" | "snippet" | "subject">,
): EmailClassification {
  const target =
    rule.match === "domain" ? `domain ${rule.value}` : rule.value;

  if (rule.action === "always_promote") {
    return {
      actionHint: "Create or update CRM work from this email because the sender has been marked relevant.",
      category: "business_actionable",
      confidence: 1,
      providerUsed: "sender_rule",
      promote: true,
      reason: `Sender rule matched ${target}; user marked this sender as relevant.`,
      suggestedServiceType: null,
      summary: truncate(message.bodyText || message.snippet || message.subject, 180),
    };
  }

  return {
    actionHint: null,
    category: "personal_ignore",
    confidence: 1,
    providerUsed: "sender_rule",
    promote: false,
    reason: `Sender rule matched ${target}; user chose to ignore this sender.`,
    suggestedServiceType: null,
    summary: truncate(message.bodyText || message.snippet || message.subject, 180),
  };
}

function buildClassifierInput(message: InboundEmailMessage, settings: InboundEmailSettings) {
  return JSON.stringify(
    {
      task: "Classify whether this inbound email should become an actionable Kyro CRM conversation.",
      workspacePolicy: settings.actionInstructions,
      rules: [
        "Return JSON only.",
        "Promote only if Kyro should create or update a lead/conversation/action plan.",
        "Do not promote personal jokes, newsletters, automated notifications, spam, marketing, or FYI-only mail unless it clearly affects business work.",
        "If uncertain, choose business_reference or personal_possible_relevance instead of business_actionable.",
        "Do not invent customer details, service type, dates, addresses, or urgency.",
      ],
      outputContract: {
        actionHint: "string|null",
        category:
          "business_actionable|business_reference|personal_possible_relevance|personal_ignore|newsletter_or_automated|spam_or_noise",
        confidence: "number 0..1",
        promote: "boolean",
        reason: "string",
        suggestedServiceType: "string|null",
        summary: "string",
      },
      email: {
        bodyText: message.bodyText.slice(0, MAX_CLASSIFIER_BODY_CHARS),
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        provider: message.provider,
        receivedAt: message.receivedAt,
        snippet: message.snippet,
        subject: message.subject,
        toEmails: message.toEmails,
      },
    },
    null,
    2,
  );
}

async function recordClassifierUsage({
  aiRunId,
  inputTokens,
  model,
  outputTokens,
  supabase,
  user,
  workspaceId,
}: {
  aiRunId: string;
  inputTokens: number;
  model: string;
  outputTokens: number;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const inputPrice = priceUsage(inputTokens, INPUT_TOKEN_UNIT_COST);
  const outputPrice = priceUsage(outputTokens, OUTPUT_TOKEN_UNIT_COST);
  const usageEvents = [
    {
      workspace_id: workspaceId,
      user_id: user.id,
      source_type: "ai_run",
      source_id: aiRunId,
      ai_run_id: aiRunId,
      provider: "openai",
      service: "llm",
      model,
      usage_type: "llm_input_tokens",
      quantity: String(inputTokens),
      unit: "token",
      unit_price_snapshot: null,
      unit_cost_snapshot: String(inputPrice.unitCostSnapshot),
      markup_snapshot: String(inputPrice.markupSnapshot),
      currency: "USD",
      cost_snapshot: String(inputPrice.costSnapshot),
      customer_charge_snapshot: String(inputPrice.customerChargeSnapshot),
      metadata: {
        source: "inbound_email_classifier",
      },
    },
    {
      workspace_id: workspaceId,
      user_id: user.id,
      source_type: "ai_run",
      source_id: aiRunId,
      ai_run_id: aiRunId,
      provider: "openai",
      service: "llm",
      model,
      usage_type: "llm_output_tokens",
      quantity: String(outputTokens),
      unit: "token",
      unit_price_snapshot: null,
      unit_cost_snapshot: String(outputPrice.unitCostSnapshot),
      markup_snapshot: String(outputPrice.markupSnapshot),
      currency: "USD",
      cost_snapshot: String(outputPrice.costSnapshot),
      customer_charge_snapshot: String(outputPrice.customerChargeSnapshot),
      metadata: {
        source: "inbound_email_classifier",
      },
    },
  ];
  const { error } = await supabase.from("usage_events").insert(usageEvents);

  if (error) {
    throw new Error(`Unable to record classifier usage: ${error.message}`);
  }
}

async function classifyWithOpenAi({
  eventId,
  fallback,
  message,
  settings,
  supabase,
  user,
  workspaceId,
}: {
  eventId: string;
  fallback: EmailClassification;
  message: InboundEmailMessage;
  settings: InboundEmailSettings;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}): Promise<EmailClassification> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || message.automated) {
    return fallback;
  }

  const route = selectModelRoute({
    workspaceId,
    userId: user.id,
    taskType: "lead_extraction",
    riskLevel: "low",
    requiredCapabilities: ["classification"],
    latencyTargetMs: 1500,
    estimatedInputTokens: 900,
  });

  if (route.provider !== "openai") {
    return fallback;
  }

  const prompt = buildClassifierInput(message, settings);
  const model =
    process.env.OPENAI_INBOUND_EMAIL_CLASSIFIER_MODEL?.trim() ||
    process.env.OPENAI_LOW_COST_MODEL?.trim() ||
    route.model;
  const { data: aiRun, error: aiRunError } = await supabase
    .from("ai_runs")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      mode: "workflow",
      task_type: "inbound_email_classification",
      risk_level: "low",
      provider: "openai",
      model,
      status: "running",
      input_refs: {
        eventId,
        externalMessageId: message.externalMessageId,
        provider: message.provider,
        subject: message.subject,
      },
      output: {},
      tool_calls: [],
      usage: {},
      estimated_cost: "0.0001",
    })
    .select("id")
    .single();

  if (aiRunError || !aiRun) {
    return fallback;
  }

  const aiRunId = String(aiRun.id);

  await supabase.from("model_route_decisions").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    ai_run_id: aiRunId,
    task_type: "inbound_email_classification",
    risk_level: "low",
    selected_provider: "openai",
    selected_model: model,
    fallback_used: false,
    decision_reason: route.reason,
    budget_snapshot: {
      estimatedInputTokens: 900,
      source: "inbound_email_sync",
    },
  });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You are Kyro's inbound email classifier for a trades/service CRM. Return compact JSON matching the requested contract.",
        max_output_tokens: 420,
        model,
        text: {
          format: {
            name: "kyro_inbound_email_classification",
            schema: {
              additionalProperties: false,
              properties: {
                actionHint: { type: ["string", "null"] },
                category: {
                  enum: [
                    "business_actionable",
                    "business_reference",
                    "personal_possible_relevance",
                    "personal_ignore",
                    "newsletter_or_automated",
                    "spam_or_noise",
                  ],
                  type: "string",
                },
                confidence: { type: "number" },
                promote: { type: "boolean" },
                reason: { type: "string" },
                suggestedServiceType: { type: ["string", "null"] },
                summary: { type: "string" },
              },
              required: [
                "category",
                "promote",
                "confidence",
                "reason",
                "summary",
                "actionHint",
                "suggestedServiceType",
              ],
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

    const content = responseOutputText(payload);

    if (!content) {
      throw new Error("OpenAI returned an empty email classification response.");
    }

    const parsed = extractJsonObject(content);
    const usage = objectRecord(objectRecord(payload).usage);
    const inputTokens = numberValue(usage.input_tokens) ?? estimateTokens(prompt);
    const outputTokens = numberValue(usage.output_tokens) ?? estimateTokens(content);
    const classification = normalizeClassification(parsed, fallback, "openai");

    await recordClassifierUsage({
      aiRunId,
      inputTokens,
      model,
      outputTokens,
      supabase,
      user,
      workspaceId,
    });

    await supabase
      .from("ai_runs")
      .update({
        actual_cost: String(
          priceUsage(inputTokens, INPUT_TOKEN_UNIT_COST).costSnapshot +
            priceUsage(outputTokens, OUTPUT_TOKEN_UNIT_COST).costSnapshot,
        ),
        completed_at: new Date().toISOString(),
        output: classification,
        status: "completed",
        usage: {
          inputTokens,
          outputTokens,
        },
      })
      .eq("workspace_id", workspaceId)
      .eq("id", aiRunId);

    return classification;
  } catch (error) {
    await supabase
      .from("ai_runs")
      .update({
        completed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Email classification failed.",
        output: {
          fallback,
        },
        status: "failed",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", aiRunId);

    return {
      ...fallback,
      reason: `${fallback.reason} OpenAI classifier fallback: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

async function classifyEmail({
  eventId,
  message,
  settings,
  supabase,
  user,
  workspaceId,
}: {
  eventId: string;
  message: InboundEmailMessage;
  settings: InboundEmailSettings;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const fallback = heuristicClassify(message);

  return classifyWithOpenAi({
    eventId,
    fallback,
    message,
    settings,
    supabase,
    user,
    workspaceId,
  });
}

async function readApiError(response: Response) {
  const rawText = await response.text();

  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string } };

    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // Fall through to raw response text.
  }

  return rawText.slice(0, 500) || response.statusText;
}

async function updateConnectionStatus({
  connection,
  lastError,
  result,
  supabase,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  lastError: string | null;
  result?: Partial<InboundEmailSyncResult> | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const metadata = objectRecord(connection.metadata);
  const { error } = await supabase
    .from("integration_connections")
    .update({
      last_error: lastError,
      last_sync_at: lastError ? connection.last_sync_at : new Date().toISOString(),
      metadata: {
        ...metadata,
        inboundEmail: {
          lastCheckedAt: new Date().toISOString(),
          lastError,
          lastResult: result ?? null,
        },
      },
    })
    .eq("workspace_id", workspaceId)
    .eq("id", connection.id);

  if (error) {
    console.warn("Unable to update inbound email connection status", error.message);
  }
}

async function refreshGoogleAccessToken({
  connection,
  supabase,
  tokenSet,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  supabase: SupabaseClient;
  tokenSet: OAuthTokenSet;
  workspaceId: string;
}) {
  const config = getGoogleOAuthConfig();
  const refreshToken = textValue(tokenSet.refreshToken);

  if (!config || !refreshToken) {
    throw new Error("Google access expired. Reconnect Google in Settings.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${await readApiError(response)}`);
  }

  const refreshed = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
    token_type?: string;
  };
  const updatedTokenSet: OAuthTokenSet = {
    ...tokenSet,
    accessToken: refreshed.access_token ?? tokenSet.accessToken,
    expiresIn: refreshed.expires_in ?? tokenSet.expiresIn ?? null,
    idToken: refreshed.id_token ?? tokenSet.idToken ?? null,
    obtainedAt: new Date().toISOString(),
    refreshToken,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : tokenSet.scopes,
    tokenType: refreshed.token_type ?? tokenSet.tokenType ?? null,
  };
  const { error } = await supabase
    .from("integration_connections")
    .update({
      access_token_expires_at: tokenExpiresAt(updatedTokenSet),
      last_error: null,
      token_set: encryptIntegrationTokenSet(updatedTokenSet as Record<string, unknown>),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", connection.id);

  if (error) {
    throw new Error(`Unable to save refreshed Google access token: ${error.message}`);
  }

  return updatedTokenSet;
}

async function refreshMicrosoftAccessToken({
  connection,
  supabase,
  tokenSet,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  supabase: SupabaseClient;
  tokenSet: OAuthTokenSet;
  workspaceId: string;
}) {
  const config = getMicrosoftOAuthConfig();
  const refreshToken = textValue(tokenSet.refreshToken);

  if (!config || !refreshToken) {
    throw new Error("Microsoft access expired. Reconnect Outlook in Settings.");
  }

  const response = await fetch(config.tokenEndpoint, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Microsoft token refresh failed: ${await readApiError(response)}`);
  }

  const refreshed = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    id_token?: string;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  };
  const updatedTokenSet: OAuthTokenSet = {
    ...tokenSet,
    accessToken: refreshed.access_token ?? tokenSet.accessToken,
    expiresIn: refreshed.expires_in ?? tokenSet.expiresIn ?? null,
    idToken: refreshed.id_token ?? tokenSet.idToken ?? null,
    obtainedAt: new Date().toISOString(),
    refreshToken: refreshed.refresh_token ?? refreshToken,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : tokenSet.scopes,
    tokenType: refreshed.token_type ?? tokenSet.tokenType ?? null,
  };
  const { error } = await supabase
    .from("integration_connections")
    .update({
      access_token_expires_at: tokenExpiresAt(updatedTokenSet),
      last_error: null,
      token_set: encryptIntegrationTokenSet(updatedTokenSet as Record<string, unknown>),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", connection.id);

  if (error) {
    throw new Error(`Unable to save refreshed Microsoft access token: ${error.message}`);
  }

  return updatedTokenSet;
}

async function accessTokenForConnection({
  connection,
  supabase,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  let tokenSet = decryptIntegrationTokenSet<OAuthTokenSet>(
    connection.token_set as Parameters<typeof decryptIntegrationTokenSet>[0],
  );

  if (isExpiring(tokenSet)) {
    tokenSet = connection.provider === GOOGLE_PROVIDER
      ? await refreshGoogleAccessToken({ connection, supabase, tokenSet, workspaceId })
      : await refreshMicrosoftAccessToken({ connection, supabase, tokenSet, workspaceId });
  }

  const accessToken = textValue(tokenSet.accessToken);

  if (!accessToken) {
    throw new Error(`${providerLabel(providerFromConnection(connection) ?? "google")} access token is missing.`);
  }

  return accessToken;
}

type GmailHeader = { name?: string; value?: string };
type GmailPayload = {
  body?: { data?: string };
  headers?: GmailHeader[];
  mimeType?: string;
  parts?: GmailPayload[];
};
type GmailMessageResponse = {
  id?: string;
  internalDate?: string;
  payload?: GmailPayload;
  snippet?: string;
  threadId?: string;
};

function gmailHeaderMap(payload: GmailPayload | undefined) {
  const headers: Record<string, string> = {};

  for (const header of payload?.headers ?? []) {
    if (header.name && header.value) {
      headers[header.name.toLowerCase()] = header.value;
    }
  }

  return headers;
}

function decodeGmailBody(data: string | undefined) {
  if (!data) {
    return "";
  }

  return Buffer.from(data, "base64url").toString("utf8");
}

function collectGmailBodies(payload: GmailPayload | undefined, bodies = { html: [] as string[], text: [] as string[] }) {
  if (!payload) {
    return bodies;
  }

  const body = decodeGmailBody(payload.body?.data);

  if (body && payload.mimeType === "text/plain") {
    bodies.text.push(body);
  }

  if (body && payload.mimeType === "text/html") {
    bodies.html.push(body);
  }

  for (const part of payload.parts ?? []) {
    collectGmailBodies(part, bodies);
  }

  return bodies;
}

function automatedFromHeaders(headers: Record<string, string>, fromEmail: string | null, subject: string) {
  const autoSubmitted = headers["auto-submitted"]?.toLowerCase();
  const precedence = headers.precedence?.toLowerCase();
  const from = fromEmail?.toLowerCase() ?? "";

  return Boolean(
    (autoSubmitted && autoSubmitted !== "no") ||
      headers["list-unsubscribe"] ||
      ["bulk", "junk", "list"].includes(precedence ?? "") ||
      /\b(no-?reply|donotreply|notification|newsletter|mailer-daemon)\b/i.test(from) ||
      /\b(unsubscribe|newsletter|digest|notification)\b/i.test(subject),
  );
}

function gmailDetailToInboundMessage({
  connection,
  detail,
  itemId,
  itemThreadId,
}: {
  connection: ProviderConnectionRow;
  detail: GmailMessageResponse;
  itemId: string;
  itemThreadId?: string | null;
}) {
  const headers = gmailHeaderMap(detail.payload);
  const from = parseEmailAddress(headers.from ?? null);
  const subject = textValue(headers.subject) ?? "Inbound email";
  const bodies = collectGmailBodies(detail.payload);
  const bodyHtml = bodies.html.join("\n\n") || null;
  const bodyText = bodies.text.join("\n\n") || (bodyHtml ? stripHtml(bodyHtml) : detail.snippet ?? "");
  const receivedAt = detail.internalDate && Number.isFinite(Number(detail.internalDate))
    ? new Date(Number(detail.internalDate)).toISOString()
    : safeIsoDate(textValue(headers.date));

  return {
    accountEmail: connection.account_email,
    automated: automatedFromHeaders(headers, from.email, subject),
    bodyHtml,
    bodyText,
    connectionId: connection.id,
    externalMessageId: detail.id ?? itemId,
    externalThreadId: detail.threadId ?? itemThreadId ?? null,
    fromEmail: from.email,
    fromName: from.name,
    headers,
    provider: "google" as const,
    receivedAt,
    snippet: textValue(detail.snippet),
    subject,
    toEmails: (headers.to ?? "")
      .split(",")
      .map((value) => parseEmailAddress(value).email)
      .filter((value): value is string => Boolean(value)),
  } satisfies InboundEmailMessage;
}

async function fetchGmailMessageById({
  accessToken,
  connection,
  messageId,
}: {
  accessToken: string;
  connection: ProviderConnectionRow;
  messageId: string;
}) {
  const detailResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!detailResponse.ok) {
    return null;
  }

  const detail = (await detailResponse.json()) as GmailMessageResponse;

  return gmailDetailToInboundMessage({
    connection,
    detail,
    itemId: messageId,
  });
}

async function fetchGmailMessages({
  accessToken,
  connection,
  settings,
}: {
  accessToken: string;
  connection: ProviderConnectionRow;
  settings: InboundEmailSettings;
}): Promise<InboundEmailMessage[]> {
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", String(settings.maxMessagesPerSync));
  listUrl.searchParams.set(
    "q",
    `in:inbox newer_than:${settings.lookbackDays}d -in:sent -in:drafts -in:spam -in:trash`,
  );

  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!listResponse.ok) {
    throw new Error(`Gmail inbox fetch failed: ${await readApiError(listResponse)}`);
  }

  const listed = (await listResponse.json()) as { messages?: Array<{ id?: string; threadId?: string }> };
  const messages: InboundEmailMessage[] = [];

  for (const item of listed.messages ?? []) {
    if (!item.id) {
      continue;
    }

    const detailResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!detailResponse.ok) {
      throw new Error(`Gmail message fetch failed: ${await readApiError(detailResponse)}`);
    }

    const detail = (await detailResponse.json()) as GmailMessageResponse;
    messages.push(
      gmailDetailToInboundMessage({
        connection,
        detail,
        itemId: item.id,
        itemThreadId: item.threadId,
      }),
    );
  }

  return messages;
}

type OutlookMessage = {
  body?: {
    content?: string;
    contentType?: string;
  };
  bodyPreview?: string;
  conversationId?: string;
  from?: {
    emailAddress?: {
      address?: string;
      name?: string;
    };
  };
  id?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
  internetMessageId?: string;
  receivedDateTime?: string;
  subject?: string;
  toRecipients?: Array<{
    emailAddress?: {
      address?: string;
    };
  }>;
};

function outlookMessageToInboundMessage(
  message: OutlookMessage,
  connection: ProviderConnectionRow,
) {
  const headers = Object.fromEntries(
    (message.internetMessageHeaders ?? [])
      .filter((header) => header.name && header.value)
      .map((header) => [String(header.name).toLowerCase(), String(header.value)]),
  );
  const fromEmail = textValue(message.from?.emailAddress?.address)?.toLowerCase() ?? null;
  const fromName = textValue(message.from?.emailAddress?.name);
  const subject = textValue(message.subject) ?? "Inbound email";
  const htmlBody = textValue(message.body?.content);
  const bodyText = htmlBody
    ? stripHtml(htmlBody)
    : textValue(message.bodyPreview) ?? "";
  const receivedAt = textValue(message.receivedDateTime) ?? new Date().toISOString();

  return {
    accountEmail: connection.account_email,
    automated: automatedFromHeaders(headers, fromEmail, subject),
    bodyHtml: htmlBody,
    bodyText,
    connectionId: connection.id,
    externalMessageId: textValue(message.internetMessageId) ?? textValue(message.id) ?? crypto.randomUUID(),
    externalThreadId: textValue(message.conversationId),
    fromEmail,
    fromName,
    headers,
    provider: "microsoft" as const,
    receivedAt,
    snippet: textValue(message.bodyPreview),
    subject,
    toEmails: (message.toRecipients ?? [])
      .map((recipient) => textValue(recipient.emailAddress?.address)?.toLowerCase() ?? null)
      .filter((value): value is string => Boolean(value)),
  } satisfies InboundEmailMessage;
}

async function fetchOutlookMessageById({
  accessToken,
  connection,
  messageId,
}: {
  accessToken: string;
  connection: ProviderConnectionRow;
  messageId: string;
}) {
  if (messageId.startsWith("<")) {
    return null;
  }

  const url = new URL(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`,
  );
  url.searchParams.set(
    "$select",
    "id,conversationId,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime,internetMessageHeaders",
  );
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="html"',
    },
  });

  if (!response.ok) {
    return null;
  }

  return outlookMessageToInboundMessage((await response.json()) as OutlookMessage, connection);
}

async function fetchOutlookMessages({
  accessToken,
  connection,
  settings,
}: {
  accessToken: string;
  connection: ProviderConnectionRow;
  settings: InboundEmailSettings;
}): Promise<InboundEmailMessage[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
  url.searchParams.set("$top", String(settings.maxMessagesPerSync));
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set(
    "$select",
    "id,conversationId,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime,internetMessageHeaders",
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="html"',
    },
  });

  if (!response.ok) {
    throw new Error(`Outlook inbox fetch failed: ${await readApiError(response)}`);
  }

  const payload = (await response.json()) as { value?: OutlookMessage[] };
  const since = Date.now() - settings.lookbackDays * 24 * 60 * 60 * 1000;

  return (payload.value ?? [])
    .filter((message) => {
      const received = textValue(message.receivedDateTime);

      return !received || new Date(received).getTime() >= since;
    })
    .map((message) => outlookMessageToInboundMessage(message, connection));
}

async function findOrCreateEmailChannel({
  connection,
  message,
  supabase,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  message: InboundEmailMessage;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data: existing, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("integration_id", connection.id)
    .eq("type", "email")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to look up email channel: ${existingError.message}`);
  }

  if (existing) {
    return String(existing.id);
  }

  const label = providerLabel(message.provider);
  const { data: channel, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: workspaceId,
      integration_id: connection.id,
      type: "email",
      display_name: message.accountEmail ? `${label} - ${message.accountEmail}` : label,
      external_id: `${message.provider}:email:${message.accountEmail ?? connection.id}`,
      status: "active",
      settings: {
        connectionId: connection.id,
        externalSendEnabled: true,
        inboundSyncEnabled: true,
        provider: message.provider,
      },
    })
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(`Unable to create email channel: ${error?.message ?? "unknown error"}`);
  }

  return String(channel.id);
}

async function findOrCreateEmailContact({
  message,
  supabase,
  user,
  workspaceId,
}: {
  message: InboundEmailMessage;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const email = message.fromEmail;

  if (email) {
    const { data: existing, error: existingError } = await supabase
      .from("contacts")
      .select("id,name,email")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Unable to look up sender contact: ${existingError.message}`);
    }

    if (existing) {
      if (!textValue(existing.name) && message.fromName) {
        await supabase
          .from("contacts")
          .update({ name: message.fromName })
          .eq("workspace_id", workspaceId)
          .eq("id", existing.id);
      }

      return String(existing.id);
    }
  }

  const name = contactNameFromMessage(message);
  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      name,
      email,
      contact_type: "client",
      source: `${message.provider}_email_inbound`,
      tags: ["email_inbound", message.provider],
    })
    .select("id")
    .single();

  if (error || !contact) {
    throw new Error(`Unable to create email contact: ${error?.message ?? "unknown error"}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "system",
    actorId: user.id,
    action: "contact.created_from_email",
    entityType: "contact",
    entityId: String(contact.id),
    after: {
      email,
      name,
      provider: message.provider,
    },
  });

  return String(contact.id);
}

async function loadConversationByThread({
  channelId,
  externalThreadId,
  supabase,
  workspaceId,
}: {
  channelId: string;
  externalThreadId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  if (!externalThreadId) {
    return null;
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id,status,contact_id,lead_id")
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .eq("external_thread_id", externalThreadId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to look up email conversation: ${error.message}`);
  }

  return data;
}

async function buildThreadSummary(supabase: SupabaseClient, workspaceId: string, conversationId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("direction,subject,body_text")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to load email conversation thread: ${error.message}`);
  }

  return {
    count: data?.length ?? 0,
    summary: (data ?? [])
      .slice(-8)
      .map((item, index) => {
        const direction = String(item.direction);
        const body = truncate(
          textValue(item.body_text) ?? textValue(item.subject) ?? "No message body.",
          120,
        );

        return `${index + 1}. ${direction}: ${body}`;
      })
      .join("\n"),
  };
}

async function cancelStaleConversationActions({
  conversationId,
  messageId,
  supabase,
  user,
  workspaceId,
}: {
  conversationId: string;
  messageId: string;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const now = new Date().toISOString();
  const { data: cancelledActions, error } = await supabase
    .from("actions")
    .update({
      result: {
        cancelledAt: now,
        cancelledByMessageId: messageId,
        cancelledReason: "new_inbound_email",
      },
      status: "cancelled",
    })
    .eq("workspace_id", workspaceId)
    .eq("target_type", "conversation")
    .eq("target_id", conversationId)
    .in("type", [
      "draft_reply",
      "ask_missing_info",
      "book_site_visit",
      "create_quote_draft",
      "schedule_follow_up",
    ])
    .in("status", ["pending_approval", "approved"])
    .select("id,status");

  if (error) {
    throw new Error(`Unable to cancel stale proposed actions: ${error.message}`);
  }

  for (const action of cancelledActions ?? []) {
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      action: "action.cancelled_due_to_new_inbound_email",
      entityType: "action",
      entityId: String(action.id),
      after: {
        messageId,
        status: "cancelled",
      },
      metadata: {
        conversationId,
        requestedByUserId: user.id,
      },
    });
  }

  return cancelledActions?.length ?? 0;
}

async function promoteEmailMessage({
  classification,
  connection,
  eventId,
  message,
  supabase,
  user,
  workspaceId,
}: {
  classification: EmailClassification;
  connection: ProviderConnectionRow;
  eventId: string;
  message: InboundEmailMessage;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const channelId = await findOrCreateEmailChannel({ connection, message, supabase, workspaceId });
  const { data: existingMessage, error: existingMessageError } = await supabase
    .from("messages")
    .select("id,conversation_id")
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .eq("external_message_id", message.externalMessageId)
    .limit(1)
    .maybeSingle();

  if (existingMessageError) {
    throw new Error(`Unable to check existing email message: ${existingMessageError.message}`);
  }

  if (existingMessage) {
    return {
      conversationId: String(existingMessage.conversation_id),
      duplicate: true,
      messageId: String(existingMessage.id),
    };
  }

  const contactId = await findOrCreateEmailContact({ message, supabase, user, workspaceId });
  let conversation = await loadConversationByThread({
    channelId,
    externalThreadId: message.externalThreadId,
    supabase,
    workspaceId,
  });
  let leadId = conversation?.lead_id ? String(conversation.lead_id) : null;
  const leadTitle = classification.suggestedServiceType
    ? `${classification.suggestedServiceType} email from ${contactNameFromMessage(message)}`
    : message.subject;

  if (!conversation) {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        workspace_id: workspaceId,
        contact_id: contactId,
        description: message.bodyText || message.snippet || message.subject,
        next_step: "Review AI proposed reply",
        priority: /\b(urgent|emergency|asap|today|leak|burst|flood)\b/i.test(
          `${message.subject}\n${message.bodyText}`,
        )
          ? "high"
          : "normal",
        service_type: classification.suggestedServiceType,
        source: `${message.provider}_email_inbound`,
        status: "new",
        title: leadTitle || `Email from ${contactNameFromMessage(message)}`,
      })
      .select("id,title")
      .single();

    if (leadError || !lead) {
      throw new Error(`Unable to create email lead: ${leadError?.message ?? "unknown error"}`);
    }

    leadId = String(lead.id);

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      actorId: user.id,
      action: "lead.created_from_email",
      entityType: "lead",
      entityId: leadId,
      after: {
        classification,
        provider: message.provider,
        title: lead.title,
      },
    });

    const { data: createdConversation, error: conversationError } = await supabase
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        channel_id: channelId,
        contact_id: contactId,
        external_thread_id: message.externalThreadId,
        last_message_at: message.receivedAt,
        lead_id: leadId,
        status: "open",
      })
      .select("id,status,contact_id,lead_id")
      .single();

    if (conversationError || !createdConversation) {
      throw new Error(`Unable to create email conversation: ${conversationError?.message ?? "unknown error"}`);
    }

    conversation = createdConversation;
  }

  const conversationId = String(conversation.id);
  const { data: savedMessage, error: messageError } = await supabase
    .from("messages")
    .insert({
      workspace_id: workspaceId,
      body_html: message.bodyHtml,
      body_text: message.bodyText,
      channel_id: channelId,
      contact_id: conversation.contact_id ?? contactId,
      conversation_id: conversationId,
      direction: "inbound",
      external_message_id: message.externalMessageId,
      metadata: {
        accountEmail: message.accountEmail,
        classification,
        eventId,
        externalThreadId: message.externalThreadId,
        fromEmail: message.fromEmail,
        provider: message.provider,
        source: "email_inbound_sync",
      },
      received_at: message.receivedAt,
      subject: message.subject,
    })
    .select("id")
    .single();

  if (messageError || !savedMessage) {
    throw new Error(`Unable to create inbound email message: ${messageError?.message ?? "unknown error"}`);
  }

  const previousStatus = String(conversation.status ?? "open");
  const { error: updateConversationError } = await supabase
    .from("conversations")
    .update({
      last_message_at: message.receivedAt,
      status: "open",
    })
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId);

  if (updateConversationError) {
    throw new Error(`Unable to update email conversation: ${updateConversationError.message}`);
  }

  const cancelledActionCount = await cancelStaleConversationActions({
    conversationId,
    messageId: String(savedMessage.id),
    supabase,
    user,
    workspaceId,
  });

  if (leadId) {
    await supabase
      .from("leads")
      .update({
        next_step: "Review latest AI proposed reply",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", leadId);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "system",
    actorId: user.id,
    action:
      previousStatus === "resolved"
        ? "conversation.reopened_by_inbound_email"
        : "conversation.email_received",
    entityType: "conversation",
    entityId: conversationId,
    before: {
      status: previousStatus,
    },
    after: {
      messageId: String(savedMessage.id),
      status: "open",
    },
  });

  const thread = await buildThreadSummary(supabase, workspaceId, conversationId);
  const { data: leadProfile, error: leadProfileError } = leadId
    ? await supabase
        .from("leads")
        .select("title,service_type")
        .eq("workspace_id", workspaceId)
        .eq("id", leadId)
        .maybeSingle()
    : { data: null, error: null };
  const { data: contactProfile, error: contactProfileError } = await supabase
    .from("contacts")
    .select("address")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (leadProfileError) {
    throw new Error(`Unable to load email lead context: ${leadProfileError.message}`);
  }

  if (contactProfileError) {
    throw new Error(`Unable to load email contact context: ${contactProfileError.message}`);
  }

  const triageResult = await runStubAiTriage(supabase, user, workspaceId, {
    contactAddress: contactProfile?.address ? String(contactProfile.address) : null,
    contactId,
    conversationId,
    leadId: leadId ?? undefined,
    leadTitle: leadProfile?.title ? String(leadProfile.title) : leadTitle,
    messageId: String(savedMessage.id),
    serviceType: leadProfile?.service_type
      ? String(leadProfile.service_type)
      : classification.suggestedServiceType,
    source: "email_inbound_sync",
    sourceEventId: eventId,
    summary: `${providerLabel(message.provider)} email from ${contactNameFromMessage(message)}: ${classification.summary}`,
    threadMessageCount: thread.count,
    threadSummary: thread.summary,
  });

  return {
    actionId: triageResult.actionId,
    aiRunId: triageResult.aiRunId,
    cancelledActionCount,
    conversationId,
    duplicate: false,
    leadId,
    messageId: String(savedMessage.id),
  };
}

function skippedEventClassification(payload: Record<string, unknown>): EmailClassification {
  const classification = objectRecord(payload.classification);
  const summary =
    textValue(payload.summary) ??
    textValue(classification.summary) ??
    textValue(payload.subject) ??
    "Filtered-out email promoted by the user.";

  return {
    actionHint: "Review as manually promoted inbound email and prepare any useful next step.",
    category: "business_actionable",
    confidence: 1,
    providerUsed: "manual",
    promote: true,
    reason: "User manually promoted this filtered-out email into CRM work.",
    suggestedServiceType: textValue(classification.suggestedServiceType),
    summary,
  };
}

function fallbackMessageFromSkippedEvent({
  connection,
  eventId,
  payload,
  provider,
}: {
  connection: ProviderConnectionRow;
  eventId: string;
  payload: Record<string, unknown>;
  provider: InboundEmailProvider;
}): InboundEmailMessage {
  const classification = objectRecord(payload.classification);
  const subject = textValue(payload.subject) ?? "Promoted filtered-out email";
  const summary =
    textValue(payload.summary) ??
    textValue(classification.summary) ??
    textValue(classification.reason) ??
    subject;

  return {
    accountEmail: textValue(payload.accountEmail) ?? connection.account_email,
    automated: false,
    bodyHtml: null,
    bodyText: summary,
    connectionId: connection.id,
    externalMessageId: textValue(payload.externalMessageId) ?? `skipped-event-${eventId}`,
    externalThreadId: textValue(payload.externalThreadId),
    fromEmail: textValue(payload.fromEmail),
    fromName: null,
    headers: {},
    provider,
    receivedAt: textValue(payload.receivedAt) ?? new Date().toISOString(),
    snippet: summary,
    subject,
    toEmails: [],
  };
}

async function refetchSkippedEmailMessage({
  connection,
  payload,
  provider,
  supabase,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  payload: Record<string, unknown>;
  provider: InboundEmailProvider;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const externalMessageId = textValue(payload.externalMessageId);

  if (!externalMessageId) {
    return null;
  }

  try {
    const accessToken = await accessTokenForConnection({ connection, supabase, workspaceId });

    return provider === "google"
      ? await fetchGmailMessageById({
          accessToken,
          connection,
          messageId: externalMessageId,
        })
      : await fetchOutlookMessageById({
          accessToken,
          connection,
          messageId: externalMessageId,
        });
  } catch {
    return null;
  }
}

export async function promoteSkippedEmailEvent({
  eventId,
  supabase,
  user,
  workspaceId,
}: {
  eventId: string;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,payload")
    .eq("workspace_id", workspaceId)
    .eq("id", eventId)
    .eq("type", "inbound.email.received")
    .eq("status", "processed")
    .maybeSingle();

  if (eventError) {
    throw new Error(`Unable to load filtered-out email: ${eventError.message}`);
  }

  if (!event) {
    throw new Error("Filtered-out email was not found.");
  }

  const payload = objectRecord(event.payload);

  if (textValue(payload.stage) !== "observed") {
    throw new Error("Only filtered-out emails can be promoted into work items.");
  }

  const provider = textValue(payload.provider) === "microsoft" ? "microsoft" : "google";
  const connections = await loadEmailConnections({ provider, supabase, workspaceId });
  const accountEmail = textValue(payload.accountEmail);
  const connection =
    connections.find(
      (candidate) =>
        !accountEmail ||
        candidate.account_email?.toLowerCase() === accountEmail.toLowerCase(),
    ) ?? connections[0];

  if (!connection) {
    throw new Error(`Reconnect ${providerLabel(provider)} before promoting this email.`);
  }

  const classification = skippedEventClassification(payload);
  const refetchedMessage = await refetchSkippedEmailMessage({
    connection,
    payload,
    provider,
    supabase,
    workspaceId,
  });
  const message =
    refetchedMessage ??
    fallbackMessageFromSkippedEvent({
      connection,
      eventId,
      payload,
      provider,
    });
  const promoted = await promoteEmailMessage({
    classification,
    connection,
    eventId,
    message,
    supabase,
    user,
    workspaceId,
  });

  const { error: updateEventError } = await supabase
    .from("events")
    .update({
      payload: {
        ...payload,
        classification,
        contactEmail: message.fromEmail,
        conversationId: promoted.conversationId,
        leadId: promoted.leadId ?? null,
        messageId: promoted.messageId,
        promotedFromSkippedEmail: true,
        refetchedOriginalMessage: Boolean(refetchedMessage),
        stage: "promoted",
        triageActionId: promoted.actionId ?? null,
        triageAiRunId: promoted.aiRunId ?? null,
      },
      processed_at: new Date().toISOString(),
      status: "processed",
    })
    .eq("workspace_id", workspaceId)
    .eq("id", eventId);

  if (updateEventError) {
    throw new Error(`Unable to update promoted email event: ${updateEventError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "filtered_email.promoted_to_work_item",
    entityType: "event",
    entityId: eventId,
    after: {
      conversationId: promoted.conversationId,
      duplicate: promoted.duplicate,
      refetchedOriginalMessage: Boolean(refetchedMessage),
    },
  });

  return promoted;
}

async function processMessage({
  connection,
  message,
  result,
  settings,
  supabase,
  user,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  message: InboundEmailMessage;
  result: InboundEmailSyncResult;
  settings: InboundEmailSettings;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const idempotencyKey = `email.inbound.${message.provider}.${connection.id}.${message.externalMessageId}`;
  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: {
        accountEmail: message.accountEmail,
        externalMessageId: message.externalMessageId,
        externalThreadId: message.externalThreadId,
        fromEmail: message.fromEmail,
        provider: message.provider,
        receivedAt: message.receivedAt,
        stage: "received",
        subject: message.subject,
      },
      source: `${message.provider}.email`,
      status: "processing",
      type: "inbound.email.received",
    })
    .select("id,type,status")
    .single();

  if (eventError || !event) {
    if (eventError?.code === "23505") {
      result.duplicates += 1;
      return;
    }

    throw new Error(`Unable to record inbound email event: ${eventError?.message ?? "unknown error"}`);
  }

  try {
    const senderRule = findInboundEmailSenderRule(settings.senderRules, message.fromEmail);
    const classification = senderRule
      ? classificationForSenderRule(senderRule, message)
      : await classifyEmail({
          eventId: String(event.id),
          message,
          settings,
          supabase,
          user,
          workspaceId,
        });
    const shouldPromote = settings.autoPromoteActionable && classification.promote;

    if (!shouldPromote) {
      await supabase
        .from("events")
        .update({
          payload: {
            accountEmail: message.accountEmail,
            classification,
            externalMessageId: message.externalMessageId,
            externalThreadId: message.externalThreadId,
            fromEmail: message.fromEmail,
            provider: message.provider,
            receivedAt: message.receivedAt,
            stage: "observed",
            subject: message.subject,
            summary: settings.includeAwarenessEvents ? safeSummaryText(message) : null,
          },
          processed_at: new Date().toISOString(),
          status: "processed",
        })
        .eq("workspace_id", workspaceId)
        .eq("id", event.id);
      result.observedMessages += 1;
      return;
    }

    const promoted = await promoteEmailMessage({
      classification,
      connection,
      eventId: String(event.id),
      message,
      supabase,
      user,
      workspaceId,
    });

    await supabase
      .from("events")
      .update({
        payload: {
          accountEmail: message.accountEmail,
          classification,
          contactEmail: message.fromEmail,
          conversationId: promoted.conversationId,
          externalMessageId: message.externalMessageId,
          externalThreadId: message.externalThreadId,
          leadId: promoted.leadId,
          messageId: promoted.messageId,
          provider: message.provider,
          receivedAt: message.receivedAt,
          stage: "promoted",
          subject: message.subject,
          summary: safeSummaryText(message),
          triageActionId: promoted.actionId,
          triageAiRunId: promoted.aiRunId,
        },
        processed_at: new Date().toISOString(),
        status: "processed",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", event.id);

    if (promoted.duplicate) {
      result.duplicates += 1;
      return;
    }

    result.promotedMessages += 1;
    result.promotedConversations.push({
      conversationId: promoted.conversationId,
      provider: message.provider,
      subject: message.subject,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Inbound email processing failed.";

    await supabase
      .from("events")
      .update({
        payload: {
          accountEmail: message.accountEmail,
          error: messageText,
          externalMessageId: message.externalMessageId,
          provider: message.provider,
          stage: "failed",
          subject: message.subject,
        },
        processed_at: new Date().toISOString(),
        status: "failed",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", event.id);

    throw error;
  }
}

async function loadEmailConnections({
  provider,
  supabase,
  workspaceId,
}: {
  provider?: InboundEmailProvider;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  let query = supabase
    .from("integration_connections")
    .select("id,provider,service,account_email,scopes,token_set,last_sync_at,metadata")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .in("provider", [GOOGLE_PROVIDER, MICROSOFT_PROVIDER])
    .order("last_connected_at", { ascending: false });

  if (provider === "google") {
    query = query.eq("provider", GOOGLE_PROVIDER).eq("service", GOOGLE_SERVICE);
  }

  if (provider === "microsoft") {
    query = query.eq("provider", MICROSOFT_PROVIDER).eq("service", MICROSOFT_SERVICE);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load email integrations: ${error.message}`);
  }

  return (data ?? []) as ProviderConnectionRow[];
}

async function syncConnection({
  connection,
  result,
  settings,
  supabase,
  trigger,
  user,
  workspaceId,
}: {
  connection: ProviderConnectionRow;
  result: InboundEmailSyncResult;
  settings: InboundEmailSettings;
  supabase: SupabaseClient;
  trigger: InboundEmailSyncTrigger;
  user: User;
  workspaceId: string;
}) {
  const provider = providerFromConnection(connection);

  if (!provider) {
    return;
  }

  result.checkedConnections += 1;

  if (
    trigger === "scheduled" &&
    !shouldRunInboundEmailSync({
      lastSyncAt: connection.last_sync_at,
      settings,
    })
  ) {
    result.skippedBySchedule += 1;
    return;
  }

  const scopes = normalizeScopes(connection.scopes);
  const missingScope = provider === "google"
    ? scopes.includes(GOOGLE_GMAIL_READ_SCOPE)
      ? null
      : GOOGLE_GMAIL_READ_SCOPE
    : hasMicrosoftScope(scopes, MICROSOFT_MAIL_READ_SCOPE)
      ? null
      : MICROSOFT_MAIL_READ_SCOPE;

  if (missingScope) {
    result.needsReconnect.push({
      accountEmail: connection.account_email,
      missingScope,
      provider,
    });
    await updateConnectionStatus({
      connection,
      lastError: `Reconnect ${providerLabel(provider)} to grant inbound email read access (${missingScope}).`,
      supabase,
      workspaceId,
    });
    return;
  }

  try {
    const accessToken = await accessTokenForConnection({ connection, supabase, workspaceId });
    const messages = provider === "google"
      ? await fetchGmailMessages({ accessToken, connection, settings })
      : await fetchOutlookMessages({ accessToken, connection, settings });

    result.fetchedMessages += messages.length;

    for (const message of messages) {
      try {
        await processMessage({
          connection,
          message,
          result,
          settings,
          supabase,
          user,
          workspaceId,
        });
      } catch (error) {
        result.errors.push({
          accountEmail: connection.account_email,
          message: error instanceof Error ? error.message : "Inbound email message processing failed.",
          provider,
        });
      }
    }

    await updateConnectionStatus({
      connection,
      lastError: null,
      result: {
        duplicates: result.duplicates,
        fetchedMessages: messages.length,
        observedMessages: result.observedMessages,
        promotedMessages: result.promotedMessages,
        trigger,
      },
      supabase,
      workspaceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inbound email sync failed.";

    if (isRecoverableTokenAccessError(message)) {
      result.needsReconnect.push({
        accountEmail: connection.account_email,
        missingScope: "stored OAuth token refresh",
        provider,
      });
      await updateConnectionStatus({
        connection,
        lastError: TOKEN_DECRYPT_RECONNECT_MESSAGE,
        supabase,
        workspaceId,
      });
      return;
    }

    result.errors.push({
      accountEmail: connection.account_email,
      message,
      provider,
    });
    await updateConnectionStatus({
      connection,
      lastError: message,
      supabase,
      workspaceId,
    });
  }
}

export async function syncInboundEmail({
  provider,
  supabase,
  trigger,
  user,
  workspaceId,
}: {
  provider?: InboundEmailProvider;
  supabase: SupabaseClient;
  trigger: InboundEmailSyncTrigger;
  user: User;
  workspaceId: string;
}): Promise<InboundEmailSyncResult> {
  const settings = await getInboundEmailSettings(supabase, workspaceId);
  const result: InboundEmailSyncResult = {
    checkedConnections: 0,
    duplicates: 0,
    errors: [],
    fetchedMessages: 0,
    needsReconnect: [],
    observedMessages: 0,
    promotedConversations: [],
    promotedMessages: 0,
    skippedBySchedule: 0,
    trigger,
  };
  const connections = await loadEmailConnections({ provider, supabase, workspaceId });

  for (const connection of connections) {
    await syncConnection({
      connection,
      result,
      settings,
      supabase,
      trigger,
      user,
      workspaceId,
    });
  }

  if (
    trigger !== "scheduled" ||
    result.fetchedMessages > 0 ||
    result.errors.length > 0 ||
    result.needsReconnect.length > 0 ||
    result.promotedMessages > 0 ||
    result.observedMessages > 0
  ) {
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: trigger === "assistant" ? "ai" : trigger === "manual" ? "user" : "system",
      actorId: user.id,
      action: "inbound.email_sync.completed",
      entityType: "workspace",
      entityId: workspaceId,
      after: {
        checkedConnections: result.checkedConnections,
        duplicates: result.duplicates,
        errors: result.errors.length,
        fetchedMessages: result.fetchedMessages,
        needsReconnect: result.needsReconnect.length,
        observedMessages: result.observedMessages,
        promotedMessages: result.promotedMessages,
        skippedBySchedule: result.skippedBySchedule,
        trigger,
      },
    });
  }

  return result;
}
