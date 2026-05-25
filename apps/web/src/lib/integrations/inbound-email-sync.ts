import { selectModelRoute } from "@kyro/ai";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { runStubAiTriage } from "../ai/triage";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  buildLlmUsageEvents,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  toUsageEventRows,
  usageEventTotals,
  type OpenAiTokenUsage,
} from "../usage/openai";
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
import { createServiceSupabaseClient } from "../supabase/service";
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
  attachments: InboundEmailAttachment[];
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
  providerMessageId: string | null;
  receivedAt: string;
  snippet: string | null;
  subject: string;
  toEmails: string[];
};

type InboundEmailAttachment = {
  attachmentId: string | null;
  contentBase64?: string | null;
  contentType: string | null;
  filename: string;
  isInline?: boolean;
  partId?: string | null;
  provider: InboundEmailProvider;
  sizeBytes: number | null;
};

type StoredInboundEmailAttachment = {
  contentType: string | null;
  fileId: string | null;
  filename: string;
  provider: InboundEmailProvider;
  sizeBytes: number | null;
  source: "inbound_email";
  storageBucket: string | null;
  storagePath: string | null;
  storageStatus: "failed" | "metadata_only" | "stored";
  error?: string;
};

export type EmailClassificationCategory =
  | "business_actionable"
  | "business_reference"
  | "newsletter_or_automated"
  | "personal_ignore"
  | "personal_possible_relevance"
  | "spam_or_noise";

export type EmailClassification = {
  actionHint: string | null;
  category: EmailClassificationCategory;
  confidence: number;
  providerUsed: "heuristic" | "manual" | "openai" | "sender_rule";
  promote: boolean;
  reason: string;
  suggestedServiceType: string | null;
  summary: string;
};

export type InboundEmailClassificationInput = Pick<
  InboundEmailMessage,
  "automated" | "bodyText" | "fromEmail" | "snippet" | "subject"
>;

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
const MAX_CLASSIFIER_BODY_CHARS = 4000;
const MAX_INBOUND_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const INBOUND_ATTACHMENT_BUCKET =
  process.env.KYRO_FILE_STORAGE_BUCKET?.trim() || "kyro-files";
const ensuredAttachmentBuckets = new Set<string>();
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

export function normalizeEmailMessageId(value: unknown) {
  const text = textValue(value);

  if (!text) {
    return null;
  }

  return text.replace(/[<>]/g, "").trim().toLowerCase() || null;
}

export function inboundEmailReferenceIds(headers: Record<string, string>) {
  const values = [
    headers["in-reply-to"],
    headers.references,
    headers["thread-index"],
  ].filter(Boolean);
  const ids = new Set<string>();

  for (const value of values) {
    for (const match of String(value).matchAll(/<([^>]+)>|([^\s,;]+)/g)) {
      const normalized = normalizeEmailMessageId(match[1] ?? match[2]);

      if (normalized) {
        ids.add(normalized);
      }
    }
  }

  return [...ids];
}

export function normalizeEmailSubject(value: unknown) {
  const subject = textValue(value);

  if (!subject) {
    return null;
  }

  const normalized = subject
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return normalized || null;
}

function normalizeScopes(value: unknown) {
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
    : [];
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

export function inboundEmailIdempotencyKey({
  connectionId,
  externalMessageId,
  provider,
}: Pick<InboundEmailMessage, "connectionId" | "externalMessageId" | "provider">) {
  return `email.inbound.${provider}.${connectionId}.${externalMessageId}`;
}

function safeStorageSegment(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96) || "attachment";
}

export function summarizeInboundEmailAttachments(
  attachments: InboundEmailAttachment[],
): StoredInboundEmailAttachment[] {
  return attachments.map((attachment) => ({
    contentType: attachment.contentType,
    fileId: null,
    filename: attachment.filename,
    provider: attachment.provider,
    sizeBytes: attachment.sizeBytes,
    source: "inbound_email",
    storageBucket: null,
    storagePath: null,
    storageStatus: "metadata_only",
  }));
}

function inboundEmailThreadMetadata(message: InboundEmailMessage) {
  return {
    headerMessageId: normalizeEmailMessageId(
      message.headers["message-id"] ?? message.externalMessageId,
    ),
    inReplyTo: normalizeEmailMessageId(message.headers["in-reply-to"]),
    normalizedSubject: normalizeEmailSubject(message.subject),
    providerMessageId: message.providerMessageId,
    references: inboundEmailReferenceIds(message.headers),
  };
}

function inboundEmailEventMetadata(message: InboundEmailMessage) {
  return {
    attachmentCount: message.attachments.length,
    attachments: summarizeInboundEmailAttachments(message.attachments),
    externalMessageId: message.externalMessageId,
    externalThreadId: message.externalThreadId,
    providerMessageId: message.providerMessageId,
    thread: inboundEmailThreadMetadata(message),
  };
}

async function ensureInboundAttachmentBucket(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  bucket: string,
) {
  if (ensuredAttachmentBuckets.has(bucket)) {
    return;
  }

  const { error } = await serviceSupabase.storage.getBucket(bucket);

  if (!error) {
    ensuredAttachmentBuckets.add(bucket);
    return;
  }

  const { error: createError } = await serviceSupabase.storage.createBucket(bucket, {
    public: false,
  });

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(createError.message);
  }

  ensuredAttachmentBuckets.add(bucket);
}

async function persistInboundEmailAttachments({
  attachments,
  messageId,
  workspaceId,
}: {
  attachments: InboundEmailAttachment[];
  messageId: string;
  workspaceId: string;
}): Promise<StoredInboundEmailAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }

  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;

  try {
    serviceSupabase = createServiceSupabaseClient();
    await ensureInboundAttachmentBucket(serviceSupabase, INBOUND_ATTACHMENT_BUCKET);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage unavailable.";

    return summarizeInboundEmailAttachments(attachments).map((attachment) => ({
      ...attachment,
      error: message,
      storageStatus: "failed",
    }));
  }

  const stored: StoredInboundEmailAttachment[] = [];

  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.contentBase64) {
      stored.push({
        ...summarizeInboundEmailAttachments([attachment])[0],
        storageStatus: "metadata_only",
      });
      continue;
    }

    const filename = safeStorageSegment(attachment.filename);
    const storagePath = `${workspaceId}/inbound-email/${messageId}/${index + 1}-${filename}`;

    try {
      const buffer = Buffer.from(attachment.contentBase64, "base64");

      if (buffer.byteLength > MAX_INBOUND_ATTACHMENT_BYTES) {
        stored.push({
          ...summarizeInboundEmailAttachments([attachment])[0],
          error: "Attachment exceeds current inbound storage limit.",
          storageStatus: "metadata_only",
        });
        continue;
      }

      const contentType = attachment.contentType ?? "application/octet-stream";
      const { error: uploadError } = await serviceSupabase.storage
        .from(INBOUND_ATTACHMENT_BUCKET)
        .upload(storagePath, buffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: file, error: fileError } = await serviceSupabase
        .from("files")
        .insert({
          workspace_id: workspaceId,
          storage_bucket: INBOUND_ATTACHMENT_BUCKET,
          storage_path: storagePath,
          filename: attachment.filename,
          content_type: attachment.contentType,
          size_bytes: attachment.sizeBytes ?? buffer.byteLength,
          source: "inbound_email",
        })
        .select("id,storage_bucket,storage_path,filename,content_type,size_bytes")
        .single();

      if (fileError || !file) {
        throw new Error(fileError?.message ?? "File metadata insert failed.");
      }

      stored.push({
        contentType: textValue(file.content_type),
        fileId: String(file.id),
        filename: String(file.filename),
        provider: attachment.provider,
        sizeBytes: numberValue(file.size_bytes),
        source: "inbound_email",
        storageBucket: String(file.storage_bucket),
        storagePath: String(file.storage_path),
        storageStatus: "stored",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Attachment upload failed.";

      stored.push({
        ...summarizeInboundEmailAttachments([attachment])[0],
        error: message,
        storageStatus: "failed",
      });
    }
  }

  return stored;
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

export function classifyInboundEmailHeuristically(
  message: InboundEmailClassificationInput,
): EmailClassification {
  const text = `${message.subject}\n${message.fromEmail ?? ""}\n${message.bodyText}`.toLowerCase();
  const businessPattern = /\b(quote|estimate|pricing|price|book|booking|appointment|job|site visit|invoice|urgent|emergency|leak|blocked|blockage|backup|backed up|repair|install|service|availability|reschedule|cancel|supplier|delivery|purchase order|po\b|work order|renovat(?:e|ing|ion)|bathroom|shower|toilet|tap|pipe|drain|sewer|sewerage|come out|come and (?:quote|look|inspect|check))\b/i;
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
  model,
  providerUsageId,
  supabase,
  tokenUsage,
  user,
  workspaceId,
}: {
  aiRunId: string;
  model: string;
  providerUsageId: string | null;
  supabase: SupabaseClient;
  tokenUsage: OpenAiTokenUsage;
  user: User;
  workspaceId: string;
}) {
  const usageEvents = buildLlmUsageEvents({
    context: {
      aiRunId,
      metadata: { source: "inbound_email_classifier" },
      providerUsageId,
      sourceId: aiRunId,
      sourceType: "ai_run",
      userId: user.id,
      workspaceId,
    },
    model,
    provider: "openai",
    service: "llm",
    usage: tokenUsage,
  });
  const { error } = await supabase
    .from("usage_events")
    .insert(toUsageEventRows(usageEvents));

  if (error) {
    throw new Error(`Unable to record classifier usage: ${error.message}`);
  }

  return usageEventTotals(usageEvents);
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
    const tokenUsage = openAiUsageFromResponse(payload, { prompt, text: content });
    const classification = normalizeClassification(parsed, fallback, "openai");

    const usageTotals = await recordClassifierUsage({
      aiRunId,
      model,
      providerUsageId: openAiProviderUsageId(payload),
      supabase,
      tokenUsage,
      user,
      workspaceId,
    });

    await supabase
      .from("ai_runs")
      .update({
        actual_cost: String(usageTotals.costSnapshot),
        completed_at: new Date().toISOString(),
        output: classification,
        status: "completed",
        usage: {
          cachedInputTokens: tokenUsage.cachedInputTokens,
          customerCharge: usageTotals.customerChargeSnapshot,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          reasoningTokens: tokenUsage.reasoningTokens,
          totalTokens: tokenUsage.totalTokens,
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
  const fallback = classifyInboundEmailHeuristically(message);

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
  body?: { attachmentId?: string; data?: string; size?: number };
  filename?: string;
  headers?: GmailHeader[];
  mimeType?: string;
  partId?: string;
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

function collectGmailAttachments(
  payload: GmailPayload | undefined,
  attachments: InboundEmailAttachment[] = [],
) {
  if (!payload) {
    return attachments;
  }

  const filename = textValue(payload.filename);
  const attachmentId = textValue(payload.body?.attachmentId);
  const inlineData = textValue(payload.body?.data);

  if (filename && (attachmentId || inlineData)) {
    attachments.push({
      attachmentId,
      contentBase64: inlineData
        ? Buffer.from(inlineData, "base64url").toString("base64")
        : null,
      contentType: textValue(payload.mimeType),
      filename,
      isInline: false,
      partId: textValue(payload.partId),
      provider: "google",
      sizeBytes: numberValue(payload.body?.size),
    });
  }

  for (const part of payload.parts ?? []) {
    collectGmailAttachments(part, attachments);
  }

  return attachments;
}

async function fetchGmailAttachmentContent({
  accessToken,
  attachmentId,
  messageId,
}: {
  accessToken: string;
  attachmentId: string;
  messageId: string;
}) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
      messageId,
    )}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { data?: string; size?: number };
  const data = textValue(payload.data);

  return data ? Buffer.from(data, "base64url").toString("base64") : null;
}

async function hydrateGmailAttachments({
  accessToken,
  message,
}: {
  accessToken: string;
  message: InboundEmailMessage;
}) {
  if (!message.providerMessageId || message.attachments.length === 0) {
    return message;
  }

  const attachments = await Promise.all(
    message.attachments.map(async (attachment) => {
      if (attachment.contentBase64 || !attachment.attachmentId) {
        return attachment;
      }

      if (
        typeof attachment.sizeBytes === "number" &&
        attachment.sizeBytes > MAX_INBOUND_ATTACHMENT_BYTES
      ) {
        return attachment;
      }

      return {
        ...attachment,
        contentBase64: await fetchGmailAttachmentContent({
          accessToken,
          attachmentId: attachment.attachmentId,
          messageId: message.providerMessageId ?? message.externalMessageId,
        }),
      };
    }),
  );

  return {
    ...message,
    attachments,
  };
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
    attachments: collectGmailAttachments(detail.payload),
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
    providerMessageId: detail.id ?? itemId,
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

  return hydrateGmailAttachments({
    accessToken,
    message: gmailDetailToInboundMessage({
      connection,
      detail,
      itemId: messageId,
    }),
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
    const inboundMessage = gmailDetailToInboundMessage({
        connection,
        detail,
        itemId: item.id,
        itemThreadId: item.threadId,
      });

    messages.push(
      await hydrateGmailAttachments({
        accessToken,
        message: inboundMessage,
      }),
    );
  }

  return messages;
}

type OutlookMessage = {
  attachments?: Array<{
    contentBytes?: string;
    contentType?: string;
    id?: string;
    isInline?: boolean;
    name?: string;
    size?: number;
  }>;
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
  const attachments: InboundEmailAttachment[] = [];

  for (const attachment of message.attachments ?? []) {
    const filename = textValue(attachment.name);

    if (!filename) {
      continue;
    }

    attachments.push({
      attachmentId: textValue(attachment.id),
      contentBase64: textValue(attachment.contentBytes),
      contentType: textValue(attachment.contentType),
      filename,
      isInline: Boolean(attachment.isInline),
      provider: "microsoft",
      sizeBytes: numberValue(attachment.size),
    });
  }

  return {
    accountEmail: connection.account_email,
    attachments,
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
    providerMessageId: textValue(message.id),
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
  url.searchParams.set(
    "$expand",
    "attachments($select=id,name,contentType,size,isInline,contentBytes)",
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
  url.searchParams.set(
    "$expand",
    "attachments($select=id,name,contentType,size,isInline,contentBytes)",
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
    .select("id,status,contact_id,lead_id,external_thread_id")
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

async function loadConversationById({
  conversationId,
  supabase,
  workspaceId,
}: {
  conversationId: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id,status,contact_id,lead_id,external_thread_id")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to look up matched email conversation: ${error.message}`);
  }

  return data;
}

async function loadConversationByMessageReferences({
  channelId,
  message,
  supabase,
  workspaceId,
}: {
  channelId: string;
  message: InboundEmailMessage;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const thread = inboundEmailThreadMetadata(message);
  const referenceIds = new Set([
    ...thread.references,
    thread.inReplyTo,
  ].filter((value): value is string => Boolean(value)));

  if (referenceIds.size === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("conversation_id,metadata")
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Unable to inspect email message references: ${error.message}`);
  }

  for (const row of data ?? []) {
    const metadata = objectRecord(row.metadata);
    const metadataThread = objectRecord(metadata.thread);
    const headerMessageId =
      normalizeEmailMessageId(metadataThread.headerMessageId) ??
      normalizeEmailMessageId(metadata.headerMessageId);

    if (!headerMessageId || !referenceIds.has(headerMessageId)) {
      continue;
    }

    const conversationId = textValue(row.conversation_id);

    return conversationId
      ? loadConversationById({ conversationId, supabase, workspaceId })
      : null;
  }

  return null;
}

async function loadConversationBySubjectAndContact({
  channelId,
  contactId,
  message,
  supabase,
  workspaceId,
}: {
  channelId: string;
  contactId: string;
  message: InboundEmailMessage;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const normalizedSubject = normalizeEmailSubject(message.subject);

  if (!normalizedSubject || normalizedSubject.length < 5) {
    return null;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("conversation_id,metadata,subject")
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) {
    throw new Error(`Unable to inspect email subject matches: ${error.message}`);
  }

  for (const row of data ?? []) {
    const metadata = objectRecord(row.metadata);
    const metadataThread = objectRecord(metadata.thread);
    const storedSubject =
      normalizeEmailSubject(metadataThread.normalizedSubject) ??
      normalizeEmailSubject(row.subject);

    if (storedSubject !== normalizedSubject) {
      continue;
    }

    const conversationId = textValue(row.conversation_id);

    return conversationId
      ? loadConversationById({ conversationId, supabase, workspaceId })
      : null;
  }

  return null;
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
      threadMatchStrategy: "duplicate",
    };
  }

  const contactId = await findOrCreateEmailContact({ message, supabase, user, workspaceId });
  let conversation = await loadConversationByThread({
    channelId,
    externalThreadId: message.externalThreadId,
    supabase,
    workspaceId,
  });
  let threadMatchStrategy = conversation ? "provider_thread" : "new_conversation";

  if (!conversation) {
    conversation = await loadConversationByMessageReferences({
      channelId,
      message,
      supabase,
      workspaceId,
    });
    threadMatchStrategy = conversation ? "message_reference" : threadMatchStrategy;
  }

  if (!conversation) {
    conversation = await loadConversationBySubjectAndContact({
      channelId,
      contactId,
      message,
      supabase,
      workspaceId,
    });
    threadMatchStrategy = conversation ? "contact_subject" : threadMatchStrategy;
  }

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
      .select("id,status,contact_id,lead_id,external_thread_id")
      .single();

    if (conversationError || !createdConversation) {
      throw new Error(`Unable to create email conversation: ${conversationError?.message ?? "unknown error"}`);
    }

    conversation = createdConversation;
    threadMatchStrategy = "new_conversation";
  }

  const conversationId = String(conversation.id);
  const baseMessageMetadata = {
    accountEmail: message.accountEmail,
    classification,
    eventId,
    fromEmail: message.fromEmail,
    provider: message.provider,
    source: "email_inbound_sync",
    threadMatchStrategy,
    ...inboundEmailEventMetadata(message),
  };
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
      metadata: baseMessageMetadata,
      received_at: message.receivedAt,
      subject: message.subject,
    })
    .select("id")
    .single();

  if (messageError || !savedMessage) {
    throw new Error(`Unable to create inbound email message: ${messageError?.message ?? "unknown error"}`);
  }

  const storedAttachments = await persistInboundEmailAttachments({
    attachments: message.attachments,
    messageId: String(savedMessage.id),
    workspaceId,
  });
  const messageMetadata = {
    ...baseMessageMetadata,
    attachmentCount: storedAttachments.length,
    attachments: storedAttachments,
  };

  if (storedAttachments.length > 0) {
    const { error: metadataError } = await supabase
      .from("messages")
      .update({ metadata: messageMetadata })
      .eq("workspace_id", workspaceId)
      .eq("id", savedMessage.id);

    if (metadataError) {
      throw new Error(`Unable to update email attachment metadata: ${metadataError.message}`);
    }
  }

  const previousStatus = String(conversation.status ?? "open");
  const conversationUpdate: Record<string, unknown> = {
    last_message_at: message.receivedAt,
    status: "open",
  };

  if (message.externalThreadId && !textValue(conversation.external_thread_id)) {
    conversationUpdate.external_thread_id = message.externalThreadId;
  }

  const { error: updateConversationError } = await supabase
    .from("conversations")
    .update(conversationUpdate)
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
      attachmentCount: storedAttachments.length,
      messageId: String(savedMessage.id),
      status: "open",
      threadMatchStrategy,
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
    threadMatchStrategy,
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

function inboundAttachmentsFromEventPayload(
  payload: Record<string, unknown>,
  provider: InboundEmailProvider,
) {
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const inboundAttachments: InboundEmailAttachment[] = [];

  for (const value of attachments) {
    const attachment = objectRecord(value);
    const filename = textValue(attachment.filename);

    if (!filename) {
      continue;
    }

    inboundAttachments.push({
      attachmentId: textValue(attachment.attachmentId),
      contentType: textValue(attachment.contentType),
      filename,
      isInline: false,
      provider,
      sizeBytes: numberValue(attachment.sizeBytes),
    });
  }

  return inboundAttachments;
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
    attachments: inboundAttachmentsFromEventPayload(payload, provider),
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
    providerMessageId: textValue(payload.providerMessageId),
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
  const externalMessageId =
    textValue(payload.providerMessageId) ?? textValue(payload.externalMessageId);

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
        threadMatchStrategy: promoted.threadMatchStrategy,
        triageActionId: promoted.actionId ?? null,
        triageAiRunId: promoted.aiRunId ?? null,
        ...inboundEmailEventMetadata(message),
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
  const idempotencyKey = inboundEmailIdempotencyKey(message);
  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: {
        accountEmail: message.accountEmail,
        fromEmail: message.fromEmail,
        provider: message.provider,
        receivedAt: message.receivedAt,
        stage: "received",
        subject: message.subject,
        ...inboundEmailEventMetadata(message),
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
            fromEmail: message.fromEmail,
            provider: message.provider,
            receivedAt: message.receivedAt,
            stage: "observed",
            subject: message.subject,
            summary: settings.includeAwarenessEvents ? safeSummaryText(message) : null,
            ...inboundEmailEventMetadata(message),
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
          leadId: promoted.leadId,
          messageId: promoted.messageId,
          provider: message.provider,
          receivedAt: message.receivedAt,
          stage: "promoted",
          subject: message.subject,
          summary: safeSummaryText(message),
          threadMatchStrategy: promoted.threadMatchStrategy,
          triageActionId: promoted.actionId,
          triageAiRunId: promoted.aiRunId,
          ...inboundEmailEventMetadata(message),
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
          provider: message.provider,
          stage: "failed",
          subject: message.subject,
          ...inboundEmailEventMetadata(message),
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
