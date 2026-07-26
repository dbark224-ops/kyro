import { after, NextResponse } from "next/server";
import {
  isTrustedInternalMessagingSender,
  processInternalAssistantMessage,
  trustedInternalPhoneMatches,
} from "../../../../../lib/assistant/internal-messaging";
import {
  getTwilioConfig,
  telephonyUsageCost,
  twilioWebhookCanonicalUrlCandidates,
  twilioWebhookResponse,
  validateTwilioWebhookSignature,
  TWILIO_PROVIDER,
  TWILIO_WHATSAPP_SANDBOX_WEBHOOK_PATH,
} from "../../../../../lib/integrations/twilio";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import { resolveWorkspaceUsageMarkupRate } from "../../../../../lib/usage/workspace-markup";
import { textValue } from "@kyro/core";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

type SandboxMessage = {
  body: string;
  eventId: string;
  from: string;
  messageSid: string;
  to: string;
  workspace: {
    id: string;
    name: string;
    ownerUserId: string;
  };
};

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

async function loadSandboxWorkspace(supabase: ServiceSupabase) {
  const workspaceId = textValue(
    process.env.TWILIO_WHATSAPP_SANDBOX_WORKSPACE_ID,
  );

  if (!workspaceId) {
    return null;
  }

  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load WhatsApp Sandbox workspace: ${error.message}`,
    );
  }

  const ownerUserId = textValue(data?.owner_user_id);

  if (!data || !ownerUserId) {
    return null;
  }

  return {
    id: String(data.id),
    name: textValue(data.name) ?? "Kyro workspace",
    ownerUserId,
  };
}

async function trustedInternalSender(
  supabase: ServiceSupabase,
  workspaceId: string,
  from: string,
) {
  const expectedRecipient = textValue(
    process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT,
  );

  if (
    !expectedRecipient ||
    !trustedInternalPhoneMatches(from, [expectedRecipient])
  ) {
    return false;
  }

  return isTrustedInternalMessagingSender(supabase, workspaceId, from);
}

async function reserveInboundEvent(
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
      idempotency_key: `twilio.whatsapp.inbound.${input.messageSid}`,
      payload: {
        body: input.body,
        from: input.from,
        messageSid: input.messageSid,
        to: input.to,
        transport: "whatsapp_sandbox",
      },
      source: "twilio.webhook",
      status: "pending",
      type: "inbound.whatsapp_sandbox.received",
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    return null;
  }

  if (error || !data) {
    throw new Error(
      `Unable to reserve WhatsApp Sandbox message: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(data.id);
}

async function recordInboundUsage(
  supabase: ServiceSupabase,
  input: SandboxMessage,
) {
  const usage = telephonyUsageCost({
    direction: "inbound",
    kind: "sms",
    markupRate: await resolveWorkspaceUsageMarkupRate(
      supabase,
      input.workspace.id,
      "TWILIO_MARKUP_RATE",
    ),
  });

  const { error } = await supabase.from("usage_events").insert({
    cost_snapshot: String(usage.cost),
    currency: usage.currency,
    customer_charge_snapshot: String(usage.customerCharge),
    markup_snapshot: String(usage.markup),
    metadata: {
      billingTask: "whatsapp_sandbox_delivery",
      direction: "inbound",
      from: input.from,
      to: input.to,
      transport: "whatsapp_sandbox",
    },
    model: null,
    provider: TWILIO_PROVIDER,
    provider_usage_id: input.messageSid,
    quantity: "1",
    service: "whatsapp_sandbox",
    source_id: input.eventId,
    source_type: "event",
    unit: "message",
    unit_cost_snapshot: String(usage.cost),
    usage_type: "inbound_whatsapp_message",
    user_id: null,
    workspace_id: input.workspace.id,
  });

  if (error) {
    throw new Error(
      `Unable to meter inbound WhatsApp message: ${error.message}`,
    );
  }
}

async function markInboundEvent(
  supabase: ServiceSupabase,
  eventId: string,
  status: "failed" | "processed",
) {
  await supabase
    .from("events")
    .update({
      processed_at: new Date().toISOString(),
      status,
    })
    .eq("id", eventId);
}

async function processSandboxMessage(input: SandboxMessage) {
  const supabase = createServiceSupabaseClient();

  try {
    await recordInboundUsage(supabase, input);
    await processInternalAssistantMessage({
      eventId: input.eventId,
      from: input.from,
      messageSid: input.messageSid,
      prompt: input.body,
      supabase,
      transport: "whatsapp_sandbox",
      workspace: input.workspace,
    });
    await markInboundEvent(supabase, input.eventId, "processed");
  } catch (error) {
    console.error("WhatsApp Sandbox assistant turn failed", error);
    await markInboundEvent(supabase, input.eventId, "failed");
  }
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(
      process.env.TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT?.trim() &&
      process.env.TWILIO_WHATSAPP_SANDBOX_WORKSPACE_ID?.trim(),
    ),
    endpoint: "whatsapp_sandbox",
    expects: "Twilio form-encoded POST with x-twilio-signature.",
    ok: true,
    path: TWILIO_WHATSAPP_SANDBOX_WEBHOOK_PATH,
    provider: TWILIO_PROVIDER,
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
  const workspace = await loadSandboxWorkspace(supabase);

  if (!workspace) {
    console.error("WhatsApp Sandbox workspace is not configured.");
    return twilioWebhookResponse();
  }

  if (!(await trustedInternalSender(supabase, workspace.id, from))) {
    console.warn("Rejected untrusted WhatsApp Sandbox sender", {
      messageSid,
      workspaceId: workspace.id,
    });
    return twilioWebhookResponse();
  }

  const eventId = await reserveInboundEvent(supabase, {
    body,
    from,
    messageSid,
    to,
    workspaceId: workspace.id,
  });

  if (!eventId) {
    return twilioWebhookResponse();
  }

  after(() =>
    processSandboxMessage({
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
