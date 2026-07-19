import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicAppUrl } from "../app-url";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import { recordOutboundDirectSms } from "../communication/outbound";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import {
  getActiveWorkspaceSmsNumber,
  getTwilioConfig,
} from "../integrations/twilio";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";

type InquiryNotificationOutcome = "booked" | "captured" | "proposed";

export type InquiryNotificationChannel =
  | "email"
  | "phone"
  | "sms"
  | "voicemail";

type InquiryNotificationInput = {
  channel?: InquiryNotificationChannel;
  contactName?: string | null;
  conversationId?: string | null;
  eventLabel?: string | null;
  outcome?: InquiryNotificationOutcome;
  providerCallId?: string | null;
  sourceId?: string | null;
  summary: string;
  supabase: SupabaseClient;
  voiceCallId?: string | null;
  workspaceId: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();

  return clean.length <= maxLength
    ? clean
    : `${clean.slice(0, maxLength - 1).trim()}...`;
}

function samePhoneNumber(left: string | null, right: string) {
  const leftDigits = left?.replace(/\D/g, "") ?? "";
  const rightDigits = right.replace(/\D/g, "");

  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

async function primaryNotificationRecipient(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const [settings, workspaceResult] = await Promise.all([
    getWorkspaceGeneralSettings(supabase, workspaceId),
    supabase
      .from("workspaces")
      .select("owner_user_id")
      .eq("id", workspaceId)
      .maybeSingle(),
  ]);
  const contacts = settings.businessProfile.workplaceContacts;
  const configured =
    contacts.find((contact) => contact.primaryEscalationContact) ??
    contacts.find((contact) => contact.receivesEscalations) ??
    contacts[0] ??
    null;
  const configuredPhone = configured
    ? (textValue(configured.privatePhoneNumber) ??
      textValue(configured.phoneNumber))
    : null;

  if (configuredPhone) {
    return {
      contactId: configured?.id ?? null,
      name: textValue(configured?.name) ?? "Primary workplace contact",
      phoneNumber:
        normalizeContactPhoneForRegion(
          configuredPhone,
          settings.defaultPhoneRegion,
        ) ?? configuredPhone,
      userId: textValue(workspaceResult.data?.owner_user_id),
    };
  }

  const ownerUserId = textValue(workspaceResult.data?.owner_user_id);
  const owner = ownerUserId
    ? await supabase.auth.admin.getUserById(ownerUserId)
    : null;
  const metadata = owner?.data.user?.user_metadata ?? {};
  const ownerPhone =
    textValue(metadata.kyroMobileNumber) ??
    textValue(metadata.phone) ??
    textValue(settings.businessProfile.publicPhoneNumber);

  if (!ownerPhone) {
    return null;
  }

  return {
    contactId: null,
    name:
      textValue(metadata.first_name) ??
      textValue(metadata.name) ??
      textValue(metadata.full_name) ??
      "Workspace owner",
    phoneNumber:
      normalizeContactPhoneForRegion(ownerPhone, settings.defaultPhoneRegion) ??
      ownerPhone,
    userId: ownerUserId,
  };
}

function channelLabel(channel: InquiryNotificationChannel) {
  if (channel === "email") {
    return "email";
  }

  if (channel === "sms") {
    return "SMS";
  }

  if (channel === "voicemail") {
    return "voicemail";
  }

  return "phone";
}

export function buildInboundInquiryNotificationBody(
  input: Pick<
    InquiryNotificationInput,
    | "channel"
    | "contactName"
    | "conversationId"
    | "eventLabel"
    | "outcome"
    | "summary"
  >,
) {
  const caller = textValue(input.contactName) ?? "A caller";
  const channel = input.channel ?? "phone";
  const outcome = input.outcome ?? "captured";
  const status =
    outcome === "booked"
      ? `Kyro booked ${textValue(input.eventLabel) ?? "a calendar time"}.`
      : outcome === "proposed"
        ? `Kyro prepared ${textValue(input.eventLabel) ?? "a draft calendar time"} for approval.`
        : "Kyro captured the inquiry for review.";
  const path = input.conversationId
    ? `/inbox?conversationId=${encodeURIComponent(input.conversationId)}`
    : "/inbox";

  return compactText(
    `New Kyro ${channelLabel(channel)} inquiry from ${caller}. ${compactText(input.summary, 180)} ${status} ${getPublicAppUrl()}${path}`,
    420,
  );
}

async function recordNotificationEvent(
  input: InquiryNotificationInput,
  details: {
    error?: string | null;
    outboundQueueId?: string | null;
    providerMessageId?: string | null;
    reason?: string | null;
    recipientName?: string | null;
    status: "failed" | "processed";
    type: string;
  },
) {
  const channel = input.channel ?? "phone";
  const sourceId =
    textValue(input.sourceId) ??
    textValue(input.voiceCallId) ??
    textValue(input.providerCallId) ??
    textValue(input.conversationId) ??
    "unknown";
  const now = new Date().toISOString();
  const { error } = await input.supabase.from("events").insert({
    idempotency_key: `${details.type}.${channel}.${sourceId}`,
    payload: {
      channel,
      conversationId: input.conversationId ?? null,
      error: details.error ?? null,
      outboundQueueId: details.outboundQueueId ?? null,
      outcome: input.outcome ?? "captured",
      providerCallId: input.providerCallId ?? null,
      providerMessageId: details.providerMessageId ?? null,
      reason: details.reason ?? null,
      recipientName: details.recipientName ?? null,
      sourceId,
      voiceCallId: input.voiceCallId ?? null,
    },
    processed_at: now,
    source: "kyro.inbound_inquiry_notification",
    status: details.status,
    type: details.type,
    workspace_id: input.workspaceId,
  });

  if (error && error.code !== "23505") {
    throw new Error(
      `Unable to record inbound inquiry notification event: ${error.message}`,
    );
  }

  return error?.code !== "23505";
}

async function recordSkippedNotification(
  input: InquiryNotificationInput,
  reason: string,
) {
  await recordNotificationEvent(input, {
    reason,
    status: "processed",
    type: `notification.inbound_inquiry.skipped.${reason}`,
  });
}

export async function notifyInboundInquiry(
  input: InquiryNotificationInput,
) {
  await assertWorkspaceAutomationAllowed(input.workspaceId);
  const recipient = await primaryNotificationRecipient(
    input.supabase,
    input.workspaceId,
  );

  if (!recipient) {
    await recordSkippedNotification(input, "recipient_missing");
    return { notified: false, reason: "recipient_missing" } as const;
  }

  const workspaceNumber = await getActiveWorkspaceSmsNumber(
    input.supabase,
    input.workspaceId,
  );
  const from =
    workspaceNumber?.phoneNumber ??
    getTwilioConfig()?.defaultFromNumber ??
    null;

  if (samePhoneNumber(from, recipient.phoneNumber)) {
    await recordSkippedNotification(input, "recipient_is_workspace_number");
    return {
      notified: false,
      reason: "recipient_is_workspace_number",
    } as const;
  }

  if (!recipient.userId) {
    await recordSkippedNotification(input, "workspace_owner_missing");
    return { notified: false, reason: "workspace_owner_missing" } as const;
  }

  const channel = input.channel ?? "phone";
  const sourceId =
    textValue(input.sourceId) ??
    textValue(input.voiceCallId) ??
    textValue(input.providerCallId) ??
    textValue(input.conversationId) ??
    "unknown";
  let result: Awaited<ReturnType<typeof recordOutboundDirectSms>>;

  try {
    result = await recordOutboundDirectSms(input.supabase, {
      body: buildInboundInquiryNotificationBody(input),
      consentNote: "Primary workplace contact for inbound Kyro inquiries.",
      idempotencyKey: `inbound_inquiry_notification.${input.workspaceId}.${channel}.${sourceId}`,
      metadata: {
        conversationId: input.conversationId ?? null,
        inquiryChannel: channel,
        notificationType: "inbound_inquiry",
        outcome: input.outcome ?? "captured",
        providerCallId: input.providerCallId ?? null,
        sourceId,
        voiceCallId: input.voiceCallId ?? null,
      },
      recipientName: recipient.name,
      recipientPhone: recipient.phoneNumber,
      replyEventPayload: {
        conversationId: input.conversationId ?? null,
        inquiryChannel: channel,
        outcome: input.outcome ?? "captured",
        providerCallId: input.providerCallId ?? null,
        sourceId,
        voiceCallId: input.voiceCallId ?? null,
      },
      replyEventType: "outbound.inbound_inquiry_notification.sent",
      source: "inbound_inquiry_notification",
      userId: recipient.userId,
      workplaceContactId: recipient.contactId,
      workspaceId: input.workspaceId,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown notification error";

    await recordNotificationEvent(input, {
      error: errorMessage,
      recipientName: recipient.name,
      status: "failed",
      type: "notification.inbound_inquiry.failed",
    });
    throw error;
  }

  const providerMessageId = result.externalMessageId ?? null;
  const recorded = await recordNotificationEvent(input, {
    outboundQueueId: result.outboundQueueId,
    providerMessageId,
    recipientName: recipient.name,
    status: "processed",
    type: "notification.inbound_inquiry.sent",
  });

  if (!recorded) {
    return { notified: false, reason: "duplicate" } as const;
  }

  if (input.voiceCallId) {
    const { error: voiceEventError } = await input.supabase
      .from("voice_call_events")
      .insert({
        event_type: "notification.inbound_inquiry.sent",
        payload: {
          channel,
          conversationId: input.conversationId ?? null,
          outboundQueueId: result.outboundQueueId,
          outboxStatus: result.outboxStatus,
          outcome: input.outcome ?? "captured",
          providerCallId: input.providerCallId ?? null,
          providerMessageId,
          recipientName: recipient.name,
          sourceId,
        },
        provider: "kyro",
        voice_call_id: input.voiceCallId,
        workspace_id: input.workspaceId,
      });

    if (voiceEventError) {
      throw new Error(
        `Unable to record inbound voice notification: ${voiceEventError.message}`,
      );
    }
  }

  return {
    notified: true,
    outboundQueueId: result.outboundQueueId,
    providerMessageId,
  } as const;
}

export async function notifyInboundVoiceInquiry(
  input: Omit<InquiryNotificationInput, "channel">,
) {
  return notifyInboundInquiry({
    ...input,
    channel: "phone",
  });
}
