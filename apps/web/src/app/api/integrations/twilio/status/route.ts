import { NextResponse } from "next/server";
import {
  getTwilioConfig,
  twilioWebhookCanonicalUrlCandidates,
  twilioWebhookResponse,
  validateTwilioWebhookSignature,
  TWILIO_PROVIDER,
} from "../../../../../lib/integrations/twilio";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const FINAL_FAILED_STATUSES = new Set(["failed", "undelivered"]);
const FINAL_SUCCESS_STATUSES = new Set(["delivered", "sent"]);

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
    endpoint: "sms_status_callback",
    expects: "Twilio form-encoded POST with x-twilio-signature.",
    ok: true,
    provider: TWILIO_PROVIDER,
  });
}

export async function POST(request: Request) {
  const params = await formParams(request);

  if (!signatureValid(request, params)) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }

  const messageSid = textValue(params.MessageSid) ?? textValue(params.SmsSid);
  const messageStatus =
    textValue(params.MessageStatus) ?? textValue(params.SmsStatus);

  if (!messageSid || !messageStatus) {
    return twilioWebhookResponse();
  }

  const supabase = createServiceSupabaseClient();
  const { data: outbound, error } = await supabase
    .from("outbound_messages")
    .select("id,workspace_id,metadata,status")
    .eq("provider", TWILIO_PROVIDER)
    .eq("provider_message_id", messageSid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load Twilio outbox row: ${error.message}`);
  }

  if (!outbound) {
    return twilioWebhookResponse();
  }

  const now = new Date().toISOString();
  const normalizedStatus = messageStatus.toLowerCase();
  const failed = FINAL_FAILED_STATUSES.has(normalizedStatus);
  const succeeded = FINAL_SUCCESS_STATUSES.has(normalizedStatus);
  const errorCode = textValue(params.ErrorCode);
  const errorMessage = textValue(params.ErrorMessage);
  const metadata =
    outbound.metadata && typeof outbound.metadata === "object"
      ? (outbound.metadata as Record<string, unknown>)
      : {};

  const updatePayload: Record<string, unknown> = {
    metadata: {
      ...metadata,
      twilioStatus: {
        at: now,
        errorCode,
        errorMessage,
        messageSid,
        rawStatus: messageStatus,
        to: textValue(params.To),
      },
    },
  };

  if (failed) {
    updatePayload.status = "failed";
    updatePayload.failed_at = now;
    updatePayload.last_error =
      errorMessage ??
      `Twilio SMS ${messageStatus}${errorCode ? ` (${errorCode})` : ""}`;
  } else if (succeeded) {
    updatePayload.status = "sent";
    updatePayload.failed_at = null;
    updatePayload.last_error = null;
  }

  const { error: updateError } = await supabase
    .from("outbound_messages")
    .update(updatePayload)
    .eq("id", outbound.id);

  if (updateError) {
    throw new Error(
      `Unable to update Twilio outbox status: ${updateError.message}`,
    );
  }

  await supabase.from("events").insert({
    workspace_id: outbound.workspace_id,
    type: "outbound.sms.status_callback",
    source: "twilio.webhook",
    idempotency_key: `twilio.sms.status.${messageSid}.${messageStatus}.${now}`,
    payload: {
      errorCode,
      errorMessage,
      messageSid,
      outboundQueueId: outbound.id,
      status: messageStatus,
      to: textValue(params.To),
    },
    status: "processed",
    processed_at: now,
  });

  return twilioWebhookResponse();
}
