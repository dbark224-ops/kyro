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
import { normalizeContactPhoneForRegion } from "../crm/identity";
import { ingestManualInbound } from "../inbound/manual";
import { createServiceSupabaseClient } from "../supabase/service";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import {
  findWorkspaceNumberForInboundSms,
  telephonyUsageCost,
  TWILIO_PROVIDER,
} from "./twilio";

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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeInboundSmsPayload(params: Record<string, string>) {
  const from = textValue(params.From);
  const to = textValue(params.To);
  const body = textValue(params.Body);

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

async function findExistingContactName(
  supabase: ServiceSupabase,
  workspaceId: string,
  from: string,
) {
  const normalizedPhone = normalizeContactPhoneForRegion(from, "AU");

  if (!normalizedPhone) {
    return null;
  }

  const { data, error } = await supabase
    .from("contacts")
    .select("name,company")
    .eq("workspace_id", workspaceId)
    .eq("normalized_phone", normalizedPhone)
    .is("merged_into_contact_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to match inbound SMS contact: ${error.message}`);
  }

  return textValue(data?.name) ?? textValue(data?.company);
}

async function recordInboundSmsUsage(
  supabase: ServiceSupabase,
  input: {
    eventId: string | null;
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

  await supabase.from("usage_events").insert({
    workspace_id: input.workspaceId,
    user_id: null,
    source_type: input.eventId ? "event" : "sms_webhook",
    source_id: input.eventId,
    provider: TWILIO_PROVIDER,
    service: "sms",
    model: null,
    usage_type: "inbound_sms",
    quantity: "1",
    unit: "message",
    unit_cost_snapshot: String(usage.cost),
    markup_snapshot: String(usage.markup),
    currency: usage.currency,
    cost_snapshot: String(usage.cost),
    customer_charge_snapshot: String(usage.customerCharge),
    provider_usage_id: input.messageSid,
    metadata: {
      billingTask: "sms_delivery",
      direction: "inbound",
      from: input.from,
      to: input.to,
    },
  });
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
    console.error("Internal SMS assistant turn failed", error);
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
      source: "twilio_internal_sms",
      status: "staff_internal",
      touch: "inbound",
      workspaceId: workspaceNumber.workspaceId,
    });

    await recordInboundSmsUsage(supabase, {
      eventId,
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
      source: "twilio_sms_keyword",
      status: consentCommand.status,
      touch: "inbound",
      workspaceId: workspaceNumber.workspaceId,
    });

    await recordInboundSmsUsage(supabase, {
      eventId: null,
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
    source: "twilio_inbound_sms",
    touch: "inbound",
    workspaceId: workspaceNumber.workspaceId,
  });

  const contactName =
    (await findExistingContactName(
      supabase,
      workspaceNumber.workspaceId,
      input.from,
    )) ?? input.from;
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
      serviceType: "SMS",
      source: "twilio_sms",
      submissionKey: input.messageSid,
    },
  );

  await recordInboundSmsUsage(supabase, {
    eventId: result.eventId,
    from: input.from,
    messageSid: input.messageSid,
    to: input.to,
    workspaceId: workspaceNumber.workspaceId,
  });

  return {
    eventId: result.eventId,
    status: result.duplicate ? "duplicate" : "external_inquiry",
    workspaceId: workspaceNumber.workspaceId,
  };
}
