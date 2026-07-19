import { after, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { runAssistantTurn } from "../../../../../lib/assistant/engine";
import {
  appendAssistantTurnMessage,
  appendUserAssistantMessage,
  getAssistantTurnContext,
  getOrCreateAssistantThread,
  updateAssistantThreadSummary,
} from "../../../../../lib/assistant/persistence";
import { getVoiceSettings } from "../../../../../lib/assistant/voice-settings";
import { recordOutboundDirectSms } from "../../../../../lib/communication/outbound";
import { normalizeContactPhoneForRegion } from "../../../../../lib/crm/identity";
import { sendInternalBugNotification } from "../../../../../lib/internal-notifications";
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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function barePhone(value: string) {
  return value.replace(/^whatsapp:/i, "").trim();
}

function normalizedPhone(value: string) {
  return (
    normalizeContactPhoneForRegion(barePhone(value), null) ?? barePhone(value)
  );
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

async function loadOwnerUser(supabase: ServiceSupabase, ownerUserId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(ownerUserId);

  if (error || !data.user) {
    throw new Error(
      `Unable to load WhatsApp Sandbox user: ${error?.message ?? "unknown error"}`,
    );
  }

  return data.user;
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
    normalizedPhone(from) !== normalizedPhone(expectedRecipient)
  ) {
    return false;
  }

  const voiceSettings = await getVoiceSettings(supabase, workspaceId);

  return voiceSettings.phoneAgentUserNumbers.some(
    (phoneNumber) => normalizedPhone(phoneNumber) === normalizedPhone(from),
  );
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
  let user: User | null = null;

  try {
    user = await loadOwnerUser(supabase, input.workspace.ownerUserId);
    await recordInboundUsage(supabase, input);

    const workspace = {
      id: input.workspace.id,
      name: input.workspace.name,
    };
    const thread = await getOrCreateAssistantThread(supabase, workspace, user);
    const threadId = String(thread.id);
    const prompt = input.body;

    await appendUserAssistantMessage({
      content: prompt,
      inputSource: "whatsapp",
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });

    const context = await getAssistantTurnContext({
      prompt,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const result = await runAssistantTurn({
      contextSnapshots: context.contextSnapshots,
      inputSource: "whatsapp",
      memories: context.memories,
      prompt,
      recentMessages: context.recentMessages,
      supabase,
      threadId,
      threadSummary: context.summary,
      user,
      workspace,
    });

    await appendAssistantTurnMessage({
      result,
      supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    await updateAssistantThreadSummary({
      prompt,
      result,
      supabase,
      threadId,
      workspaceId: workspace.id,
    });

    await recordOutboundDirectSms(supabase, {
      body: result.content,
      consentNote:
        "Trusted internal user testing Kyro through WhatsApp Sandbox.",
      idempotencyKey: `whatsapp.sandbox.reply.${input.messageSid}`,
      metadata: {
        inboundEventId: input.eventId,
        inboundMessageSid: input.messageSid,
        transport: "whatsapp_sandbox",
      },
      recipientName: user.user_metadata?.full_name ?? user.email ?? "Kyro user",
      recipientPhone: barePhone(input.from),
      source: "assistant.whatsapp_sandbox",
      userId: user.id,
      workspaceId: workspace.id,
    });

    await markInboundEvent(supabase, input.eventId, "processed");
  } catch (error) {
    console.error("WhatsApp Sandbox assistant turn failed", error);
    await markInboundEvent(supabase, input.eventId, "failed");

    await sendInternalBugNotification({
      context: {
        userEmail: user?.email ?? null,
        userId: input.workspace.ownerUserId,
        workspaceId: input.workspace.id,
        workspaceName: input.workspace.name,
      },
      input: {
        context: {
          inboundEventId: input.eventId,
          messageSid: input.messageSid,
          transport: "whatsapp_sandbox",
        },
        eventKey: `whatsapp-sandbox-${input.messageSid}`,
        kind: "WhatsApp Sandbox assistant failure",
        rawMessage: error instanceof Error ? error.message : String(error),
        severity: "error",
        source: "api.integrations.twilio.whatsapp",
        visibleMessage: "Kyro did not return a WhatsApp Sandbox response.",
      },
    }).catch((notificationError) => {
      console.error(
        "Unable to send WhatsApp Sandbox failure notification",
        notificationError,
      );
    });
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
