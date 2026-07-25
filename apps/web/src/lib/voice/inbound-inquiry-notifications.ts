import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicAppUrl } from "../app-url";
import {
  appendRealtimeAssistantMessage,
  getOrCreateInternalMessagingThread,
} from "../assistant/persistence";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import { recordOutboundDirectSms } from "../communication/outbound";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import {
  getActiveWorkspaceSmsNumber,
  getTwilioConfig,
  twilioMessageTransportForWorkspace,
} from "../integrations/twilio";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";

type InquiryNotificationOutcome = "booked" | "captured" | "proposed";

export type InquiryNotificationChannel =
  | "email"
  | "phone"
  | "sms"
  | "voicemail";

type InquiryNotificationInput = {
  autoReplySent?: boolean;
  channel?: InquiryNotificationChannel;
  contactName?: string | null;
  contactPhone?: string | null;
  conversationId?: string | null;
  eventLabel?: string | null;
  missingInfo?: string[];
  outcome?: InquiryNotificationOutcome;
  ownerQuestion?: string | null;
  preferredTime?: string | null;
  preparedReplyAvailable?: boolean;
  providerCallId?: string | null;
  recommendedAction?: string | null;
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
      .select("name,owner_user_id")
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
      workspaceName: textValue(workspaceResult.data?.name) ?? "Kyro workspace",
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
    workspaceName: textValue(workspaceResult.data?.name) ?? "Kyro workspace",
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
    | "autoReplySent"
    | "channel"
    | "contactName"
    | "contactPhone"
    | "conversationId"
    | "eventLabel"
    | "missingInfo"
    | "outcome"
    | "ownerQuestion"
    | "preferredTime"
    | "preparedReplyAvailable"
    | "recommendedAction"
    | "summary"
  >,
) {
  const caller = textValue(input.contactName) ?? "A new contact";
  const channel = input.channel ?? "phone";
  const outcome = input.outcome ?? "captured";
  const missingInfo = [...new Set(input.missingInfo ?? [])]
    .map((item) => textValue(item))
    .filter((item): item is string => Boolean(item));
  const preferredTime = textValue(input.preferredTime);
  const eventLabel = textValue(input.eventLabel);
  const modelRecommendation = textValue(input.recommendedAction);
  const ownerQuestion = textValue(input.ownerQuestion);
  if (ownerQuestion) {
    return [
      `New ${channelLabel(channel)} inquiry - ${caller}`,
      `Summary: ${compactText(input.summary, 190)}`,
      `I need from you: ${ownerQuestion}`,
      "Reply here with the answer and I'll finish the customer response.",
      textValue(input.contactPhone) ? `Call: ${input.contactPhone}` : null,
      `Open in Kyro: ${buildInboundInquiryLink(input.conversationId)}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }
  const recommendation = input.autoReplySent
    ? "Kyro answered this using the public business details saved in the workspace."
    : modelRecommendation
    ? modelRecommendation
    : outcome === "booked"
      ? `The booking is set for ${eventLabel ?? "the agreed time"}.`
      : outcome === "proposed"
        ? `Review the proposed ${eventLabel ?? "booking time"}.`
        : missingInfo.length > 0
          ? `${preferredTime ? `Confirm ${preferredTime} and ask for` : "Ask for"} ${humanList(
              missingInfo.map(notificationFactLabel),
            )}.`
          : "Review the prepared response and follow up while the inquiry is fresh.";
  const action = input.autoReplySent
    ? null
    : input.preparedReplyAvailable
    ? "Reply SEND IT and I'll send the prepared response."
    : outcome === "booked"
      ? null
      : "Reply here if you want me to help with the next step.";
  const contactPhone = textValue(input.contactPhone);

  return [
    `New ${channelLabel(channel)} inquiry - ${caller}`,
    `Summary: ${compactText(input.summary, 190)}`,
    `I recommend: ${recommendation}`,
    action,
    contactPhone ? `Call: ${contactPhone}` : null,
    `Open in Kyro: ${buildInboundInquiryLink(input.conversationId)}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function notificationFactLabel(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "preferred time") {
    return "a suitable day and time";
  }

  if (normalized === "job address") {
    return "the job address";
  }

  if (normalized === "phone number") {
    return "a callback number";
  }

  if (normalized === "email address") {
    return "an email address";
  }

  if (normalized === "job type") {
    return "the job details";
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

function humanList(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "the remaining details";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function buildInboundInquiryLink(conversationId?: string | null) {
  const query = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";

  return `${getPublicAppUrl()}/open/inbox${query}`;
}

async function saveInquiryBriefingToFieldThread(
  input: InquiryNotificationInput,
  recipient: {
    name: string;
    phoneNumber: string;
    userId: string | null;
    workspaceName: string;
  },
  body: string,
) {
  if (!recipient.userId || !input.conversationId) {
    return;
  }

  const { data, error } = await input.supabase.auth.admin.getUserById(
    recipient.userId,
  );

  if (error || !data.user) {
    throw new Error(
      `Unable to load notification recipient for assistant context: ${error?.message ?? "unknown error"}`,
    );
  }

  const thread = await getOrCreateInternalMessagingThread(
    input.supabase,
    {
      id: input.workspaceId,
      name: recipient.workspaceName,
    },
    data.user,
    {
      displayName: recipient.name,
      senderPhone: recipient.phoneNumber,
    },
  );
  const contactName = textValue(input.contactName) ?? "New inquiry";

  await appendRealtimeAssistantMessage({
    content: body,
    intent: input.ownerQuestion ? "inquiry_owner_question" : "work_queue",
    links: [
      {
        href: `/inbox?conversationId=${encodeURIComponent(input.conversationId)}`,
        label: contactName,
        meta: "New inquiry",
      },
    ],
    model: "notification-template-v1",
    provider: "kyro",
    source: "assistant.inbound_inquiry_notification",
    supabase: input.supabase,
    threadId: String(thread.id),
    uiBlocks: [
      {
        items: [
          {
            detail:
              textValue(input.ownerQuestion) ?? "Prepared response ready",
            href: `/inbox?conversationId=${encodeURIComponent(input.conversationId)}`,
            id: input.conversationId,
            label: contactName,
            status: input.ownerQuestion ? "Needs your input" : "Needs review",
          },
        ],
        title: "New inquiry",
        type: "approval_queue",
      },
    ],
    user: data.user,
    workspaceId: input.workspaceId,
  });
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

export async function notifyInboundInquiry(input: InquiryNotificationInput) {
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
  const notificationBody = buildInboundInquiryNotificationBody(input);
  const transport = twilioMessageTransportForWorkspace({
    recipientPhone: recipient.phoneNumber,
    workspaceId: input.workspaceId,
  });

  try {
    result = await recordOutboundDirectSms(input.supabase, {
      body: notificationBody,
      consentNote: "Primary workplace contact for inbound Kyro inquiries.",
      idempotencyKey: `inbound_inquiry_notification.${input.workspaceId}.${channel}.${sourceId}`,
      metadata: {
        conversationId: input.conversationId ?? null,
        inquiryChannel: channel,
        notificationType: "inbound_inquiry",
        outcome: input.outcome ?? "captured",
        providerCallId: input.providerCallId ?? null,
        sourceId,
        transport,
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
      transport,
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

  await saveInquiryBriefingToFieldThread(
    input,
    recipient,
    notificationBody,
  ).catch((contextError) => {
    console.error("Unable to save inbound inquiry assistant context", {
      conversationId: input.conversationId,
      error:
        contextError instanceof Error
          ? contextError.message
          : "Unknown assistant context error",
      workspaceId: input.workspaceId,
    });
  });

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
