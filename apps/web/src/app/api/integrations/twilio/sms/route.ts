import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { ingestManualInbound } from "../../../../../lib/inbound/manual";
import {
  findWorkspaceNumberForInboundSms,
  getTwilioConfig,
  telephonyUsageCost,
  twilioWebhookCanonicalUrl,
  twilioWebhookResponse,
  validateTwilioWebhookSignature,
  TWILIO_PROVIDER,
} from "../../../../../lib/integrations/twilio";
import { normalizeContactPhoneForRegion } from "../../../../../lib/crm/identity";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

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

  return validateTwilioWebhookSignature({
    authToken: config.authToken,
    params,
    signature: request.headers.get("x-twilio-signature"),
    url: twilioWebhookCanonicalUrl(request),
  });
}

export async function GET() {
  const config = getTwilioConfig();

  return NextResponse.json({
    appUrlConfigured: Boolean(config?.appUrl),
    configured: Boolean(config),
    defaultFromNumberConfigured: Boolean(config?.defaultFromNumber),
    endpoint: "inbound_sms",
    expects: "Twilio form-encoded POST with x-twilio-signature.",
    messagingServiceSidConfigured: Boolean(config?.messagingServiceSid),
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

  const contactName =
    (await findExistingContactName(supabase, workspaceNumber.workspaceId, from)) ??
    `SMS from ${from}`;
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
