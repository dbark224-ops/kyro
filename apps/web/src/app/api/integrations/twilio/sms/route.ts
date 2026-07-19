import { after, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import {
  isTrustedInternalMessagingSender,
  processInternalAssistantMessage,
  type InternalMessagingWorkspace,
} from "../../../../../lib/assistant/internal-messaging";
import { ingestManualInbound } from "../../../../../lib/inbound/manual";
import {
  findWorkspaceNumberForInboundSms,
  getTwilioConfig,
  telephonyUsageCost,
  twilioWebhookCanonicalUrlCandidates,
  twilioWebhookResponse,
  validateTwilioWebhookSignature,
  TWILIO_PROVIDER,
} from "../../../../../lib/integrations/twilio";
import { normalizeContactPhoneForRegion } from "../../../../../lib/crm/identity";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import {
  recordSmsRecipientPreference,
  smsConsentCommand,
} from "../../../../../lib/communication/sms-compliance";
import { resolveWorkspaceUsageMarkupRate } from "../../../../../lib/usage/workspace-markup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

type InternalSmsMessage = {
  body: string;
  eventId: string;
  from: string;
  messageSid: string;
  to: string;
  workspace: InternalMessagingWorkspace;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scheduledUser(ownerUserId: string): User {
  return { id: ownerUserId } as User;
}

async function formParams(request: Request) {
  const form = await request.formData();
  const params: Record<string, string> = {};

  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      params[key] = value;
    }
  }

  return params;
}

function signatureValid(request: Request, params: Record<string, string>) {
  const config = getTwilioConfig();

  if (!config?.authToken) {
    return false;
  }

  return twilioWebhookCanonicalUrlCandidates(request).some((url) =>
    validateTwilioWebhookSignature({
      authToken: config.authToken,
      params,
      signature: request.headers.get("x-twilio-signature"),
      url,
    }),
  );
}

export async function GET() {
  const config = getTwilioConfig();

  return NextResponse.json({
    accountSidReady: Boolean(process.env.TWILIO_ACCOUNT_SID?.trim()),
    appUrlConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim()),
    authTokenReady: Boolean(process.env.TWILIO_AUTH_TOKEN?.trim()),
    configured: Boolean(config),
    defaultFromNumberConfigured: Boolean(
      process.env.TWILIO_VOICE_NUMBER?.trim(),
    ),
    endpoint: "inbound_sms",
    expects: "Twilio form-encoded POST with x-twilio-signature.",
    messagingServiceSidConfigured: Boolean(
      process.env.TWILIO_MESSAGING_SERVICE_SID?.trim(),
    ),
    ok: true,
    provider: TWILIO_PROVIDER,
  });
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
  supabase: ReturnType<typeof createServiceSupabaseClient>,
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
  input: {
    body: string;
    from: string;
    messageSid: string;
    to: string;
    workspaceId: string;
  },
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

export async function POST(request: Request) {
  const params = await formParams(request);

  if (!signatureValid(request, params)) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }

  const from = textValue(params.From);
  const to = textValue(params.To);
  const body = textValue(params.Body);
  const messageSid = textValue(params.MessageSid) ?? crypto.randomUUID();

  if (!from || !to || !body) {
    return twilioWebhookResponse();
  }

  const supabase = createServiceSupabaseClient();
  const workspaceNumber = await findWorkspaceNumberForInboundSms(supabase, to);

  if (!workspaceNumber) {
    console.warn("Inbound Twilio SMS did not match a workspace number", {
      from,
      messageSid,
      to,
    });

    return twilioWebhookResponse();
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
      from,
    )
  ) {
    const eventId = await reserveInternalSmsEvent(supabase, {
      body,
      from,
      messageSid,
      to,
      workspaceId: workspaceNumber.workspaceId,
    });

    if (!eventId) {
      return twilioWebhookResponse();
    }

    await recordSmsRecipientPreference(supabase, {
      channelNumberId: workspaceNumber.id,
      consentNote: "Trusted staff/operator SMS message.",
      metadata: {
        classification: "staff_operator",
        from,
        messageSid,
        provider: TWILIO_PROVIDER,
        to,
      },
      phoneNumber: from,
      source: "twilio_internal_sms",
      status: "staff_internal",
      touch: "inbound",
      workspaceId: workspaceNumber.workspaceId,
    });

    await recordInboundSmsUsage(supabase, {
      eventId,
      from,
      messageSid,
      to,
      workspaceId: workspaceNumber.workspaceId,
    });

    after(() =>
      processInternalSmsMessage({
        body,
        eventId,
        from,
        messageSid,
        to,
        workspace,
      }),
    );

    return twilioWebhookResponse();
  }

  const consentCommand = smsConsentCommand(body);

  if (consentCommand.status) {
    await recordSmsRecipientPreference(supabase, {
      channelNumberId: workspaceNumber.id,
      consentNote:
        consentCommand.status === "opted_out"
          ? "Recipient opted out by SMS keyword."
          : "Recipient opted back in by SMS keyword.",
      keyword: consentCommand.keyword,
      metadata: {
        from,
        messageSid,
        provider: TWILIO_PROVIDER,
        to,
      },
      phoneNumber: from,
      source: "twilio_sms_keyword",
      status: consentCommand.status,
      touch: "inbound",
      workspaceId: workspaceNumber.workspaceId,
    });

    await recordInboundSmsUsage(supabase, {
      eventId: null,
      from,
      messageSid,
      to,
      workspaceId: workspaceNumber.workspaceId,
    });

    return twilioWebhookResponse();
  }

  await recordSmsRecipientPreference(supabase, {
    channelNumberId: workspaceNumber.id,
    metadata: {
      from,
      messageSid,
      provider: TWILIO_PROVIDER,
      to,
    },
    phoneNumber: from,
    source: "twilio_inbound_sms",
    touch: "inbound",
    workspaceId: workspaceNumber.workspaceId,
  });

  const contactName =
    (await findExistingContactName(
      supabase,
      workspaceNumber.workspaceId,
      from,
    )) ?? from;
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
          to,
        },
        type: "sms",
      },
      contactName,
      eventSource: "twilio.webhook",
      eventType: "inbound.sms.received",
      message: body,
      metadata: {
        from,
        messageSid,
        provider: TWILIO_PROVIDER,
        to,
      },
      phone: from,
      serviceType: "SMS",
      source: "twilio_sms",
      submissionKey: messageSid,
    },
  );

  await recordInboundSmsUsage(supabase, {
    eventId: result.eventId,
    from,
    messageSid,
    to,
    workspaceId: workspaceNumber.workspaceId,
  });

  return twilioWebhookResponse();
}
