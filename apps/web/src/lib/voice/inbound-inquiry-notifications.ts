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

type InquiryNotificationInput = {
  contactName?: string | null;
  conversationId?: string | null;
  eventLabel?: string | null;
  outcome?: InquiryNotificationOutcome;
  providerCallId?: string | null;
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

async function notificationAlreadySent(input: InquiryNotificationInput) {
  let query = input.supabase
    .from("voice_call_events")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("event_type", "notification.inbound_inquiry.sent")
    .limit(1);

  if (input.voiceCallId) {
    query = query.eq("voice_call_id", input.voiceCallId);
  } else if (input.providerCallId) {
    query = query.contains("payload", {
      providerCallId: input.providerCallId,
    });
  } else if (input.conversationId) {
    query = query.contains("payload", {
      conversationId: input.conversationId,
    });
  } else {
    return false;
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(
      `Unable to inspect inbound inquiry notifications: ${error.message}`,
    );
  }

  return Boolean(data?.id);
}

function notificationBody(input: InquiryNotificationInput) {
  const caller = textValue(input.contactName) ?? "A caller";
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
    `New Kyro phone inquiry from ${caller}. ${compactText(input.summary, 180)} ${status} ${getPublicAppUrl()}${path}`,
    420,
  );
}

export async function notifyInboundVoiceInquiry(
  input: InquiryNotificationInput,
) {
  if (await notificationAlreadySent(input)) {
    return { notified: false, reason: "duplicate" } as const;
  }

  await assertWorkspaceAutomationAllowed(input.workspaceId);
  const recipient = await primaryNotificationRecipient(
    input.supabase,
    input.workspaceId,
  );

  if (!recipient) {
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
    return {
      notified: false,
      reason: "recipient_is_workspace_number",
    } as const;
  }

  if (!recipient.userId) {
    return { notified: false, reason: "workspace_owner_missing" } as const;
  }

  const sourceId =
    input.voiceCallId ?? input.providerCallId ?? input.conversationId;
  const result = await recordOutboundDirectSms(input.supabase, {
    body: notificationBody(input),
    consentNote: "Primary workplace contact for inbound Kyro inquiries.",
    idempotencyKey: `inbound_voice_inquiry.${input.workspaceId}.${sourceId ?? "unknown"}`,
    metadata: {
      conversationId: input.conversationId ?? null,
      notificationType: "inbound_voice_inquiry",
      outcome: input.outcome ?? "captured",
      providerCallId: input.providerCallId ?? null,
      voiceCallId: input.voiceCallId ?? null,
    },
    recipientName: recipient.name,
    recipientPhone: recipient.phoneNumber,
    replyEventPayload: {
      conversationId: input.conversationId ?? null,
      outcome: input.outcome ?? "captured",
      providerCallId: input.providerCallId ?? null,
      voiceCallId: input.voiceCallId ?? null,
    },
    replyEventType: "outbound.inbound_voice_inquiry.sent",
    source: "inbound_voice_inquiry",
    userId: recipient.userId,
    workplaceContactId: recipient.contactId,
    workspaceId: input.workspaceId,
  });
  const providerMessageId = result.externalMessageId ?? null;

  const { error: notificationEventError } = await input.supabase
    .from("voice_call_events")
    .insert({
      event_type: "notification.inbound_inquiry.sent",
      payload: {
        conversationId: input.conversationId ?? null,
        outboundQueueId: result.outboundQueueId,
        outboxStatus: result.outboxStatus,
        outcome: input.outcome ?? "captured",
        providerCallId: input.providerCallId ?? null,
        providerMessageId,
        recipientName: recipient.name,
      },
      provider: "kyro",
      voice_call_id: input.voiceCallId ?? null,
      workspace_id: input.workspaceId,
    });

  if (notificationEventError) {
    throw new Error(
      `Unable to record inbound inquiry notification: ${notificationEventError.message}`,
    );
  }

  return {
    notified: true,
    outboundQueueId: result.outboundQueueId,
    providerMessageId,
  } as const;
}
