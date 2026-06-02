import { NextResponse } from "next/server";
import {
  getVapiConfig,
  VAPI_TOOL_PATH,
  VAPI_WEBHOOK_PATH,
  vapiEndpointUrl,
  verifyVapiWebhookRequest,
} from "../../../../../lib/integrations/vapi";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import { upsertVoiceCallFromVapiEvent } from "../../../../../lib/voice/calls";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getVapiConfig();

  return NextResponse.json({
    configured: Boolean(config),
    endpoint: "vapi_webhook",
    expects: "Vapi JSON POST with x-kyro-vapi-secret or bearer secret.",
    ok: true,
    provider: "vapi",
    serverApiKeyReady: Boolean(process.env.VAPI_API_KEY?.trim()),
    toolSecretReady: Boolean(process.env.VAPI_TOOL_SECRET?.trim()),
    toolUrl: vapiEndpointUrl(VAPI_TOOL_PATH),
    webhookSecretReady: Boolean(process.env.VAPI_WEBHOOK_SECRET?.trim()),
    webhookUrl: vapiEndpointUrl(VAPI_WEBHOOK_PATH),
  });
}

export async function POST(request: Request) {
  if (!verifyVapiWebhookRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const supabase = createServiceSupabaseClient();
    const result = await upsertVoiceCallFromVapiEvent(supabase, payload);

    return NextResponse.json({ data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process Vapi event.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
