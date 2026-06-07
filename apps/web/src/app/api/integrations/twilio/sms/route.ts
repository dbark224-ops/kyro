import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
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
import { getVoiceSettings } from "../../../../../lib/assistant/voice-settings";
import { createOutboundVoiceCall } from "../../../../../lib/voice/calls";
import {
  looksLikeOutboundCallRequest,
  resolveOutboundCallRequest,
} from "../../../../../lib/voice/outbound-call-requests";

export const dynamic = "force-dynamic";

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

async function workspaceOwnerUserId(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load workspace owner: ${error.message}`);
  }

  return textValue(data?.owner_user_id);
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

function phoneComparisonKeys(value: string) {
  const rawDigits = value.replace(/\D/g, "");
  const normalizedDigits =
    normalizeContactPhoneForRegion(value, "AU")?.replace(/\D/g, "") ?? null;

  return new Set(
    [rawDigits, normalizedDigits].filter(
      (candidate): candidate is string => Boolean(candidate),
    ),
  );
}

function phoneKeySetsOverlap(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

async function isInternalSmsSender(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  workspaceId: string,
  from: string,
) {
  const settings = await getVoiceSettings(supabase, workspaceId);
  const fromKeys = phoneComparisonKeys(from);

  return settings.phoneAgentUserNumbers.some((phoneNumber) =>
    phoneKeySetsOverlap(fromKeys, phoneComparisonKeys(phoneNumber)),
  );
}

async function recordInboundSmsUsage(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
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

  const ownerUserId = await workspaceOwnerUserId(
    supabase,
    workspaceNumber.workspaceId,
  );

  if (!ownerUserId) {
    throw new Error("Unable to process inbound SMS without a workspace owner.");
  }

  if (
    looksLikeOutboundCallRequest(body) &&
    (await isInternalSmsSender(supabase, workspaceNumber.workspaceId, from))
  ) {
    await recordInboundSmsUsage(supabase, {
      eventId: null,
      from,
      messageSid,
      to,
      workspaceId: workspaceNumber.workspaceId,
    });

    const resolution = await resolveOutboundCallRequest({
      contextSummary: `Internal SMS request from ${from}: ${body}`,
      prompt: body,
      supabase,
      workspaceId: workspaceNumber.workspaceId,
    });

    if (resolution.status === "ready") {
      await createOutboundVoiceCall({
        contactId: resolution.contactId,
        contextSummary: resolution.contextSummary,
        conversationId: resolution.conversationId,
        instructions: resolution.instructions,
        leadId: resolution.leadId,
        phoneNumber: resolution.phoneNumber,
        supabase,
        user: scheduledUser(ownerUserId),
        workspaceId: workspaceNumber.workspaceId,
      });
    } else {
      console.warn("Internal SMS outbound call request was not ready", {
        from,
        messageSid,
        resolutionStatus: resolution.status,
        workspaceId: workspaceNumber.workspaceId,
      });
    }

    return twilioWebhookResponse();
  }

  const contactName =
    (await findExistingContactName(supabase, workspaceNumber.workspaceId, from)) ??
    from;
  const result = await ingestManualInbound(
    supabase,
    scheduledUser(ownerUserId),
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
