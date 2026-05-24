import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendConnectedEmailMessage,
  type EmailAttachment,
  type EmailSendResult,
} from "../integrations/mail";
import { buildQuotePdfArtifactForDraft } from "../documents/pdf";
import {
  appendQuoteDocumentHistory,
} from "../documents/history";
import {
  markQuoteSentToCustomer,
  quoteRevisionState,
} from "../documents/revisions";
import { isOutboundChannel, type OutboundChannel } from "./settings";

export type OutboundAttachment = EmailAttachment & {
  contentHash?: string | null;
  generatedAt?: string | null;
  quoteDraftId?: string | null;
  quoteVersion?: number | null;
  source: "local_upload" | "quote_draft" | "signature_logo";
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
  settingsSnapshot?: Record<string, unknown> | null;
};

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
    quoteDraftId: string | null;
    sizeBytes: number;
    source: string;
  }>;
  outboundMessageId: string;
  previousConversationStatus: string;
  provider: string | null;
  quoteDraftStatusAfter: string | null;
  quoteDraftStatusBefore: string | null;
  sentTo: string | null;
  subject: string | null;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function displayChannelName(channelType: OutboundChannel) {
  if (channelType === "sms") {
    return "Mock SMS";
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

function attachmentSummary(attachments: OutboundAttachment[]) {
  return attachments.map((attachment) => ({
    contentHash: attachment.contentHash ?? null,
    contentType: attachment.contentType,
    filename: attachment.filename,
    generatedAt: attachment.generatedAt ?? null,
    quoteDraftId: attachment.quoteDraftId ?? null,
    quoteVersion: attachment.quoteVersion ?? null,
    sizeBytes: attachment.sizeBytes,
    source: attachment.source,
  }));
}

async function buildQuoteDraftAttachment(
  supabase: SupabaseClient,
  workspaceId: string,
  quoteDraftId: string,
): Promise<OutboundAttachment> {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  const artifact = await buildQuotePdfArtifactForDraft(supabase, {
    quoteDraftId,
    workspace: {
      id: workspaceId,
      name: textValue(workspace?.name) ?? "Kyro workspace",
    },
  });

  return {
    contentBase64: artifact.contentBase64,
    contentHash: artifact.contentHash,
    contentType: artifact.contentType,
    filename: artifact.filename,
    generatedAt: artifact.generatedAt,
    quoteDraftId,
    sizeBytes: artifact.sizeBytes,
    source: "quote_draft",
  };
}

export async function findOrCreateMockOutboundChannel(
  supabase: SupabaseClient,
  workspaceId: string,
  channelType: string
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
    throw new Error(`Unable to load mock outbound channel: ${existingError.message}`);
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
        source: "mock_outbound"
      }
    })
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(`Unable to create mock outbound channel: ${error?.message ?? "unknown error"}`);
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
  }
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
      externalSendEnabled: true
    }
  };
  const { data: existingChannel, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to load email outbound channel: ${existingError.message}`);
  }

  if (existingChannel) {
    const { error } = await supabase
      .from("channels")
      .update(payload)
      .eq("workspace_id", workspaceId)
      .eq("id", existingChannel.id);

    if (error) {
      throw new Error(`Unable to update email outbound channel: ${error.message}`);
    }

    return String(existingChannel.id);
  }

  const { data: channel, error } = await supabase
    .from("channels")
    .insert(payload)
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(`Unable to create email outbound channel: ${error?.message ?? "unknown error"}`);
  }

  return String(channel.id);
}

export async function recordOutboundMessage(
  supabase: SupabaseClient,
  input: RecordOutboundMessageInput
): Promise<RecordOutboundMessageResult> {
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,status,contact_id,lead_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.conversationId)
    .maybeSingle();

  if (conversationError) {
    throw new Error(`Unable to load outbound conversation: ${conversationError.message}`);
  }

  if (!conversation) {
    throw new Error("Unable to record outbound message because the conversation was not found.");
  }

  const body = textValue(input.body);

  if (!body) {
    throw new Error("Unable to record outbound message because the body is empty.");
  }

  const now = new Date().toISOString();
  const subject = input.channelType === "sms" || input.channelType === "phone"
    ? null
    : (textValue(input.subject) ?? "Follow-up");
  let quoteDraft:
    | {
        id: string;
        line_items: unknown;
        metadata: unknown;
        notes: string | null;
        status: string;
        title: string;
      }
    | null = null;
  let quoteDraftStatusBefore: string | null = null;
  let quoteDraftStatusAfter: string | null = null;
  const attachments = [...(input.attachments ?? [])];
  let quoteDraftAttachment: OutboundAttachment | null = null;
  let channelId: string;
  let dryRun = true;
  let executor = "mock_outbound_channel";
  let externalMessageId: string | null = null;
  let externalThreadId: string | null = null;
  let externalService: string | null = null;
  let provider: string | null = null;
  let sentTo: string | null = null;

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

    quoteDraft = {
      id: String(data.id),
      line_items: data.line_items,
      metadata: data.metadata,
      notes: textValue(data.notes),
      status: String(data.status),
      title: String(data.title),
    };
    quoteDraftStatusBefore = quoteDraft.status;
    quoteDraftAttachment = await buildQuoteDraftAttachment(
      supabase,
      input.workspaceId,
      quoteDraft.id,
    );
    quoteDraftAttachment.quoteVersion = quoteRevisionState(
      objectRecord(quoteDraft.metadata),
    ).currentVersion;
    attachments.unshift(quoteDraftAttachment);
  }

  const attachmentMetadata = attachmentSummary(attachments);

  if (input.channelType === "email") {
    const { data: contact, error: contactError } = conversation.contact_id
      ? await supabase
          .from("contacts")
          .select("email")
          .eq("workspace_id", input.workspaceId)
          .eq("id", conversation.contact_id)
          .maybeSingle()
      : { data: null, error: null };

    if (contactError) {
      throw new Error(`Unable to load email recipient: ${contactError.message}`);
    }

    const recipientEmail = textValue(contact?.email);

    if (!recipientEmail) {
      throw new Error("This contact does not have an email address, so Kyro cannot send this reply.");
    }

    const emailResult = await sendConnectedEmailMessage(supabase, {
      attachments,
      body,
      htmlBody: input.htmlBody ?? null,
      subject: subject ?? "Follow-up",
      to: recipientEmail,
      workspaceId: input.workspaceId
    });

    channelId = await findOrCreateEmailOutboundChannel(supabase, {
      result: emailResult,
      workspaceId: input.workspaceId
    });
    dryRun = false;
    executor = `${emailResult.service}_api`;
    externalMessageId = emailResult.messageId;
    externalThreadId = emailResult.threadId;
    externalService = emailResult.service;
    provider = emailResult.provider;
    sentTo = recipientEmail;
  } else {
    channelId = await findOrCreateMockOutboundChannel(
      supabase,
      input.workspaceId,
      input.channelType
    );
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      channel_id: channelId,
      contact_id: conversation.contact_id ?? null,
      direction: "outbound",
      subject,
      body_text: body,
      external_message_id: externalMessageId,
      sent_at: now,
      metadata: {
        source: input.source,
        actionId: input.actionId ?? null,
        attachmentQuoteDraftId: input.attachmentQuoteDraftId ?? null,
        attachments: attachmentMetadata,
        channelType: input.channelType,
        dryRun,
        externalSend: !dryRun,
        externalService,
        externalThreadId,
        htmlBodyAvailable: Boolean(input.htmlBody),
        provider,
        requestedByUserId: input.userId,
        sentTo,
        settingsSnapshot: input.settingsSnapshot ?? null
      }
    })
    .select("id")
    .single();

  if (messageError || !message) {
    throw new Error(
      `Unable to record outbound message: ${messageError?.message ?? "unknown error"}`
    );
  }

  const beforeStatus = String(conversation.status);
  const { error: conversationUpdateError } = await supabase
    .from("conversations")
    .update({
      status: "replied",
      last_message_at: now
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.conversationId);

  if (conversationUpdateError) {
    throw new Error(`Unable to update conversation after outbound: ${conversationUpdateError.message}`);
  }

  if (input.attachmentQuoteDraftId && quoteDraft) {
    quoteDraftStatusAfter = "sent";
    const sentDocumentMetadata = quoteDraftAttachment
      ? {
          contentHash: quoteDraftAttachment.contentHash,
          contentType: quoteDraftAttachment.contentType,
          filename: quoteDraftAttachment.filename,
          generatedAt: quoteDraftAttachment.generatedAt ?? now,
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
        sentChannelType: input.channelType,
        sentDryRunAt: dryRun ? now : null,
        sentDryRunChannelType: dryRun ? input.channelType : null,
        sentDryRunMessageId: dryRun ? message.id : null,
        sentExternalAt: dryRun ? null : now,
        sentExternalMessageId: externalMessageId,
        sentExternalProvider: provider,
        sentMessageId: message.id,
      },
      source: input.source,
    });
    const quoteVersion = quoteRevisionState(sentMetadata).currentVersion;
    const nextMetadata = appendQuoteDocumentHistory(
      sentMetadata,
      {
        actorType: "system",
        channelType: input.channelType,
        contentHash: quoteDraftAttachment?.contentHash ?? null,
        document: sentDocumentMetadata,
        kind: "email_sent",
        messageId: String(message.id),
        occurredAt: now,
        quoteVersion,
        sentTo,
        source: input.source,
      },
    );

    const { error: quoteDraftUpdateError } = await supabase
      .from("quote_drafts")
      .update({
        metadata: nextMetadata,
        status: quoteDraftStatusAfter
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", quoteDraft.id);

    if (quoteDraftUpdateError) {
      throw new Error(
        `Unable to mark attached quote draft sent: ${quoteDraftUpdateError.message}`
      );
    }
  }

  if (!dryRun) {
    await supabase.from("usage_events").insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      source_type: "message",
      source_id: message.id,
      provider: provider ?? "external",
      service: externalService ?? "email",
      model: null,
      usage_type: "outbound_email",
      quantity: "1",
      unit: "message",
      unit_cost_snapshot: "0",
      markup_snapshot: "0",
      currency: "USD",
      cost_snapshot: "0",
      customer_charge_snapshot: "0",
      provider_usage_id: externalMessageId,
      metadata: {
        channelType: input.channelType,
        conversationId: input.conversationId,
        executor,
        externalService,
        attachments: attachmentMetadata,
        source: input.source,
        sentTo
      }
    });
  }

  return {
    outboundMessageId: String(message.id),
    conversationId: input.conversationId,
    previousConversationStatus: beforeStatus,
    channelType: input.channelType,
    attachmentQuoteDraftId: input.attachmentQuoteDraftId ?? null,
    attachments: attachmentMetadata,
    channelId,
    quoteDraftStatusAfter,
    quoteDraftStatusBefore,
    subject,
    dryRun,
    externalSend: !dryRun,
    externalMessageId,
    externalThreadId,
    provider,
    sentTo,
    executor
  };
}

export const recordOutboundDryRunMessage = recordOutboundMessage;
