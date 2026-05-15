import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGmailMessage, type GmailAttachment } from "../integrations/gmail";
import { isOutboundChannel, type OutboundChannel } from "./settings";

export type OutboundAttachment = GmailAttachment & {
  quoteDraftId?: string | null;
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

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
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

function realChannelDisplayName(accountEmail: string | null) {
  return accountEmail ? `Gmail - ${accountEmail}` : "Gmail";
}

function safeAttachmentBaseName(value: string) {
  const clean = value
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return clean || "quote-draft";
}

function quoteLineSummary(item: unknown, index: number) {
  const row = objectRecord(item);
  const description = textValue(row.description) ?? `Line item ${index + 1}`;
  const quantity = row.quantity === null || row.quantity === undefined
    ? null
    : String(row.quantity);
  const unit = textValue(row.unit);
  const unitPrice = row.unitPrice === null || row.unitPrice === undefined
    ? null
    : String(row.unitPrice);
  const total = row.total === null || row.total === undefined
    ? null
    : String(row.total);

  return [
    `- ${description}`,
    quantity || unit ? `qty: ${[quantity, unit].filter(Boolean).join(" ")}` : null,
    unitPrice ? `unit: ${unitPrice}` : null,
    total ? `total: ${total}` : null,
    textValue(row.notes) ? `notes: ${textValue(row.notes)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function buildQuoteDraftAttachment(quoteDraft: {
  id: string;
  line_items: unknown;
  metadata: unknown;
  notes: string | null;
  status: string;
  title: string;
}): OutboundAttachment {
  const lineItems = arrayValue(quoteDraft.line_items);
  const metadata = objectRecord(quoteDraft.metadata);
  const rendered = [
    quoteDraft.title,
    "",
    `Status: ${quoteDraft.status}`,
    textValue(metadata.customerName) ? `Customer: ${textValue(metadata.customerName)}` : null,
    textValue(metadata.jobAddress) ? `Job address: ${textValue(metadata.jobAddress)}` : null,
    textValue(metadata.jobType) ? `Job type: ${textValue(metadata.jobType)}` : null,
    "",
    "Line items:",
    ...(lineItems.length > 0
      ? lineItems.map((item, index) => quoteLineSummary(item, index))
      : ["- No line items recorded yet."]),
    quoteDraft.notes ? "" : null,
    quoteDraft.notes ? "Notes:" : null,
    quoteDraft.notes,
  ]
    .filter((line): line is string => line !== null && line !== undefined)
    .join("\n");
  const content = Buffer.from(rendered, "utf8");

  return {
    contentBase64: content.toString("base64"),
    contentType: "text/plain",
    filename: `${safeAttachmentBaseName(quoteDraft.title)}.txt`,
    quoteDraftId: quoteDraft.id,
    sizeBytes: content.byteLength,
    source: "quote_draft",
  };
}

function attachmentSummary(attachments: OutboundAttachment[]) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    quoteDraftId: attachment.quoteDraftId ?? null,
    sizeBytes: attachment.sizeBytes,
    source: attachment.source,
  }));
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

async function findOrCreateGmailOutboundChannel(
  supabase: SupabaseClient,
  {
    accountEmail,
    connectionId,
    workspaceId,
  }: {
    accountEmail: string | null;
    connectionId: string;
    workspaceId: string;
  }
) {
  const externalId = `google:gmail:${accountEmail ?? connectionId}`;
  const payload = {
    workspace_id: workspaceId,
    integration_id: connectionId,
    type: "email",
    display_name: realChannelDisplayName(accountEmail),
    external_id: externalId,
    status: "active",
    settings: {
      provider: "google",
      service: "gmail",
      connectionId,
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
    throw new Error(`Unable to load Gmail outbound channel: ${existingError.message}`);
  }

  if (existingChannel) {
    const { error } = await supabase
      .from("channels")
      .update(payload)
      .eq("workspace_id", workspaceId)
      .eq("id", existingChannel.id);

    if (error) {
      throw new Error(`Unable to update Gmail outbound channel: ${error.message}`);
    }

    return String(existingChannel.id);
  }

  const { data: channel, error } = await supabase
    .from("channels")
    .insert(payload)
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(`Unable to create Gmail outbound channel: ${error?.message ?? "unknown error"}`);
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
  let channelId: string;
  let dryRun = true;
  let executor = "mock_outbound_channel";
  let externalMessageId: string | null = null;
  let externalThreadId: string | null = null;
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
    attachments.unshift(buildQuoteDraftAttachment(quoteDraft));
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
      throw new Error("This contact does not have an email address, so Gmail cannot send this reply.");
    }

    const gmailResult = await sendGmailMessage(supabase, {
      attachments,
      body,
      htmlBody: input.htmlBody ?? null,
      subject: subject ?? "Follow-up",
      to: recipientEmail,
      workspaceId: input.workspaceId
    });

    channelId = await findOrCreateGmailOutboundChannel(supabase, {
      accountEmail: gmailResult.accountEmail,
      connectionId: gmailResult.connectionId,
      workspaceId: input.workspaceId
    });
    dryRun = false;
    executor = "gmail_api";
    externalMessageId = gmailResult.messageId;
    externalThreadId = gmailResult.threadId;
    provider = "google";
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

    const { error: quoteDraftUpdateError } = await supabase
      .from("quote_drafts")
      .update({
        metadata: {
          ...objectRecord(quoteDraft.metadata),
          sentAt: now,
          sentChannelType: input.channelType,
          sentDryRunAt: dryRun ? now : null,
          sentDryRunChannelType: dryRun ? input.channelType : null,
          sentDryRunMessageId: dryRun ? message.id : null,
          sentExternalAt: dryRun ? null : now,
          sentExternalMessageId: externalMessageId,
          sentExternalProvider: provider,
          sentMessageId: message.id
        },
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
      service: "gmail",
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
