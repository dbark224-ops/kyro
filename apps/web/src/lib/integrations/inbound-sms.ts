import type { User } from "@supabase/supabase-js";
import {
  isTrustedInternalMessagingSender,
  processInternalAssistantMessage,
  type InternalMessagingWorkspace,
} from "../assistant/internal-messaging";
import {
  recordSmsRecipientPreference,
  smsConsentCommand,
} from "../communication/sms-compliance";
import { smsSegmentCount } from "../communication/sms-length";
import {
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "../crm/identity";
import { getWorkspacePhoneRegion } from "../workspace/general-settings";
import { ingestManualConversationFollowUp } from "../inbound/follow-up";
import { ingestManualInbound } from "../inbound/manual";
import { notifyInboundInquiry } from "../voice/inbound-inquiry-notifications";
import { createServiceSupabaseClient } from "../supabase/service";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import {
  findWorkspaceNumberForInboundSms,
  findOrCreateTwilioSmsChannel,
  telephonyUsageCost,
  TWILIO_PROVIDER,
} from "./twilio";
import { textValue } from "@kyro/core";
import { logWriteError } from "../supabase/write";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

export type InboundSmsPayload = {
  body: string;
  from: string;
  messageSid: string;
  to: string;
};

export type InboundSmsProcessingResult = {
  eventId: string | null;
  status:
    | "duplicate"
    | "external_follow_up"
    | "external_inquiry"
    | "internal_message"
    | "opt_in"
    | "opt_out"
    | "unmatched_number";
  workspaceId: string | null;
};

type InternalSmsMessage = InboundSmsPayload & {
  eventId: string;
  workspace: InternalMessagingWorkspace;
};

type InboundSmsProcessingOptions = {
  schedule?: (task: () => Promise<void>) => void;
};

/**
 * A photo with no words is still a customer getting in touch.
 *
 * Sending a picture of the problem and nothing else is one of the most ordinary
 * things a customer of a trade business does. Twilio delivers that as a webhook
 * with media and an empty Body, and an empty Body was treated as nothing to
 * process: the route answered 200, and no lead, no alert, no inbox entry and no
 * reply followed. The customer believes they have reported a leak and the owner
 * never learns it happened -- the silent failure the conduct document calls the
 * hardest one to see.
 *
 * Kyro cannot read the picture yet. It can refuse to pretend the message never
 * arrived, which is what this does: describe what came in, honestly, so the
 * inquiry is raised and somebody can ask what it shows.
 */
export function mediaOnlyBody(params: Record<string, string>) {
  const count = Number.parseInt(textValue(params.NumMedia) ?? "", 10);

  if (!Number.isFinite(count) || count < 1) {
    return null;
  }

  const photos = (textValue(params.MediaContentType0) ?? "").startsWith("image/");
  const noun = photos ? "photo" : "attachment";

  return count === 1
    ? `[Sent one ${noun} and no message.]`
    : `[Sent ${count} ${noun}s and no message.]`;
}

export function normalizeInboundSmsPayload(params: Record<string, string>) {
  const from = textValue(params.From);
  const to = textValue(params.To);
  const body = textValue(params.Body) ?? mediaOnlyBody(params);

  if (!from || !to || !body) {
    return null;
  }

  return {
    body,
    from,
    messageSid: textValue(params.MessageSid) ?? crypto.randomUUID(),
    to,
  } satisfies InboundSmsPayload;
}

function scheduledUser(ownerUserId: string): User {
  return { id: ownerUserId } as User;
}

async function loadMessagingWorkspace(
  supabase: ServiceSupabase,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load workspace owner: ${error.message}`);
  }

  const ownerUserId = textValue(data?.owner_user_id);

  if (!data || !ownerUserId) {
    return null;
  }

  return {
    id: String(data.id),
    name: textValue(data.name) ?? "Kyro workspace",
    ownerUserId,
  } satisfies InternalMessagingWorkspace;
}

async function findExistingContact(
  supabase: ServiceSupabase,
  workspaceId: string,
  from: string,
  region: PhoneRegion,
) {
  const normalizedPhone = normalizeContactPhoneForRegion(from, region);

  if (!normalizedPhone) {
    return null;
  }

  const { data, error } = await supabase
    .from("contacts")
    .select("id,name,company")
    .eq("workspace_id", workspaceId)
    .eq("normalized_phone", normalizedPhone)
    .is("merged_into_contact_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to match inbound SMS contact: ${error.message}`);
  }

  return data
    ? {
        id: String(data.id),
        name: textValue(data.name) ?? textValue(data.company),
      }
    : null;
}

async function findPendingCustomerWorkflow(
  supabase: ServiceSupabase,
  workspaceId: string,
  contactId: string,
) {
  const { data, error } = await supabase
    .from("inquiry_future_steps")
    .select("conversation_id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("status", "waiting")
    .eq("trigger_type", "customer_reply")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to match inbound SMS workflow: ${error.message}`);
  }

  return data?.conversation_id ? String(data.conversation_id) : null;
}

async function recordInboundSmsUsage(
  supabase: ServiceSupabase,
  input: {
    eventId: string | null;
    body: string;
    from: string;
    messageSid: string;
    to: string;
    workspaceId: string;
  },
) {
  const usage = telephonyUsageCost({
    direction: "inbound",
    kind: "sms",
    markupRate: await resolveWorkspaceUsageMarkupRate(
      supabase,
      input.workspaceId,
      "TWILIO_MARKUP_RATE",
    ),
  });
  // Twilio charges the receiving side per segment too, and the outbound path
  // was the only half of that fixed. A long message a customer sends costs
  // just as many segments as one Kyro sends. Twilio supplies no price on an
  // inbound webhook at all, so the configured rate is always what is used.
  const segments = Math.max(1, smsSegmentCount(input.body ?? ""));
  const billedUnits = usage.source === "configured" ? segments : 1;
  const totalCost = usage.cost * billedUnits;
  const totalCharge = usage.customerCharge * billedUnits;

  await logWriteError(
    supabase.from("usage_events").insert({
      workspace_id: input.workspaceId,
      user_id: null,
      source_type: input.eventId ? "event" : "sms_webhook",
      source_id: input.eventId,
      provider: TWILIO_PROVIDER,
      service: "sms",
      model: null,
      usage_type: "inbound_sms",
      quantity: String(segments),
      unit: "segment",
      unit_cost_snapshot: String(usage.cost),
      markup_snapshot: String(usage.markup),
      currency: usage.currency,
      cost_snapshot: String(totalCost),
      customer_charge_snapshot: String(totalCharge),
      provider_usage_id: input.messageSid,
      metadata: {
        billingTask: "sms_delivery",
        direction: "inbound",
        from: input.from,
        to: input.to,
      },
    }),
    "Unable to record inbound SMS usage",
  );
}

async function reserveInternalSmsEvent(
  supabase: ServiceSupabase,
  input: InboundSmsPayload & { workspaceId: string },
) {
  const { data, error } = await supabase
    .from("events")
    .insert({
      idempotency_key: `twilio.sms.internal.${input.messageSid}`,
      payload: {
        body: input.body,
        classification: "staff_operator",
        from: input.from,
        messageSid: input.messageSid,
        to: input.to,
        transport: "sms",
      },
      source: "twilio.webhook",
      status: "pending",
      type: "inbound.internal_sms.received",
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    return null;
  }

  if (error || !data) {
    throw new Error(
      `Unable to reserve internal SMS message: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(data.id);
}

async function markInternalSmsEvent(
  supabase: ServiceSupabase,
  eventId: string,
  status: "failed" | "processed",
) {
  const { error } = await supabase
    .from("events")
    .update({
      processed_at: new Date().toISOString(),
      status,
    })
    .eq("id", eventId);

  if (error) {
    console.error("Unable to update internal SMS event status", {
      error: error.message,
      eventId,
      status,
    });
  }
}

async function processInternalSmsMessage(input: InternalSmsMessage) {
  const supabase = createServiceSupabaseClient();

  try {
    await processInternalAssistantMessage({
      eventId: input.eventId,
      from: input.from,
      messageSid: input.messageSid,
      prompt: input.body,
      supabase,
      transport: "sms",
      workspace: input.workspace,
    });
    await markInternalSmsEvent(supabase, input.eventId, "processed");
  } catch (error) {
    console.error("Internal SMS assistant turn failed", {
      error: error instanceof Error ? error.message : String(error),
      eventId: input.eventId,
      messageSid: input.messageSid,
      workspaceId: input.workspace.id,
    });
    await markInternalSmsEvent(supabase, input.eventId, "failed");
  }
}

export async function processInboundSmsPayload(
  input: InboundSmsPayload,
  options: InboundSmsProcessingOptions = {},
): Promise<InboundSmsProcessingResult> {
  const supabase = createServiceSupabaseClient();
  const workspaceNumber = await findWorkspaceNumberForInboundSms(
    supabase,
    input.to,
  );

  if (!workspaceNumber) {
    console.warn("Inbound Twilio SMS did not match a workspace number", {
      from: input.from,
      messageSid: input.messageSid,
      to: input.to,
    });

    return {
      eventId: null,
      status: "unmatched_number",
      workspaceId: null,
    };
  }

  const workspace = await loadMessagingWorkspace(
    supabase,
    workspaceNumber.workspaceId,
  );

  if (!workspace) {
    throw new Error("Unable to process inbound SMS without a workspace owner.");
  }

  // Resolved once and threaded through: contact matching and consent both key
  // on the normalized number, so they have to agree, and this workspace may not
  // be in the region the code used to assume.
  const region = await getWorkspacePhoneRegion(
    supabase,
    workspaceNumber.workspaceId,
  );

  if (
    await isTrustedInternalMessagingSender(
      supabase,
      workspaceNumber.workspaceId,
      input.from,
    )
  ) {
    const eventId = await reserveInternalSmsEvent(supabase, {
      ...input,
      workspaceId: workspaceNumber.workspaceId,
    });

    if (!eventId) {
      return {
        eventId: null,
        status: "duplicate",
        workspaceId: workspaceNumber.workspaceId,
      };
    }

    await recordSmsRecipientPreference(supabase, {
      channelNumberId: workspaceNumber.id,
      consentNote: "Trusted staff/operator SMS message.",
      metadata: {
        classification: "staff_operator",
        from: input.from,
        messageSid: input.messageSid,
        provider: TWILIO_PROVIDER,
        to: input.to,
      },
      phoneNumber: input.from,
      region,
      source: "twilio_internal_sms",
      status: "staff_internal",
      touch: "inbound",
      workspaceId: workspaceNumber.workspaceId,
    });

    await recordInboundSmsUsage(supabase, {
      eventId,
      body: input.body,
      from: input.from,
      messageSid: input.messageSid,
      to: input.to,
      workspaceId: workspaceNumber.workspaceId,
    });

    const task = () =>
      processInternalSmsMessage({
        ...input,
        eventId,
        workspace,
      });

    if (options.schedule) {
      options.schedule(task);
    } else {
      await task();
    }

    return {
      eventId,
      status: "internal_message",
      workspaceId: workspaceNumber.workspaceId,
    };
  }

  const consentCommand = smsConsentCommand(input.body);

  if (consentCommand.status) {
    await recordSmsRecipientPreference(supabase, {
      channelNumberId: workspaceNumber.id,
      consentNote:
        consentCommand.status === "opted_out"
          ? "Recipient opted out by SMS keyword."
          : "Recipient opted back in by SMS keyword.",
      keyword: consentCommand.keyword,
      metadata: {
        from: input.from,
        messageSid: input.messageSid,
        provider: TWILIO_PROVIDER,
        to: input.to,
      },
      phoneNumber: input.from,
      region,
      source: "twilio_sms_keyword",
      status: consentCommand.status,
      touch: "inbound",
      workspaceId: workspaceNumber.workspaceId,
    });

    await recordInboundSmsUsage(supabase, {
      eventId: null,
      body: input.body,
      from: input.from,
      messageSid: input.messageSid,
      to: input.to,
      workspaceId: workspaceNumber.workspaceId,
    });

    return {
      eventId: null,
      status: consentCommand.status === "opted_out" ? "opt_out" : "opt_in",
      workspaceId: workspaceNumber.workspaceId,
    };
  }

  await recordSmsRecipientPreference(supabase, {
    channelNumberId: workspaceNumber.id,
    metadata: {
      from: input.from,
      messageSid: input.messageSid,
      provider: TWILIO_PROVIDER,
      to: input.to,
    },
    phoneNumber: input.from,
    region,
    source: "twilio_inbound_sms",
    touch: "inbound",
    workspaceId: workspaceNumber.workspaceId,
  });

  const existingContact = await findExistingContact(
    supabase,
    workspaceNumber.workspaceId,
    input.from,
    region,
  );
  const contactName = existingContact?.name ?? input.from;
  const pendingConversationId = existingContact
    ? await findPendingCustomerWorkflow(
        supabase,
        workspaceNumber.workspaceId,
        existingContact.id,
      )
    : null;

  if (pendingConversationId) {
    const channelId = await findOrCreateTwilioSmsChannel(supabase, {
      phoneNumber: workspaceNumber.phoneNumber,
      providerPhoneNumberId: workspaceNumber.providerPhoneNumberId,
      workspaceId: workspaceNumber.workspaceId,
    });
    const followUp = await ingestManualConversationFollowUp(
      supabase,
      scheduledUser(workspace.ownerUserId),
      workspaceNumber.workspaceId,
      {
        actorType: "system",
        channelId,
        conversationId: pendingConversationId,
        eventSource: "twilio.webhook",
        eventType: "inbound.sms.follow_up.received",
        inboundChannelType: "sms",
        message: input.body,
        messageMetadata: {
          from: input.from,
          messageSid: input.messageSid,
          provider: TWILIO_PROVIDER,
          to: input.to,
        },
        subject: "Customer SMS reply",
        submissionKey: input.messageSid,
      },
    );

    await recordInboundSmsUsage(supabase, {
      eventId: followUp.eventId,
      body: input.body,
      from: input.from,
      messageSid: input.messageSid,
      to: input.to,
      workspaceId: workspaceNumber.workspaceId,
    });

    return {
      eventId: followUp.eventId,
      status: followUp.duplicate ? "duplicate" : "external_follow_up",
      workspaceId: workspaceNumber.workspaceId,
    };
  }

  const result = await ingestManualInbound(
    supabase,
    scheduledUser(workspace.ownerUserId),
    workspaceNumber.workspaceId,
    {
      channel: {
        displayName: `Twilio SMS - ${workspaceNumber.phoneNumber}`,
        externalId: `twilio:sms:${
          workspaceNumber.providerPhoneNumberId ??
          workspaceNumber.normalizedPhone
        }`,
        settings: {
          provider: TWILIO_PROVIDER,
          providerPhoneNumberId: workspaceNumber.providerPhoneNumberId,
          to: input.to,
        },
        type: "sms",
      },
      contactName,
      eventSource: "twilio.webhook",
      eventType: "inbound.sms.received",
      message: input.body,
      metadata: {
        from: input.from,
        messageSid: input.messageSid,
        provider: TWILIO_PROVIDER,
        to: input.to,
      },
      phone: input.from,
      // Not "SMS" -- that is how the message arrived, not what the work is.
      // All 97 SMS leads carried it as their trade, which made any report on
      // the work useless for that half and stopped a text joining the job the
      // same customer had just emailed about. ingestManualInbound fills this
      // in after triage, from the message itself.
      serviceType: undefined,
      source: "twilio_sms",
      submissionKey: input.messageSid,
    },
  );

  await recordInboundSmsUsage(supabase, {
    eventId: result.eventId,
    body: input.body,
    from: input.from,
    messageSid: input.messageSid,
    to: input.to,
    workspaceId: workspaceNumber.workspaceId,
  });

  if (!result.duplicate) {
    await notifyInboundInquiry({
      channel: "sms",
      contactName,
      contactPhone: input.from,
      conversationId: result.conversationId,
      correlation: {
        conversationId: result.conversationId,
        eventId: result.eventId,
      },
      missingInfo: result.inquiryFacts?.missingInfo ?? [],
      ownerQuestion: result.ownerQuestion,
      preferredTime: result.inquiryFacts?.preferredTime ?? null,
      preparedReplyAvailable: Boolean(result.replyDraft?.body),
      preparedReplyBody: result.replyDraft?.body ?? null,
      sourceId: input.messageSid,
      summary: result.triageSummary ?? "New SMS inquiry received.",
      supabase,
      workspaceId: workspaceNumber.workspaceId,
    }).catch((notificationError) => {
      console.error("Unable to notify workspace about inbound SMS", {
        conversationId: result.conversationId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : "Unknown notification error",
        messageSid: input.messageSid,
        workspaceId: workspaceNumber.workspaceId,
      });
    });
  }

  return {
    eventId: result.eventId,
    status: result.duplicate ? "duplicate" : "external_inquiry",
    workspaceId: workspaceNumber.workspaceId,
  };
}
