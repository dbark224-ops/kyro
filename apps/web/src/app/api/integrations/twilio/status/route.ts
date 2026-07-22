import { NextResponse } from "next/server";
import {
  getTwilioConfig,
  twilioSmsDeliveryState,
  twilioWebhookCanonicalUrlCandidates,
  twilioWebhookResponse,
  validateTwilioWebhookSignature,
  TWILIO_PROVIDER,
} from "../../../../../lib/integrations/twilio";
import { sendInternalBugNotification } from "../../../../../lib/internal-notifications";
import {
  assistantDeliveryOrigin,
  reportAssistantDeliveryFailure,
} from "../../../../../lib/assistant/delivery-feedback";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    .select(
      "id,workspace_id,user_id,recipient,metadata,settings_snapshot,source,status",
    )
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
  const errorCode = textValue(params.ErrorCode);
  const errorMessage = textValue(params.ErrorMessage);
  const { failed, succeeded } = twilioSmsDeliveryState({
    errorCode,
    status: messageStatus,
  });
  const metadata =
    outbound.metadata && typeof outbound.metadata === "object"
      ? (outbound.metadata as Record<string, unknown>)
      : {};
  const deliveryOrigin = assistantDeliveryOrigin(outbound.settings_snapshot);
  const shouldReportAssistantFailure = Boolean(
    failed &&
    deliveryOrigin &&
    !metadata.suppressFailureFeedback &&
    !metadata.assistantFailureFeedbackAt,
  );

  const updatePayload: Record<string, unknown> = {
    metadata: {
      ...metadata,
      ...(shouldReportAssistantFailure
        ? { assistantFailureFeedbackAt: now }
        : {}),
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
      `Twilio SMS ${failed ? "failed" : messageStatus}${errorCode ? ` (${errorCode})` : ""}`;
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

  if (
    outbound.source === "inbound_voice_inquiry" ||
    outbound.source === "inbound_inquiry_notification"
  ) {
    const voiceCallId = textValue(metadata.voiceCallId);
    const conversationId = textValue(metadata.conversationId);
    const eventType = failed
      ? "notification.inbound_inquiry.delivery_failed"
      : succeeded
        ? "notification.inbound_inquiry.delivered"
        : "notification.inbound_inquiry.status";

    if (voiceCallId) {
      const { error: voiceEventError } = await supabase
        .from("voice_call_events")
        .insert({
          event_type: eventType,
          payload: {
            conversationId,
            errorCode,
            errorMessage,
            messageSid,
            outboundQueueId: outbound.id,
            status: messageStatus,
            to: textValue(params.To),
          },
          provider: TWILIO_PROVIDER,
          voice_call_id: voiceCallId,
          workspace_id: outbound.workspace_id,
        });

      if (voiceEventError) {
        console.error("Unable to record inbound inquiry SMS delivery status", {
          error: voiceEventError.message,
          messageSid,
          voiceCallId,
          workspaceId: outbound.workspace_id,
        });
      }
    }

    if (failed) {
      await sendInternalBugNotification({
        context: {
          workspaceId: outbound.workspace_id,
        },
        input: {
          context: {
            conversationId,
            errorCode,
            messageSid,
            outboundQueueId: outbound.id,
            status: messageStatus,
            voiceCallId,
          },
          eventKey: `inbound-voice-notification:${messageSid}:${messageStatus}`,
          kind: "Inbound inquiry SMS delivery failed",
          rawMessage:
            errorMessage ??
            `Twilio SMS ${messageStatus}${errorCode ? ` (${errorCode})` : ""}`,
          severity: "error",
          source: "twilio.status.inbound_inquiry_notification",
          visibleMessage:
            "Kyro captured the inquiry, but the SMS notification was not delivered.",
        },
      }).catch((notificationError) => {
        console.error("Unable to send inbound inquiry delivery bug alert", {
          error:
            notificationError instanceof Error
              ? notificationError.message
              : "Unknown notification error",
          messageSid,
          workspaceId: outbound.workspace_id,
        });
      });
    }
  }

  if (shouldReportAssistantFailure && deliveryOrigin) {
    await reportAssistantDeliveryFailure({
      errorCode,
      errorMessage,
      origin: deliveryOrigin,
      outboundQueueId: String(outbound.id),
      recipient: outbound.recipient,
      supabase,
      workspaceId: String(outbound.workspace_id),
    }).catch((feedbackError) => {
      console.error("Unable to report assistant-requested SMS failure", {
        error:
          feedbackError instanceof Error
            ? feedbackError.message
            : String(feedbackError),
        messageSid,
        outboundQueueId: outbound.id,
        workspaceId: outbound.workspace_id,
      });
    });
  }

  return twilioWebhookResponse();
}
