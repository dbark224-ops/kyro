import { after, NextResponse } from "next/server";
import {
  normalizeInboundSmsPayload,
  processInboundSmsPayload,
} from "../../../../../lib/integrations/inbound-sms";
import {
  getTwilioConfig,
  twilioWebhookCanonicalUrlCandidates,
  twilioWebhookResponse,
  validateTwilioWebhookSignature,
  TWILIO_PROVIDER,
} from "../../../../../lib/integrations/twilio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

export async function POST(request: Request) {
  const params = await formParams(request);

  if (!signatureValid(request, params)) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }

  const payload = normalizeInboundSmsPayload(params);

  if (!payload) {
    return twilioWebhookResponse();
  }

  await processInboundSmsPayload(payload, {
    schedule: (task) => after(task),
  });

  return twilioWebhookResponse();
}
