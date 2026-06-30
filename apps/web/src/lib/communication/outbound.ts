import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendConnectedEmailMessage,
  type EmailAttachment,
  type EmailSendResult,
} from "../integrations/mail";
import {
  findOrCreateTwilioSmsChannel,
  getActiveWorkspaceSmsNumber,
  getTwilioConfig,
  sendTwilioSmsMessage,
  telephonyUsageCost,
  TWILIO_PROVIDER,
  TWILIO_SMS_SERVICE,
  TWILIO_STATUS_WEBHOOK_PATH,
  type TwilioSmsSendResult,
} from "../integrations/twilio";
import { createServiceSupabaseClient } from "../supabase/service";
import { buildQuotePdfArtifactForDraft } from "../documents/pdf";
import {
  markGeneratedDocumentSent,
  recordQuoteGeneratedDocument,
} from "../documents/generated-documents";
import { appendQuoteDocumentHistory } from "../documents/history";
import {
  markQuoteSentToCustomer,
  quoteRevisionState,
} from "../documents/revisions";
import {
  getCommunicationSettings,
  isOutboundChannel,
  type OutboundChannel,
} from "./settings";
import {
  assertSmsSendAllowed,
  recordSmsRecipientPreference,
} from "./sms-compliance";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";

const DEFAULT_MAX_ATTEMPTS = 3;
const SCHEDULED_PROCESS_LIMIT = 25;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const OUTBOUND_ATTACHMENT_BUCKET =
  process.env.KYRO_FILE_STORAGE_BUCKET?.trim() || "kyro-files";
const MAX_OUTBOUND_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ensuredOutboundAttachmentBuckets = new Set<string>();

export type OutboundAttachment = EmailAttachment & {
  contentHash?: string | null;
  generatedAt?: string | null;
  generatedDocumentId?: string | null;
  quoteDraftId?: string | null;
  quoteVersion?: number | null;
  source: "local_upload" | "quote_draft" | "signature_logo";
};

type StoredOutboundAttachment = Omit<OutboundAttachment, "contentBase64"> & {
  fileId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  storageStatus: "stored" | "metadata_only";
};

type RecordOutboundMessageInput = {
  workspaceId: string;
  userId: string;
  conversationId: string;
  channelType: OutboundChannel;
  subject: string | null;
  body: string;
  htmlBody?: string | null;
  attachmentQuoteDraftId?: string | null;
  attachments?: OutboundAttachment[];
  source: string;
  actionId?: string | null;
  idempotencyKey?: string | null;
  settingsSnapshot?: Record<string, unknown> | null;
};

type RecordOutboundEventEmailInput = {
  workspaceId: string;
  userId: string;
  eventId: string;
  recipientEmail: string;
  subject: string | null;
  body: string;
  htmlBody?: string | null;
  attachments?: OutboundAttachment[];
  source: string;
  idempotencyKey?: string | null;
  settingsSnapshot?: Record<string, unknown> | null;
  replyEventPayload?: Record<string, unknown> | null;
  replyEventType?: string | null;
};

type OutboundQueueRow = {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  action_id: string | null;
  event_id: string | null;
  user_id: string | null;
  channel_id: string | null;
  channel_type: string;
  provider: string | null;
  service: string | null;
  connection_id: string | null;
  recipient: string | null;
  subject: string | null;
  body_text: string;
  body_html: string | null;
  attachments: unknown;
  settings_snapshot: unknown;
  status: string;
  idempotency_key: string;
  source: string;
  attempt_count: number | null;
  max_attempts: number | null;
  next_attempt_at: string | null;
  queued_at: string;
  sending_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  provider_request_id: string | null;
  last_error: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type OutboundDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "retry_scheduled"
  | "dismissed";

export type RecordOutboundMessageResult = {
  attachmentQuoteDraftId: string | null;
  channelId: string;
  channelType: OutboundChannel;
  conversationId: string;
  dryRun: boolean;
  executor: string;
  externalMessageId: string | null;
  externalSend: boolean;
  externalThreadId: string | null;
  attachments: Array<{
    filename: string;
    generatedDocumentId?: string | null;
    quoteDraftId: string | null;
    sizeBytes: number;
    source: string;
  }>;
  attemptCount: number;
  outboundMessageId: string;
  outboundRecordId: string;
  outboundRecordType: "event" | "message";
  outboundQueueId: string;
  outboxStatus: OutboundDeliveryStatus;
  previousConversationStatus: string;
  provider: string | null;
  providerRequestId: string | null;
  quoteDraftStatusAfter: string | null;
  quoteDraftStatusBefore: string | null;
  replayed: boolean;
  sentTo: string | null;
  subject: string | null;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Outbound delivery failed.";
}

function displayChannelName(channelType: OutboundChannel) {
  if (channelType === "sms") {
    return "SMS";
  }

  if (channelType === "phone") {
    return "Mock Phone";
  }

  if (channelType === "email") {
    return "Mock Email";
  }

  return "Manual Note";
}

function realChannelDisplayName(result: EmailSendResult) {
  const label = result.provider === "microsoft" ? "Outlook" : "Gmail";

  return result.accountEmail ? `${label} - ${result.accountEmail}` : label;
}

function twilioStatusCallbackUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");

  return appUrl ? `${appUrl}${TWILIO_STATUS_WEBHOOK_PATH}` : null;
}

function envTwilioSenderNumber() {
  return getTwilioConfig()?.defaultFromNumber ?? null;
}

function attachmentSummary(
  attachments: Array<OutboundAttachment | StoredOutboundAttachment>,
) {
  return attachments.map((attachment) => ({
    contentHash: attachment.contentHash ?? null,
    contentType: attachment.contentType,
    fileId: "fileId" in attachment ? attachment.fileId : null,
    filename: attachment.filename,
    generatedAt: attachment.generatedAt ?? null,
    generatedDocumentId: attachment.generatedDocumentId ?? null,
    quoteDraftId: attachment.quoteDraftId ?? null,
    quoteVersion: attachment.quoteVersion ?? null,
    sizeBytes: attachment.sizeBytes,
    source: attachment.source,
    storageBucket:
      "storageBucket" in attachment ? attachment.storageBucket : null,
    storagePath: "storagePath" in attachment ? attachment.storagePath : null,
    storageStatus:
      "storageStatus" in attachment ? attachment.storageStatus : null,
  }));
}

function safeStorageSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || "attachment"
  );
}

async function ensureOutboundAttachmentBucket(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  bucket: string,
) {
  if (ensuredOutboundAttachmentBuckets.has(bucket)) {
    return;
  }

  const { error } = await serviceSupabase.storage.getBucket(bucket);

  if (!error) {
    ensuredOutboundAttachmentBuckets.add(bucket);
    return;
  }

  const { error: createError } = await serviceSupabase.storage.createBucket(
    bucket,
    {
      public: false,
    },
  );

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(createError.message);
  }

  ensuredOutboundAttachmentBuckets.add(bucket);
}

async function persistOutboundAttachments({
  attachments,
  idempotencyKey,
  workspaceId,
}: {
  attachments: OutboundAttachment[];
  idempotencyKey: string;
  workspaceId: string;
}): Promise<StoredOutboundAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }

  const serviceSupabase = createServiceSupabaseClient();

  await ensureOutboundAttachmentBucket(
    serviceSupabase,
    OUTBOUND_ATTACHMENT_BUCKET,
  );

  const stored: StoredOutboundAttachment[] = [];
  const batchId = safeStorageSegment(idempotencyKey);

  for (const [index, attachment] of attachments.entries()) {
    const buffer = Buffer.from(attachment.contentBase64, "base64");

    if (buffer.byteLength > MAX_OUTBOUND_ATTACHMENT_BYTES) {
      throw new Error(
        `${attachment.filename} is over the current 10 MB outbound attachment limit.`,
      );
    }

    const filename = safeStorageSegment(attachment.filename);
    const storagePath = `${workspaceId}/outbound-email/${batchId}/${index + 1}-${filename}`;
    const contentType = attachment.contentType || "application/octet-stream";
    const { error: uploadError } = await serviceSupabase.storage
      .from(OUTBOUND_ATTACHMENT_BUCKET)
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(
        `Unable to store outbound attachment: ${uploadError.message}`,
      );
    }

    const { data: file, error: fileError } = await serviceSupabase
      .from("files")
      .insert({
        workspace_id: workspaceId,
        storage_bucket: OUTBOUND_ATTACHMENT_BUCKET,
        storage_path: storagePath,
        filename: attachment.filename,
        content_type: contentType,
        size_bytes: attachment.sizeBytes ?? buffer.byteLength,
        source: "outbound_email",
      })
      .select("id,storage_bucket,storage_path,filename,content_type,size_bytes")
      .single();

    if (fileError || !file) {
      throw new Error(
        `Unable to store outbound attachment metadata: ${
          fileError?.message ?? "unknown error"
        }`,
      );
    }

    stored.push({
      contentHash: attachment.contentHash ?? null,
      contentId: attachment.contentId,
      contentType: String(file.content_type ?? contentType),
      disposition: attachment.disposition,
      fileId: String(file.id),
      filename: String(file.filename),
      generatedAt: attachment.generatedAt ?? null,
      generatedDocumentId: attachment.generatedDocumentId ?? null,
      quoteDraftId: attachment.quoteDraftId ?? null,
      quoteVersion: attachment.quoteVersion ?? null,
      sizeBytes: numberValue(file.size_bytes, buffer.byteLength),
      source: attachment.source,
      storageBucket: String(file.storage_bucket),
      storagePath: String(file.storage_path),
      storageStatus: "stored",
    });
  }

  return stored;
}

function parseStoredOutboundAttachment(
  value: unknown,
): StoredOutboundAttachment | null {
  const record = objectRecord(value);
  const contentType = textValue(record.contentType);
  const filename = textValue(record.filename);
  const source = textValue(record.source);

  if (!contentType || !filename) {
    return null;
  }

  return {
    contentHash: textValue(record.contentHash),
    contentId: textValue(record.contentId),
    contentType,
    disposition:
      record.disposition === "inline" || record.disposition === "attachment"
        ? record.disposition
        : undefined,
    fileId: textValue(record.fileId),
    filename,
    generatedAt: textValue(record.generatedAt),
    generatedDocumentId: textValue(record.generatedDocumentId),
    quoteDraftId: textValue(record.quoteDraftId),
    quoteVersion:
      typeof record.quoteVersion === "number" ? record.quoteVersion : null,
    sizeBytes: numberValue(record.sizeBytes),
    source:
      source === "quote_draft" ||
      source === "signature_logo" ||
      source === "local_upload"
        ? source
        : "local_upload",
    storageBucket: textValue(record.storageBucket),
    storagePath: textValue(record.storagePath),
    storageStatus:
      record.storageStatus === "metadata_only" ? "metadata_only" : "stored",
  } satisfies StoredOutboundAttachment;
}

function storedAttachmentSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(parseStoredOutboundAttachment)
    .filter((attachment): attachment is StoredOutboundAttachment =>
      Boolean(attachment),
    )
    .map((attachment) => attachmentSummary([attachment])[0]);
}

async function storedAttachments(
  value: unknown,
): Promise<OutboundAttachment[]> {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: OutboundAttachment[] = [];
  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient> | null =
    null;

  for (const attachment of value) {
    const record = objectRecord(attachment);
    const contentBase64 = textValue(record.contentBase64);
    const parsed = parseStoredOutboundAttachment(attachment);

    if (!parsed) {
      continue;
    }

    let resolvedContentBase64 = contentBase64;

    if (!resolvedContentBase64 && parsed.storageBucket && parsed.storagePath) {
      serviceSupabase ??= createServiceSupabaseClient();
      const { data, error } = await serviceSupabase.storage
        .from(parsed.storageBucket)
        .download(parsed.storagePath);

      if (error || !data) {
        throw new Error(
          `Unable to load outbound attachment ${parsed.filename}: ${
            error?.message ?? "download failed"
          }`,
        );
      }

      resolvedContentBase64 = Buffer.from(await data.arrayBuffer()).toString(
        "base64",
      );
    }

    if (!resolvedContentBase64) {
      continue;
    }

    attachments.push({
      contentBase64: resolvedContentBase64,
      contentHash: parsed.contentHash,
      contentId: parsed.contentId,
      contentType: parsed.contentType,
      disposition: parsed.disposition,
      filename: parsed.filename,
      generatedAt: parsed.generatedAt,
      generatedDocumentId: parsed.generatedDocumentId,
      quoteDraftId: parsed.quoteDraftId,
      quoteVersion: parsed.quoteVersion,
      sizeBytes: parsed.sizeBytes,
      source: parsed.source,
    });
  }

  return attachments;
}

function buildIdempotencyKey(input: RecordOutboundMessageInput) {
  const supplied = textValue(input.idempotencyKey);

  if (supplied) {
    return supplied;
  }

  if (input.actionId) {
    return `action.${input.actionId}.outbound`;
  }

  return `${input.source}.${input.conversationId}.${input.channelType}.${crypto.randomUUID()}`;
}

export function nextOutboundAttemptAtIso(
  attemptCount: number,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  startedAt = new Date(),
) {
  if (attemptCount >= maxAttempts) {
    return null;
  }

  const delay = RETRY_DELAYS_MS[Math.max(0, attemptCount - 1)] ?? 60 * 60_000;

  return new Date(startedAt.getTime() + delay).toISOString();
}

function normalizeDeliveryStatus(value: string): OutboundDeliveryStatus {
  if (
    value === "queued" ||
    value === "sending" ||
    value === "sent" ||
    value === "failed" ||
    value === "retry_scheduled" ||
    value === "dismissed"
  ) {
    return value;
  }

  return "queued";
}

async function insertOutboundAuditLog(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    action: string;
    entityId: string;
    entityType?: string;
    actorId?: string | null;
    after?: Record<string, unknown> | null;
    before?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const { error } = await supabase.from("audit_logs").insert({
    workspace_id: input.workspaceId,
    actor_type: "system",
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType ?? "outbound_message",
    entity_id: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    console.warn("Unable to write outbound audit log", error.message);
  }
}

function addDaysIso(startIso: string, days: number) {
  const date = new Date(startIso);
  date.setDate(date.getDate() + days);

  return date.toISOString();
}

async function scheduleAutomaticFollowUpReminder(
  supabase: SupabaseClient,
  input: {
    channelType: OutboundChannel;
    contactId: string | null;
    conversationId: string;
    leadId: string | null;
    messageId: string;
    outboundQueueId: string;
    sentAt: string;
    userId: string | null;
    workspaceId: string;
  },
) {
  const settings = await getCommunicationSettings(supabase, input.workspaceId);

  if (!settings.followUpRemindersEnabled) {
    return;
  }

  const dueAt = addDaysIso(input.sentAt, settings.followUpDelayDays);
  const description = `Check in if the customer has not replied after ${settings.followUpDelayDays} day${
    settings.followUpDelayDays === 1 ? "" : "s"
  }.`;
  const metadata = {
    channelType: input.channelType,
    delayDays: settings.followUpDelayDays,
    outboundMessageId: input.messageId,
    outboundQueueId: input.outboundQueueId,
    scheduledAfter: input.sentAt,
    source: "automatic_follow_up",
  };
  const { data: existingTask, error: existingError } = await supabase
    .from("conversation_tasks")
    .select("id,due_at,metadata")
    .eq("workspace_id", input.workspaceId)
    .eq("conversation_id", input.conversationId)
    .eq("task_type", "customer_follow_up")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to inspect follow-up reminder: ${existingError.message}`,
    );
  }

  if (existingTask) {
    const { error: updateError } = await supabase
      .from("conversation_tasks")
      .update({
        assigned_to_user_id: input.userId,
        description,
        due_at: dueAt,
        lead_id: input.leadId,
        message_id: input.messageId,
        metadata: {
          ...objectRecord(existingTask.metadata),
          ...metadata,
          previousDueAt: existingTask.due_at
            ? String(existingTask.due_at)
            : null,
        },
        priority: "normal",
        title: "Follow up with customer",
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", existingTask.id);

    if (updateError) {
      throw new Error(
        `Unable to reschedule follow-up reminder: ${updateError.message}`,
      );
    }

    await insertOutboundAuditLog(supabase, {
      workspaceId: input.workspaceId,
      action: "conversation_follow_up.rescheduled",
      entityId: String(existingTask.id),
      entityType: "conversation_task",
      actorId: input.userId,
      after: {
        dueAt,
        taskType: "customer_follow_up",
      },
      metadata: {
        conversationId: input.conversationId,
        outboundMessageId: input.messageId,
        outboundQueueId: input.outboundQueueId,
      },
    });

    return;
  }

  const { data: task, error: insertError } = await supabase
    .from("conversation_tasks")
    .insert({
      assigned_to_user_id: input.userId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      created_by_user_id: input.userId,
      description,
      due_at: dueAt,
      lead_id: input.leadId,
      message_id: input.messageId,
      metadata,
      priority: "normal",
      status: "open",
      task_type: "customer_follow_up",
      title: "Follow up with customer",
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  if (insertError || !task) {
    throw new Error(
      `Unable to create follow-up reminder: ${insertError?.message ?? "unknown error"}`,
    );
  }

  await insertOutboundAuditLog(supabase, {
    workspaceId: input.workspaceId,
    action: "conversation_follow_up.scheduled",
    entityId: String(task.id),
    entityType: "conversation_task",
    actorId: input.userId,
    after: {
      dueAt,
      taskType: "customer_follow_up",
    },
    metadata: {
      conversationId: input.conversationId,
      outboundMessageId: input.messageId,
      outboundQueueId: input.outboundQueueId,
    },
  });
}

async function buildQuoteDraftAttachment(
  supabase: SupabaseClient,
  workspaceId: string,
  quoteDraftId: string,
  createdByUserId: string | null,
): Promise<OutboundAttachment> {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  const { data: quoteDraft, error: quoteDraftError } = await supabase
    .from("quote_drafts")
    .select("id,title,status,metadata,contact_id,lead_id,conversation_id")
    .eq("workspace_id", workspaceId)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (quoteDraftError) {
    throw new Error(
      `Unable to load quote draft for generated document record: ${quoteDraftError.message}`,
    );
  }

  if (!quoteDraft) {
    throw new Error("Quote draft was not found.");
  }

  const artifact = await buildQuotePdfArtifactForDraft(supabase, {
    quoteDraftId,
    workspace: {
      id: workspaceId,
      name: textValue(workspace?.name) ?? "Kyro workspace",
    },
  });
  const generatedDocument = await recordQuoteGeneratedDocument(supabase, {
    artifact,
    createdByUserId,
    documentType: "quote",
    quoteDraft,
    source: "outbound.quote_attachment",
    workspaceId,
  });

  return {
    contentBase64: artifact.contentBase64,
    contentHash: artifact.contentHash,
    contentType: artifact.contentType,
    filename: artifact.filename,
    generatedAt: artifact.generatedAt,
    generatedDocumentId: generatedDocument.id,
    quoteDraftId,
    sizeBytes: artifact.sizeBytes,
    source: "quote_draft",
  };
}

export async function findOrCreateMockOutboundChannel(
  supabase: SupabaseClient,
  workspaceId: string,
  channelType: string,
) {
  if (!isOutboundChannel(channelType)) {
    throw new Error(`${channelType} is not a supported outbound channel.`);
  }

  const externalId = `mock_outbound:${channelType}`;
  const { data: existingChannel, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("type", channelType)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to load mock outbound channel: ${existingError.message}`,
    );
  }

  if (existingChannel) {
    return String(existingChannel.id);
  }

  const { data: channel, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: workspaceId,
      type: channelType,
      display_name: displayChannelName(channelType),
      external_id: externalId,
      status: "active",
      settings: {
        dryRunOnly: true,
        externalSend: false,
        source: "mock_outbound",
      },
    })
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(
      `Unable to create mock outbound channel: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(channel.id);
}

async function findOrCreateEmailOutboundChannel(
  supabase: SupabaseClient,
  {
    result,
    workspaceId,
  }: {
    result: EmailSendResult;
    workspaceId: string;
  },
) {
  const externalId = `${result.provider}:${result.service}:${
    result.accountEmail ?? result.connectionId
  }`;
  const payload = {
    workspace_id: workspaceId,
    integration_id: result.connectionId,
    type: "email",
    display_name: realChannelDisplayName(result),
    external_id: externalId,
    status: "active",
    settings: {
      provider: result.provider,
      service: result.service,
      connectionId: result.connectionId,
      dryRunOnly: false,
      externalSendEnabled: true,
    },
  };
  const { data: existingChannel, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to load email outbound channel: ${existingError.message}`,
    );
  }

  if (existingChannel) {
    const { error } = await supabase
      .from("channels")
      .update(payload)
      .eq("workspace_id", workspaceId)
      .eq("id", existingChannel.id);

    if (error) {
      throw new Error(
        `Unable to update email outbound channel: ${error.message}`,
      );
    }

    return String(existingChannel.id);
  }

  const { data: channel, error } = await supabase
    .from("channels")
    .insert(payload)
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(
      `Unable to create email outbound channel: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(channel.id);
}

async function loadEmailRecipient(
  supabase: SupabaseClient,
  {
    contactId,
    workspaceId,
  }: {
    contactId: string | null;
    workspaceId: string;
  },
) {
  const { data: contact, error: contactError } = contactId
    ? await supabase
        .from("contacts")
        .select("email")
        .eq("workspace_id", workspaceId)
        .eq("id", contactId)
        .maybeSingle()
    : { data: null, error: null };

  if (contactError) {
    throw new Error(`Unable to load email recipient: ${contactError.message}`);
  }

  return textValue(contact?.email);
}

async function loadPhoneRecipient(
  supabase: SupabaseClient,
  {
    contactId,
    workspaceId,
  }: {
    contactId: string | null;
    workspaceId: string;
  },
) {
  const { data: contact, error: contactError } = contactId
    ? await supabase
        .from("contacts")
        .select("phone,normalized_phone")
        .eq("workspace_id", workspaceId)
        .eq("id", contactId)
        .maybeSingle()
    : { data: null, error: null };

  if (contactError) {
    throw new Error(`Unable to load SMS recipient: ${contactError.message}`);
  }

  return textValue(contact?.normalized_phone) ?? textValue(contact?.phone);
}

async function enqueueOutboundDelivery(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    conversationId?: string | null;
    actionId?: string | null;
    eventId?: string | null;
    userId: string;
    channelType: OutboundChannel;
    recipient: string | null;
    subject: string | null;
    body: string;
    htmlBody: string | null;
    attachments: StoredOutboundAttachment[];
    idempotencyKey: string;
    settingsSnapshot: Record<string, unknown> | null;
    source: string;
    metadata: Record<string, unknown>;
  },
) {
  const payload = {
    workspace_id: input.workspaceId,
    conversation_id: input.conversationId ?? null,
    action_id: input.actionId ?? null,
    event_id: input.eventId ?? null,
    user_id: input.userId,
    channel_type: input.channelType,
    recipient: input.recipient,
    subject: input.subject,
    body_text: input.body,
    body_html: input.htmlBody,
    attachments: input.attachments,
    settings_snapshot: input.settingsSnapshot ?? {},
    status: "queued",
    idempotency_key: input.idempotencyKey,
    source: input.source,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
    next_attempt_at: nowIso(),
    metadata: input.metadata,
  };
  const { data, error } = await supabase
    .from("outbound_messages")
    .insert(payload)
    .select("*")
    .single();

  if (!error && data) {
    const row = data as OutboundQueueRow;

    await insertOutboundAuditLog(supabase, {
      workspaceId: input.workspaceId,
      action: "outbound_message.queued",
      entityId: row.id,
      actorId: input.userId,
      after: {
        channelType: input.channelType,
        idempotencyKey: input.idempotencyKey,
        recipient: input.recipient,
        status: "queued",
      },
      metadata: {
        actionId: input.actionId ?? null,
        conversationId: input.conversationId ?? null,
        eventId: input.eventId ?? null,
        source: input.source,
      },
    });

    return { duplicate: false, row };
  }

  if (error?.code !== "23505") {
    throw new Error(
      `Unable to queue outbound delivery: ${error?.message ?? "unknown error"}`,
    );
  }

  const { data: existingRow, error: existingError } = await supabase
    .from("outbound_messages")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existingError || !existingRow) {
    throw new Error(
      `Unable to load duplicate outbound delivery: ${existingError?.message ?? "unknown error"}`,
    );
  }

  return { duplicate: true, row: existingRow as OutboundQueueRow };
}

async function loadOutboundQueueRow(
  supabase: SupabaseClient,
  workspaceId: string,
  outboundQueueId: string,
) {
  const { data, error } = await supabase
    .from("outbound_messages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", outboundQueueId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load outbound delivery: ${error.message}`);
  }

  if (!data) {
    throw new Error("Outbound delivery was not found.");
  }

  return data as OutboundQueueRow;
}

async function loadOutboundQueueRowByIdempotency(
  supabase: SupabaseClient,
  workspaceId: string,
  idempotencyKey: string,
) {
  const { data, error } = await supabase
    .from("outbound_messages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load outbound delivery: ${error.message}`);
  }

  return data ? (data as OutboundQueueRow) : null;
}

function storedResultFromRow(
  row: OutboundQueueRow,
): RecordOutboundMessageResult | null {
  const stored = objectRecord(objectRecord(row.metadata).recordResult);
  const outboundRecordId =
    textValue(stored.outboundRecordId) ?? textValue(stored.outboundMessageId);
  const outboundRecordType =
    textValue(stored.outboundRecordType) === "event" ? "event" : "message";
  const channelId = textValue(stored.channelId);
  const channelType = textValue(stored.channelType);
  const conversationId =
    textValue(stored.conversationId) ?? textValue(row.conversation_id);

  if (!outboundRecordId || !channelId || !channelType) {
    return null;
  }

  if (!isOutboundChannel(channelType)) {
    return null;
  }

  const attachments = Array.isArray(stored.attachments)
    ? stored.attachments.map((attachment) => {
        const record = objectRecord(attachment);

        return {
          filename: textValue(record.filename) ?? "attachment",
          generatedDocumentId: textValue(record.generatedDocumentId),
          quoteDraftId: textValue(record.quoteDraftId),
          sizeBytes: numberValue(record.sizeBytes),
          source: textValue(record.source) ?? "unknown",
        };
      })
    : [];

  return {
    attachmentQuoteDraftId: textValue(stored.attachmentQuoteDraftId),
    attachments,
    attemptCount: numberValue(row.attempt_count),
    channelId,
    channelType,
    conversationId: conversationId ?? "",
    dryRun: Boolean(stored.dryRun),
    executor: textValue(stored.executor) ?? "outbox_replay",
    externalMessageId: textValue(stored.externalMessageId),
    externalSend: Boolean(stored.externalSend),
    externalThreadId: textValue(stored.externalThreadId),
    outboundMessageId: outboundRecordId,
    outboundRecordId,
    outboundRecordType,
    outboundQueueId: row.id,
    outboxStatus: normalizeDeliveryStatus(row.status),
    previousConversationStatus:
      textValue(stored.previousConversationStatus) ?? "unknown",
    provider: textValue(stored.provider),
    providerRequestId: textValue(stored.providerRequestId),
    quoteDraftStatusAfter: textValue(stored.quoteDraftStatusAfter),
    quoteDraftStatusBefore: textValue(stored.quoteDraftStatusBefore),
    replayed: true,
    sentTo: textValue(stored.sentTo),
    subject: textValue(stored.subject),
  };
}

async function startOutboundAttempt(
  supabase: SupabaseClient,
  row: OutboundQueueRow,
  actorId: string | null,
) {
  if (row.status === "sent") {
    const stored = storedResultFromRow(row);

    if (stored) {
      return { alreadySent: true as const, result: stored };
    }

    throw new Error("This outbound message has already been sent.");
  }

  if (row.status === "sending") {
    throw new Error("This outbound message is already being sent.");
  }

  if (row.status === "dismissed") {
    throw new Error("This outbound message has been dismissed.");
  }

  const attemptCount = numberValue(row.attempt_count) + 1;
  const startedAt = nowIso();
  const { data, error } = await supabase
    .from("outbound_messages")
    .update({
      attempt_count: attemptCount,
      failed_at: null,
      last_error: null,
      next_attempt_at: null,
      sending_at: startedAt,
      status: "sending",
    })
    .eq("id", row.id)
    .in("status", ["queued", "retry_scheduled", "failed"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to start outbound delivery: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      "Unable to start outbound delivery because its status changed.",
    );
  }

  await insertOutboundAuditLog(supabase, {
    workspaceId: row.workspace_id,
    action: "outbound_message.sending",
    entityId: row.id,
    actorId,
    before: {
      status: row.status,
    },
    after: {
      attemptCount,
      status: "sending",
    },
    metadata: {
      conversationId: row.conversation_id,
      source: row.source,
    },
  });

  return { alreadySent: false as const, row: data as OutboundQueueRow };
}

async function markOutboundProviderAccepted(
  supabase: SupabaseClient,
  row: OutboundQueueRow,
  input: {
    channelId: string;
    emailResult: EmailSendResult;
    metadata: Record<string, unknown>;
  },
) {
  await supabase
    .from("outbound_messages")
    .update({
      channel_id: input.channelId,
      connection_id: input.emailResult.connectionId,
      provider: input.emailResult.provider,
      provider_message_id: input.emailResult.messageId,
      provider_request_id: input.emailResult.providerRequestId ?? null,
      provider_thread_id: input.emailResult.threadId,
      service: input.emailResult.service,
      metadata: {
        ...objectRecord(row.metadata),
        ...input.metadata,
        providerAcceptedAt: nowIso(),
      },
    })
    .eq("id", row.id);
}

async function markOutboundExternalProviderAccepted(
  supabase: SupabaseClient,
  row: OutboundQueueRow,
  input: {
    channelId: string;
    connectionId?: string | null;
    messageId: string | null;
    metadata: Record<string, unknown>;
    provider: string;
    providerRequestId?: string | null;
    service: string;
    threadId?: string | null;
  },
) {
  await supabase
    .from("outbound_messages")
    .update({
      channel_id: input.channelId,
      connection_id: input.connectionId ?? null,
      provider: input.provider,
      provider_message_id: input.messageId,
      provider_request_id: input.providerRequestId ?? null,
      provider_thread_id: input.threadId ?? null,
      service: input.service,
      metadata: {
        ...objectRecord(row.metadata),
        ...input.metadata,
        providerAcceptedAt: nowIso(),
      },
    })
    .eq("id", row.id);
}

async function markOutboundFailed(
  supabase: SupabaseClient,
  row: OutboundQueueRow,
  attemptCount: number,
  error: unknown,
  actorId: string | null,
) {
  const failedAt = nowIso();
  const maxAttempts = Math.max(
    1,
    numberValue(row.max_attempts, DEFAULT_MAX_ATTEMPTS),
  );
  const nextAttemptAt = nextOutboundAttemptAtIso(
    attemptCount,
    maxAttempts,
    new Date(failedAt),
  );
  const status: OutboundDeliveryStatus = nextAttemptAt
    ? "retry_scheduled"
    : "failed";
  const message = errorMessage(error);

  await supabase
    .from("outbound_messages")
    .update({
      failed_at: failedAt,
      last_error: message,
      next_attempt_at: nextAttemptAt,
      status,
      metadata: {
        ...objectRecord(row.metadata),
        lastFailureAt: failedAt,
        lastFailureMessage: message,
      },
    })
    .eq("id", row.id);

  await insertOutboundAuditLog(supabase, {
    workspaceId: row.workspace_id,
    action:
      status === "retry_scheduled"
        ? "outbound_message.retry_scheduled"
        : "outbound_message.failed",
    entityId: row.id,
    actorId,
    before: {
      status: "sending",
    },
    after: {
      attemptCount,
      lastError: message,
      nextAttemptAt,
      status,
    },
    metadata: {
      conversationId: row.conversation_id,
      source: row.source,
    },
  });
}

async function markOutboundRecordFailed(
  supabase: SupabaseClient,
  row: OutboundQueueRow,
  error: unknown,
  actorId: string | null,
) {
  const message = errorMessage(error);

  await supabase
    .from("outbound_messages")
    .update({
      failed_at: nowIso(),
      last_error: message,
      status: "sent",
      metadata: {
        ...objectRecord(row.metadata),
        externalSendRecorded: false,
        recordError: message,
      },
    })
    .eq("id", row.id);

  await insertOutboundAuditLog(supabase, {
    workspaceId: row.workspace_id,
    action: "outbound_message.record_failed_after_provider_send",
    entityId: row.id,
    actorId,
    after: {
      lastError: message,
      status: "sent",
    },
    metadata: {
      conversationId: row.conversation_id,
      source: row.source,
    },
  });
}

async function markOutboundSent(
  supabase: SupabaseClient,
  row: OutboundQueueRow,
  result: RecordOutboundMessageResult,
  actorId: string | null,
): Promise<OutboundDeliveryStatus> {
  const sentAt = nowIso();
  const { data: currentRow, error: currentError } = await supabase
    .from("outbound_messages")
    .select("status,failed_at,last_error,metadata")
    .eq("id", row.id)
    .maybeSingle();

  if (currentError) {
    throw new Error(
      `Unable to refresh outbound delivery state: ${currentError.message}`,
    );
  }

  const currentMetadata = objectRecord(currentRow?.metadata ?? row.metadata);
  const twilioStatus = objectRecord(currentMetadata.twilioStatus);
  const providerStatus = textValue(twilioStatus.rawStatus)?.toLowerCase();
  const providerFailed =
    currentRow?.status === "failed" ||
    providerStatus === "failed" ||
    providerStatus === "undelivered";
  const finalStatus: OutboundDeliveryStatus = providerFailed
    ? "failed"
    : "sent";
  const finalError =
    finalStatus === "failed"
      ? (textValue(currentRow?.last_error) ??
        `Twilio SMS ${providerStatus ?? "failed"}`)
      : null;

  const { error: updateError } = await supabase
    .from("outbound_messages")
    .update({
      channel_id: result.channelId,
      failed_at: finalStatus === "failed" ? (currentRow?.failed_at ?? sentAt) : null,
      last_error: finalError,
      next_attempt_at: null,
      provider: result.provider,
      provider_message_id: result.externalMessageId,
      provider_request_id: result.providerRequestId,
      provider_thread_id: result.externalThreadId,
      sent_at: sentAt,
      status: finalStatus,
      metadata: {
        ...currentMetadata,
        externalSendRecorded: true,
        recordResult: {
          ...result,
          outboxStatus: finalStatus,
          replayed: false,
        },
      },
    })
    .eq("id", row.id);

  if (updateError) {
    throw new Error(
      `Unable to mark outbound delivery complete: ${updateError.message}`,
    );
  }

  await insertOutboundAuditLog(supabase, {
    workspaceId: row.workspace_id,
    action: "outbound_message.sent",
    entityId: row.id,
    actorId,
    before: {
      status: "sending",
    },
    after: {
      externalMessageId: result.externalMessageId,
      externalSend: result.externalSend,
      messageId: result.outboundMessageId,
      provider: result.provider,
      status: finalStatus,
    },
    metadata: {
      conversationId: result.conversationId,
      source: row.source,
    },
  });

  return finalStatus;
}

async function deliverOutboundQueueItem(
  supabase: SupabaseClient,
  row: OutboundQueueRow,
  actorId: string | null,
): Promise<RecordOutboundMessageResult> {
  const started = await startOutboundAttempt(supabase, row, actorId);

  if (started.alreadySent) {
    return started.result;
  }

  const activeRow = started.row;
  const channelType = textValue(activeRow.channel_type);
  const conversationId = textValue(activeRow.conversation_id);
  const outboxMetadata = objectRecord(activeRow.metadata);
  const deliveryMode =
    textValue(outboxMetadata.deliveryMode) === "event"
      ? "event"
      : "conversation";

  if (!channelType || !isOutboundChannel(channelType)) {
    throw new Error("Outbound delivery has an invalid channel.");
  }

  if (!conversationId && deliveryMode !== "event") {
    throw new Error("Outbound delivery is not attached to a conversation.");
  }

  const body = textValue(activeRow.body_text);

  if (!body) {
    throw new Error("Outbound delivery has an empty body.");
  }

  const { data: conversation, error: conversationError } = conversationId
    ? await supabase
        .from("conversations")
        .select("id,status,contact_id,lead_id")
        .eq("workspace_id", activeRow.workspace_id)
        .eq("id", conversationId)
        .maybeSingle()
    : { data: null, error: null };

  if (conversationError) {
    throw new Error(
      `Unable to load outbound conversation: ${conversationError.message}`,
    );
  }

  if (conversationId && !conversation) {
    throw new Error(
      "Unable to deliver outbound message because the conversation was not found.",
    );
  }

  const attachments = await storedAttachments(activeRow.attachments);
  const attachmentMetadata = storedAttachmentSummary(activeRow.attachments);
  const attachmentQuoteDraftId = textValue(
    outboxMetadata.attachmentQuoteDraftId,
  );
  const quoteDraftStatusBefore = textValue(
    outboxMetadata.quoteDraftStatusBefore,
  );
  const now = nowIso();
  let channelId: string;
  let dryRun = true;
  let executor = "mock_outbound_channel";
  let externalMessageId: string | null = null;
  let externalThreadId: string | null = null;
  let externalService: string | null = null;
  let accountEmail: string | null = null;
  let provider: string | null = null;
  let providerRequestId: string | null = null;
  let sentTo = textValue(activeRow.recipient);
  let sentFrom: string | null = null;
  let twilioSmsResult: TwilioSmsSendResult | null = null;
  let providerAccepted = false;
  const attemptCount = numberValue(activeRow.attempt_count);

  try {
    if (channelType === "email") {
      const recipientEmail =
        sentTo ??
        (conversation
          ? await loadEmailRecipient(supabase, {
              contactId: conversation.contact_id
                ? String(conversation.contact_id)
                : null,
              workspaceId: activeRow.workspace_id,
            })
          : null);

      if (!recipientEmail) {
        throw new Error(
          "This contact does not have an email address, so Kyro cannot send this reply.",
        );
      }

      const emailResult = await sendConnectedEmailMessage(supabase, {
        attachments,
        body,
        htmlBody: textValue(activeRow.body_html),
        subject: textValue(activeRow.subject) ?? "Follow-up",
        to: recipientEmail,
        workspaceId: activeRow.workspace_id,
      });

      channelId = await findOrCreateEmailOutboundChannel(supabase, {
        result: emailResult,
        workspaceId: activeRow.workspace_id,
      });
      dryRun = false;
      executor = `${emailResult.service}_api`;
      externalMessageId = emailResult.messageId;
      externalThreadId = emailResult.threadId;
      externalService = emailResult.service;
      accountEmail = emailResult.accountEmail;
      provider = emailResult.provider;
      providerRequestId = emailResult.providerRequestId ?? null;
      sentTo = recipientEmail;
      providerAccepted = true;
      await markOutboundProviderAccepted(supabase, activeRow, {
        channelId,
        emailResult,
        metadata: {
          sentTo: recipientEmail,
        },
      });
    } else if (channelType === "sms") {
      const recipientPhone =
        sentTo ??
        (conversation
          ? await loadPhoneRecipient(supabase, {
              contactId: conversation.contact_id
                ? String(conversation.contact_id)
                : null,
              workspaceId: activeRow.workspace_id,
            })
          : null);

      if (!recipientPhone) {
        throw new Error(
          "This contact does not have a phone number, so Kyro cannot send this SMS.",
        );
      }

      await assertSmsSendAllowed(supabase, {
        phoneNumber: recipientPhone,
        workspaceId: activeRow.workspace_id,
      });

      const workspaceSmsNumber = await getActiveWorkspaceSmsNumber(
        supabase,
        activeRow.workspace_id,
      );
      const senderNumber =
        workspaceSmsNumber?.phoneNumber ?? envTwilioSenderNumber();

      if (senderNumber && getTwilioConfig()) {
        const smsResult = await sendTwilioSmsMessage({
          body,
          from: senderNumber,
          statusCallbackUrl: twilioStatusCallbackUrl(),
          to: recipientPhone,
        });
        twilioSmsResult = smsResult;

        channelId = await findOrCreateTwilioSmsChannel(supabase, {
          phoneNumber: senderNumber,
          providerPhoneNumberId:
            workspaceSmsNumber?.providerPhoneNumberId ?? null,
          workspaceId: activeRow.workspace_id,
        });
        dryRun = false;
        executor = "twilio_sms_api";
        externalMessageId = smsResult.messageId;
        externalService = TWILIO_SMS_SERVICE;
        provider = TWILIO_PROVIDER;
        providerRequestId = smsResult.providerRequestId ?? null;
        sentFrom = senderNumber;
        sentTo = recipientPhone;
        providerAccepted = true;
        await recordSmsRecipientPreference(supabase, {
          channelNumberId: workspaceSmsNumber?.id ?? null,
          metadata: {
            from: senderNumber,
            outboundQueueId: activeRow.id,
            provider: TWILIO_PROVIDER,
            providerMessageId: smsResult.messageId,
            sentTo: recipientPhone,
          },
          phoneNumber: recipientPhone,
          source: "twilio_outbound_sms",
          touch: "outbound",
          workspaceId: activeRow.workspace_id,
        });
        await markOutboundExternalProviderAccepted(supabase, activeRow, {
          channelId,
          messageId: smsResult.messageId,
          metadata: {
            from: senderNumber,
            sentTo: recipientPhone,
            twilio: {
              accountSid: smsResult.accountSid,
              direction: smsResult.direction,
              numSegments: smsResult.numSegments,
              price: smsResult.price,
              priceUnit: smsResult.priceUnit,
              status: smsResult.status,
            },
            workspacePhoneNumberId: workspaceSmsNumber?.id ?? null,
          },
          provider: TWILIO_PROVIDER,
          providerRequestId: smsResult.providerRequestId,
          service: TWILIO_SMS_SERVICE,
        });
      } else {
        channelId = await findOrCreateMockOutboundChannel(
          supabase,
          activeRow.workspace_id,
          channelType,
        );
        sentTo = recipientPhone;
      }
    } else {
      channelId = await findOrCreateMockOutboundChannel(
        supabase,
        activeRow.workspace_id,
        channelType,
      );
    }

    let outboundRecordId: string;
    let outboundRecordType: "event" | "message" = "message";
    const beforeStatus = conversation
      ? String(conversation.status)
      : "not_applicable";
    let quoteDraftStatusAfter: string | null = null;

    if (deliveryMode === "event") {
      outboundRecordType = "event";
      const replyEventPayload = objectRecord(outboxMetadata.replyEventPayload);
      const { data: replyEvent, error: replyEventError } = await supabase
        .from("events")
        .insert({
          idempotency_key: `outbound.event_record.${activeRow.id}`,
          payload: {
            ...replyEventPayload,
            accountEmail,
            attachments: attachmentMetadata,
            externalMessageId,
            externalThreadId,
            outboundQueueId: activeRow.id,
            provider,
            providerRequestId,
            sentAt: now,
            sentTo,
            service: externalService,
            subject: textValue(activeRow.subject),
          },
          processed_at: now,
          source: activeRow.source,
          status: "processed",
          type:
            textValue(outboxMetadata.replyEventType) ??
            "outbound.filtered_email.reply_sent",
          workspace_id: activeRow.workspace_id,
        })
        .select("id")
        .single();

      if (replyEventError || !replyEvent) {
        throw new Error(
          `Unable to record outbound event: ${
            replyEventError?.message ?? "unknown error"
          }`,
        );
      }

      outboundRecordId = String(replyEvent.id);
    } else {
      if (!conversation || !conversationId) {
        throw new Error("Outbound delivery is not attached to a conversation.");
      }

      const { data: message, error: messageError } = await supabase
        .from("messages")
        .insert({
          workspace_id: activeRow.workspace_id,
          conversation_id: conversationId,
          channel_id: channelId,
          contact_id: conversation.contact_id ?? null,
          direction: "outbound",
          subject: textValue(activeRow.subject),
          body_text: body,
          external_message_id: externalMessageId,
          sent_at: now,
          metadata: {
            source: activeRow.source,
            actionId: activeRow.action_id,
            attachmentQuoteDraftId,
            attachments: attachmentMetadata,
            channelType,
            dryRun,
            externalSend: !dryRun,
            externalService,
            externalThreadId,
            htmlBodyAvailable: Boolean(textValue(activeRow.body_html)),
            outboxAttemptCount: attemptCount,
            outboundQueueId: activeRow.id,
            provider,
            providerRequestId,
            requestedByUserId: activeRow.user_id,
            sentTo,
            settingsSnapshot: objectRecord(activeRow.settings_snapshot),
          },
        })
        .select("id")
        .single();

      if (messageError || !message) {
        throw new Error(
          `Unable to record outbound message: ${messageError?.message ?? "unknown error"}`,
        );
      }

      outboundRecordId = String(message.id);
      const { error: conversationUpdateError } = await supabase
        .from("conversations")
        .update({
          status: "replied",
          last_message_at: now,
        })
        .eq("workspace_id", activeRow.workspace_id)
        .eq("id", conversationId);

      if (conversationUpdateError) {
        throw new Error(
          `Unable to update conversation after outbound: ${conversationUpdateError.message}`,
        );
      }

      try {
        await scheduleAutomaticFollowUpReminder(supabase, {
          channelType,
          contactId: conversation.contact_id
            ? String(conversation.contact_id)
            : null,
          conversationId,
          leadId: conversation.lead_id ? String(conversation.lead_id) : null,
          messageId: outboundRecordId,
          outboundQueueId: activeRow.id,
          sentAt: now,
          userId: activeRow.user_id ? String(activeRow.user_id) : null,
          workspaceId: activeRow.workspace_id,
        });
      } catch (followUpError) {
        console.warn(
          "Unable to schedule automatic follow-up reminder",
          errorMessage(followUpError),
        );
      }
    }

    if (attachmentQuoteDraftId && conversationId) {
      const { data: quoteDraft, error: quoteDraftError } = await supabase
        .from("quote_drafts")
        .select("id,title,status,line_items,notes,metadata")
        .eq("workspace_id", activeRow.workspace_id)
        .eq("conversation_id", conversationId)
        .eq("id", attachmentQuoteDraftId)
        .maybeSingle();

      if (quoteDraftError) {
        throw new Error(
          `Unable to load attached quote draft: ${quoteDraftError.message}`,
        );
      }

      if (!quoteDraft) {
        throw new Error(
          "Unable to mark attached quote draft sent because it was not found.",
        );
      }

      quoteDraftStatusAfter = "sent";
      const quoteDraftAttachment = attachments.find(
        (attachment) => attachment.quoteDraftId === attachmentQuoteDraftId,
      );
      const sentDocumentMetadata = quoteDraftAttachment
        ? {
            contentHash: quoteDraftAttachment.contentHash,
            contentType: quoteDraftAttachment.contentType,
            filename: quoteDraftAttachment.filename,
            generatedAt: quoteDraftAttachment.generatedAt ?? now,
            generatedDocumentId: quoteDraftAttachment.generatedDocumentId ?? null,
            quoteVersion: quoteDraftAttachment.quoteVersion ?? null,
            renderer: "pdf-lib",
            sizeBytes: quoteDraftAttachment.sizeBytes,
          }
        : null;
      const quoteMetadata = objectRecord(quoteDraft.metadata);
      const sentMetadata = markQuoteSentToCustomer({
        at: now,
        contentHash: quoteDraftAttachment?.contentHash ?? null,
        metadata: {
          ...quoteMetadata,
          lastGeneratedDocument: sentDocumentMetadata,
          sentAt: now,
          sentChannelType: channelType,
          sentDryRunAt: dryRun ? now : null,
          sentDryRunChannelType: dryRun ? channelType : null,
          sentDryRunMessageId: dryRun ? outboundRecordId : null,
          sentExternalAt: dryRun ? null : now,
          sentExternalMessageId: externalMessageId,
          sentExternalProvider: provider,
          sentMessageId: outboundRecordId,
        },
        source: activeRow.source,
      });
      const quoteVersion = quoteRevisionState(sentMetadata).currentVersion;
      const nextMetadata = appendQuoteDocumentHistory(sentMetadata, {
        actorType: "system",
        channelType,
        contentHash: quoteDraftAttachment?.contentHash ?? null,
        document: sentDocumentMetadata,
        kind: "email_sent",
        messageId: outboundRecordId,
        occurredAt: now,
        quoteVersion,
        sentTo,
        source: activeRow.source,
      });

      const { error: quoteDraftUpdateError } = await supabase
        .from("quote_drafts")
        .update({
          metadata: nextMetadata,
          status: quoteDraftStatusAfter,
        })
        .eq("workspace_id", activeRow.workspace_id)
        .eq("id", quoteDraft.id);

      if (quoteDraftUpdateError) {
        throw new Error(
          `Unable to mark attached quote draft sent: ${quoteDraftUpdateError.message}`,
        );
      }

      if (quoteDraftAttachment?.generatedDocumentId) {
        await markGeneratedDocumentSent(supabase, {
          generatedDocumentId: quoteDraftAttachment.generatedDocumentId,
          messageId: outboundRecordId,
          workspaceId: activeRow.workspace_id,
        });
      }
    }

    if (!dryRun) {
      const telephonyCost =
        channelType === "sms"
          ? telephonyUsageCost({
              direction: "outbound",
              kind: "sms",
              markupRate: await resolveWorkspaceUsageMarkupRate(
                supabase,
                activeRow.workspace_id,
                "TWILIO_MARKUP_RATE",
              ),
              providerCurrency: twilioSmsResult?.priceUnit,
              providerPrice: twilioSmsResult?.price
                ? Math.abs(twilioSmsResult.price)
                : null,
            })
          : null;
      const usageType =
        channelType === "sms" ? "outbound_sms" : "outbound_email";
      const usageService = channelType === "sms" ? "sms" : (externalService ?? "email");
      const usageCost = telephonyCost?.cost ?? 0;
      const usageMarkup = telephonyCost?.markup ?? 0;
      const usageCustomerCharge = telephonyCost?.customerCharge ?? 0;
      const usageCurrency = telephonyCost?.currency ?? "USD";

      await supabase.from("usage_events").insert({
        workspace_id: activeRow.workspace_id,
        user_id: activeRow.user_id,
        source_type: outboundRecordType,
        source_id: outboundRecordId,
        provider: provider ?? "external",
        service: usageService,
        model: null,
        usage_type: usageType,
        quantity: "1",
        unit: "message",
        unit_cost_snapshot: String(usageCost),
        markup_snapshot: String(usageMarkup),
        currency: usageCurrency,
        cost_snapshot: String(usageCost),
        customer_charge_snapshot: String(usageCustomerCharge),
        provider_usage_id: externalMessageId ?? providerRequestId,
        metadata: {
          billingTask:
            channelType === "sms" ? "sms_delivery" : "email_delivery",
          channelType,
          conversationId,
          deliveryMode,
          executor,
          externalService,
          attachments: attachmentMetadata,
          outboundRecordId,
          outboundRecordType,
          outboundQueueId: activeRow.id,
          source: activeRow.source,
          sentFrom,
          sentTo,
        },
      });
    }

    const result: RecordOutboundMessageResult = {
      outboundMessageId: outboundRecordId,
      outboundRecordId,
      outboundRecordType,
      conversationId: conversationId ?? "",
      previousConversationStatus: beforeStatus,
      channelType,
      attachmentQuoteDraftId,
      attachments: attachmentMetadata,
      attemptCount,
      channelId,
      outboundQueueId: activeRow.id,
      outboxStatus: "sent",
      providerRequestId,
      quoteDraftStatusAfter,
      quoteDraftStatusBefore,
      subject: textValue(activeRow.subject),
      dryRun,
      externalSend: !dryRun,
      externalMessageId,
      externalThreadId,
      provider,
      sentTo,
      executor,
      replayed: false,
    };

    const finalStatus = await markOutboundSent(
      supabase,
      activeRow,
      result,
      actorId,
    );

    return {
      ...result,
      outboxStatus: finalStatus,
    };
  } catch (error) {
    if (providerAccepted) {
      await markOutboundRecordFailed(supabase, activeRow, error, actorId);
    } else {
      await markOutboundFailed(
        supabase,
        activeRow,
        attemptCount,
        error,
        actorId,
      );
    }

    throw error;
  }
}

export async function recordOutboundMessage(
  supabase: SupabaseClient,
  input: RecordOutboundMessageInput,
): Promise<RecordOutboundMessageResult> {
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,status,contact_id,lead_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.conversationId)
    .maybeSingle();

  if (conversationError) {
    throw new Error(
      `Unable to load outbound conversation: ${conversationError.message}`,
    );
  }

  if (!conversation) {
    throw new Error(
      "Unable to record outbound message because the conversation was not found.",
    );
  }

  const body = textValue(input.body);

  if (!body) {
    throw new Error(
      "Unable to record outbound message because the body is empty.",
    );
  }

  const subject =
    input.channelType === "sms" || input.channelType === "phone"
      ? null
      : (textValue(input.subject) ?? "Follow-up");
  const idempotencyKey = buildIdempotencyKey(input);
  const existingRow = await loadOutboundQueueRowByIdempotency(
    supabase,
    input.workspaceId,
    idempotencyKey,
  );

  if (existingRow) {
    if (existingRow.status === "sent") {
      const stored = storedResultFromRow(existingRow);

      if (stored) {
        return stored;
      }

      throw new Error("This outbound message has already been sent.");
    }

    return deliverOutboundQueueItem(supabase, existingRow, input.userId);
  }

  const attachments = [...(input.attachments ?? [])];
  let quoteDraftStatusBefore: string | null = null;

  if (input.attachmentQuoteDraftId) {
    const { data, error } = await supabase
      .from("quote_drafts")
      .select("id,title,status,line_items,notes,metadata")
      .eq("workspace_id", input.workspaceId)
      .eq("conversation_id", input.conversationId)
      .eq("id", input.attachmentQuoteDraftId)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to load attached quote draft: ${error.message}`);
    }

    if (!data) {
      throw new Error("Unable to attach quote draft because it was not found.");
    }

    quoteDraftStatusBefore = String(data.status);
    const quoteDraftAttachment = await buildQuoteDraftAttachment(
      supabase,
      input.workspaceId,
      String(data.id),
      input.userId,
    );
    quoteDraftAttachment.quoteVersion = quoteRevisionState(
      objectRecord(data.metadata),
    ).currentVersion;
    attachments.unshift(quoteDraftAttachment);
  }

  const sentTo =
    input.channelType === "email"
      ? await loadEmailRecipient(supabase, {
          contactId: conversation.contact_id
            ? String(conversation.contact_id)
            : null,
          workspaceId: input.workspaceId,
        })
      : input.channelType === "sms"
        ? await loadPhoneRecipient(supabase, {
            contactId: conversation.contact_id
              ? String(conversation.contact_id)
              : null,
            workspaceId: input.workspaceId,
          })
        : null;

  if (input.channelType === "email" && !sentTo) {
    throw new Error(
      "This contact does not have an email address, so Kyro cannot send this reply.",
    );
  }

  if (input.channelType === "sms" && !sentTo) {
    throw new Error(
      "This contact does not have a phone number, so Kyro cannot send this SMS.",
    );
  }

  const storedAttachmentsForQueue = await persistOutboundAttachments({
    attachments,
    idempotencyKey,
    workspaceId: input.workspaceId,
  });

  const queued = await enqueueOutboundDelivery(supabase, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    conversationId: input.conversationId,
    actionId: input.actionId ?? null,
    channelType: input.channelType,
    recipient: sentTo,
    subject,
    body,
    htmlBody: input.htmlBody ?? null,
    attachments: storedAttachmentsForQueue,
    idempotencyKey,
    settingsSnapshot: input.settingsSnapshot ?? null,
    source: input.source,
    metadata: {
      attachmentQuoteDraftId: input.attachmentQuoteDraftId ?? null,
      attachmentSummary: attachmentSummary(storedAttachmentsForQueue),
      quoteDraftStatusBefore,
    },
  });

  if (queued.duplicate && queued.row.status === "sent") {
    const stored = storedResultFromRow(queued.row);

    if (stored) {
      return stored;
    }

    throw new Error("This outbound message has already been sent.");
  }

  return deliverOutboundQueueItem(supabase, queued.row, input.userId);
}

export async function recordOutboundEventEmail(
  supabase: SupabaseClient,
  input: RecordOutboundEventEmailInput,
): Promise<RecordOutboundMessageResult> {
  const body = textValue(input.body);
  const recipientEmail = textValue(input.recipientEmail);

  if (!body) {
    throw new Error(
      "Unable to record outbound email because the body is empty.",
    );
  }

  if (!recipientEmail) {
    throw new Error(
      "Unable to record outbound email because the recipient is empty.",
    );
  }

  const subject = textValue(input.subject) ?? "Follow-up";
  const idempotencyKey =
    textValue(input.idempotencyKey) ??
    `event.${input.eventId}.outbound.${crypto.randomUUID()}`;
  const existingRow = await loadOutboundQueueRowByIdempotency(
    supabase,
    input.workspaceId,
    idempotencyKey,
  );

  if (existingRow) {
    if (existingRow.status === "sent") {
      const stored = storedResultFromRow(existingRow);

      if (stored) {
        return stored;
      }

      throw new Error("This outbound email has already been sent.");
    }

    return deliverOutboundQueueItem(supabase, existingRow, input.userId);
  }

  const attachments = [...(input.attachments ?? [])];
  const storedAttachmentsForQueue = await persistOutboundAttachments({
    attachments,
    idempotencyKey,
    workspaceId: input.workspaceId,
  });
  const queued = await enqueueOutboundDelivery(supabase, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    conversationId: null,
    eventId: input.eventId,
    channelType: "email",
    recipient: recipientEmail,
    subject,
    body,
    htmlBody: input.htmlBody ?? null,
    attachments: storedAttachmentsForQueue,
    idempotencyKey,
    settingsSnapshot: input.settingsSnapshot ?? null,
    source: input.source,
    metadata: {
      attachmentSummary: attachmentSummary(storedAttachmentsForQueue),
      deliveryMode: "event",
      originalEventId: input.eventId,
      replyEventPayload: input.replyEventPayload ?? {},
      replyEventType:
        textValue(input.replyEventType) ?? "outbound.filtered_email.reply_sent",
    },
  });

  return deliverOutboundQueueItem(supabase, queued.row, input.userId);
}

export async function retryOutboundMessage(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    outboundQueueId: string;
    userId: string;
  },
) {
  const row = await loadOutboundQueueRow(
    supabase,
    input.workspaceId,
    input.outboundQueueId,
  );

  return deliverOutboundQueueItem(supabase, row, input.userId);
}

export async function processDueOutboundMessages(
  supabase: SupabaseClient,
  options: {
    limit?: number;
    workspaceId?: string | null;
  } = {},
) {
  const now = Date.now();
  let query = supabase
    .from("outbound_messages")
    .select("*")
    .in("status", ["queued", "retry_scheduled"])
    .order("next_attempt_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(
      Math.max(
        options.limit ?? SCHEDULED_PROCESS_LIMIT,
        SCHEDULED_PROCESS_LIMIT,
      ),
    );

  if (options.workspaceId) {
    query = query.eq("workspace_id", options.workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load due outbound deliveries: ${error.message}`);
  }

  const dueRows = ((data ?? []) as OutboundQueueRow[])
    .filter((row) => {
      if (!row.next_attempt_at) {
        return true;
      }

      return new Date(row.next_attempt_at).getTime() <= now;
    })
    .slice(0, options.limit ?? SCHEDULED_PROCESS_LIMIT);
  const results = [];

  for (const row of dueRows) {
    try {
      const result = await deliverOutboundQueueItem(supabase, row, row.user_id);

      results.push({
        ok: true,
        outboundQueueId: row.id,
        result,
        workspaceId: row.workspace_id,
      });
    } catch (error) {
      results.push({
        error: errorMessage(error),
        ok: false,
        outboundQueueId: row.id,
        workspaceId: row.workspace_id,
      });
    }
  }

  return {
    processedCount: results.length,
    results,
  };
}

export const recordOutboundDryRunMessage = recordOutboundMessage;
