import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { resolveAssistantCommand } from "../../../../../lib/assistant/commands";
import {
  linkCardsBlock,
  linksFromBlocks,
  normalizeAssistantUiBlocks,
  summaryCardsBlock,
} from "../../../../../lib/assistant/ui-blocks";
import {
  assistantWebSearchEnabled,
  runAssistantWebSearch,
} from "../../../../../lib/assistant/web-search";
import { updateContactFromAssistantTool } from "../../../../../lib/crm/contact-update-tool";
import {
  approveAction,
  executeAction,
} from "../../../../../lib/engine/event-action-audit";
import { recordOutboundMessage } from "../../../../../lib/communication/outbound";
import {
  syncInboundEmail,
  type InboundEmailProvider,
} from "../../../../../lib/integrations/inbound-email-sync";
import {
  getVapiConfig,
  VAPI_TOOL_PATH,
  vapiEndpointUrl,
  verifyVapiToolRequest,
} from "../../../../../lib/integrations/vapi";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import {
  buildLlmUsageEvents,
  buildOpenAiWebSearchCallUsageEvent,
  openAiUsageFromTokenCounts,
  toUsageEventRows,
  usageEventTotals,
} from "../../../../../lib/usage/openai";
import {
  createOutboundVoiceCall,
  lookupVoiceContactsForTool,
  recordVoiceToolEvent,
  vapiToolCallMetadata,
  vapiToolCallPayload,
  vapiToolThreadId,
  vapiToolUserId,
  vapiToolWorkspaceId,
} from "../../../../../lib/voice/calls";
import { resolveOutboundCallRequest } from "../../../../../lib/voice/outbound-call-requests";
import type { WorkspaceSummary } from "../../../../../lib/workspace/bootstrap";

export const dynamic = "force-dynamic";

type VoiceContactMatch = Awaited<ReturnType<typeof lookupVoiceContactsForTool>>[number];

type DraftSmsActionRow = {
  id: string;
  input: unknown;
  status: string;
  target_id: string | null;
  target_type: string | null;
  type: string;
};

export async function GET() {
  const config = getVapiConfig();

  return NextResponse.json({
    configured: Boolean(config),
    endpoint: "vapi_tool",
    expects: "Vapi tool JSON POST with x-kyro-vapi-secret or bearer secret.",
    ok: true,
    provider: "vapi",
    serverApiKeyReady: Boolean(process.env.VAPI_API_KEY?.trim()),
    toolSecretReady: Boolean(process.env.VAPI_TOOL_SECRET?.trim()),
    toolUrl: vapiEndpointUrl(VAPI_TOOL_PATH),
  });
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toolResultText(result: Record<string, unknown>) {
  const answer = textValue(result.answer) ?? textValue(result.message);
  const sources = Array.isArray(result.sources)
    ? result.sources
        .map((source) => {
          const sourceRecord =
            source && typeof source === "object"
              ? (source as Record<string, unknown>)
              : {};
          const label = textValue(sourceRecord.label);
          const href = textValue(sourceRecord.href);

          return label && href ? `${label}: ${href}` : href;
        })
        .filter((source): source is string => Boolean(source))
    : [];

  if (answer) {
    return singleLine(
      sources.length > 0
        ? `${answer} Sources: ${sources.slice(0, 4).join("; ")}`
        : answer,
    );
  }

  return singleLine(JSON.stringify(result));
}

function toolResponse(
  result: Record<string, unknown>,
  toolCallId?: string | null,
) {
  const resultText = toolResultText(result);

  return NextResponse.json({
    ...result,
    result,
    results: toolCallId
      ? [
          {
            result: resultText,
            toolCallId,
          },
        ]
      : undefined,
  });
}

function toolUser(userId: string): User {
  return { id: userId } as User;
}

function contactCardsForVoiceTool(
  contacts: Awaited<ReturnType<typeof lookupVoiceContactsForTool>>,
) {
  return summaryCardsBlock(
    "Matching contacts",
    contacts.map((contact) => ({
      detail:
        contact.company ??
        contact.email ??
        contact.phone ??
        contact.address ??
        undefined,
      href: `/contacts/${contact.id}`,
      label: contact.name ?? contact.company ?? "Contact",
      tone: "cyan",
      value: contact.contactType ?? "Contact",
    })),
  );
}

function shouldAttachContactCardsForVoicePrompt(prompt: string) {
  return /\b(card|contact|profile|details?|pull up|open|show me)\b/i.test(prompt);
}

function hasContactPreviewLink(uiBlocks: unknown) {
  return linksFromBlocks(normalizeAssistantUiBlocks(uiBlocks)).some((link) => {
    try {
      const url = new URL(link.href, "http://kyro.local");
      return url.pathname === "/contacts" || /^\/contacts\/[^/]+$/.test(url.pathname);
    } catch {
      return false;
    }
  });
}

function vapiToolCanStartOutboundCall(payload: Record<string, unknown>) {
  const metadata = vapiToolCallMetadata(payload);
  const purpose = textValue(metadata.purpose);
  const callerRole = textValue(metadata.callerRole);
  const source = textValue(metadata.source);

  if (callerRole === "internal_user" || purpose === "inbound_user") {
    return true;
  }

  return source === "kyro.vapi_internal_voice";
}

function vapiToolCanSendOutboundSms(payload: Record<string, unknown>) {
  return vapiToolCanStartOutboundCall(payload);
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function actionBody(action: DraftSmsActionRow) {
  const input = objectRecord(action.input);
  return (
    textValue(input.body) ??
    textValue(input.message) ??
    textValue(input.replyBody) ??
    textValue(input.text)
  );
}

function actionChannel(action: DraftSmsActionRow) {
  const input = objectRecord(action.input);
  return (
    textValue(input.channelType) ??
    textValue(input.channel) ??
    textValue(input.deliveryChannel)
  )?.toLowerCase();
}

function isSmsDraftAction(action: DraftSmsActionRow) {
  if (!["draft_reply", "send_outbound_message"].includes(action.type)) {
    return false;
  }

  const channel = actionChannel(action);
  return channel === "sms" && Boolean(actionBody(action));
}

async function loadContactById({
  contactId,
  supabase,
  workspaceId,
}: {
  contactId: string;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id,name,email,phone,address,company,contact_type")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load contact: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    address: textValue(data.address),
    company: textValue(data.company),
    contactType: textValue(data.contact_type),
    email: textValue(data.email),
    id: String(data.id),
    name: textValue(data.name),
    phone: textValue(data.phone),
  } satisfies VoiceContactMatch;
}

async function loadDraftSmsActionById({
  actionId,
  supabase,
  workspaceId,
}: {
  actionId: string;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("actions")
    .select("id,type,status,input,target_id,target_type")
    .eq("workspace_id", workspaceId)
    .eq("id", actionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load drafted SMS action: ${error.message}`);
  }

  return data as DraftSmsActionRow | null;
}

async function findLatestDraftSmsForContact({
  contactId,
  conversationId,
  supabase,
  workspaceId,
}: {
  contactId: string;
  conversationId: string | null;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  workspaceId: string;
}) {
  let conversationIds: string[] = [];

  if (conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .eq("id", conversationId)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to verify SMS conversation: ${error.message}`);
    }

    if (data?.id) {
      conversationIds = [String(data.id)];
    }
  } else {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      throw new Error(`Unable to load contact conversations: ${error.message}`);
    }

    conversationIds = (data ?? []).map((row) => String(row.id)).filter(Boolean);
  }

  if (conversationIds.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("actions")
    .select("id,type,status,input,target_id,target_type")
    .eq("workspace_id", workspaceId)
    .eq("target_type", "conversation")
    .in("target_id", conversationIds)
    .in("type", ["draft_reply", "send_outbound_message"])
    .in("status", ["pending_approval", "approved"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Unable to load drafted SMS actions: ${error.message}`);
  }

  return ((data ?? []) as DraftSmsActionRow[]).find(isSmsDraftAction) ?? null;
}

async function resolveDraftSmsContact({
  args,
  prompt,
  supabase,
  workspaceId,
}: {
  args: Record<string, unknown>;
  prompt: string | null;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  workspaceId: string;
}) {
  const contactId = textValue(args.contactId);

  if (contactId) {
    const contact = await loadContactById({ contactId, supabase, workspaceId });
    return contact ? [contact] : [];
  }

  return lookupVoiceContactsForTool({
    phoneNumber:
      textValue(args.phoneNumber) ??
      textValue(args.customerPhone) ??
      textValue(args.toNumber),
    query:
      textValue(args.contactName) ??
      textValue(args.customerName) ??
      textValue(args.query) ??
      prompt,
    supabase,
    workspaceId,
  });
}

async function executeDraftSmsActionForTool({
  action,
  supabase,
  userId,
}: {
  action: DraftSmsActionRow;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  userId: string;
}) {
  if (!isSmsDraftAction(action)) {
    throw new Error("The matched action is not a pending SMS draft.");
  }

  if (action.status === "pending_approval") {
    await approveAction(supabase, toolUser(userId), action.id);
  }

  await executeAction(supabase, toolUser(userId), action.id);
}

async function findOrCreateVapiSmsConversation({
  contactId,
  conversationId,
  supabase,
  workspaceId,
}: {
  contactId: string;
  conversationId: string | null;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  workspaceId: string;
}) {
  if (conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .eq("id", conversationId)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to verify SMS conversation: ${error.message}`);
    }

    if (data?.id) {
      return String(data.id);
    }
  }

  const { data: latestConversation, error: latestError } = await supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error(`Unable to load SMS conversation: ${latestError.message}`);
  }

  if (latestConversation?.id) {
    return String(latestConversation.id);
  }

  const externalId = "vapi_tool:sms";
  const { data: existingChannel, error: existingChannelError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("type", "sms")
    .eq("external_id", externalId)
    .maybeSingle();

  if (existingChannelError) {
    throw new Error(`Unable to load SMS channel: ${existingChannelError.message}`);
  }

  let channelId = existingChannel?.id ? String(existingChannel.id) : null;

  if (!channelId) {
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .insert({
        workspace_id: workspaceId,
        type: "sms",
        display_name: "Kyro SMS",
        external_id: externalId,
        status: "active",
        settings: {
          createdBy: "vapi_send_sms_tool",
          source: "vapi_tool",
        },
      })
      .select("id")
      .single();

    if (channelError || !channel) {
      throw new Error(
        `Unable to create SMS channel: ${channelError?.message ?? "unknown error"}`,
      );
    }

    channelId = String(channel.id);
  }

  const now = new Date().toISOString();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      workspace_id: workspaceId,
      channel_id: channelId,
      contact_id: contactId,
      lead_id: null,
      status: "open",
      last_message_at: now,
    })
    .select("id")
    .single();

  if (conversationError || !conversation) {
    throw new Error(
      `Unable to create SMS conversation: ${conversationError?.message ?? "unknown error"}`,
    );
  }

  return String(conversation.id);
}

function explicitSmsBody(args: Record<string, unknown>) {
  return (
    textValue(args.body) ??
    textValue(args.message) ??
    textValue(args.smsBody) ??
    textValue(args.text) ??
    textValue(args.replyBody)
  );
}

async function sendExplicitSmsForTool({
  args,
  body,
  contacts,
  idempotencyKey,
  supabase,
  userId,
  workspaceId,
}: {
  args: Record<string, unknown>;
  body: string;
  contacts: VoiceContactMatch[];
  idempotencyKey: string | null;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  userId: string;
  workspaceId: string;
}) {
  const contact = contacts[0];

  if (!contact.phone && !textValue(args.phoneNumber) && !textValue(args.toNumber)) {
    return {
      answer: "I found that contact, but they do not have a phone number saved yet.",
      contacts,
      ok: false,
      uiBlocks: contactCardsForVoiceTool(contacts),
    };
  }

  const conversationId = await findOrCreateVapiSmsConversation({
    contactId: contact.id,
    conversationId: textValue(args.conversationId),
    supabase,
    workspaceId,
  });

  const result = await recordOutboundMessage(supabase, {
    body,
    channelType: "sms",
    conversationId,
    idempotencyKey:
      textValue(args.idempotencyKey) ??
      (idempotencyKey
        ? `vapi_send_sms:${workspaceId}:${idempotencyKey}`
        : `vapi_send_sms:${workspaceId}:${contact.id}:${body}`),
    settingsSnapshot: {
      source: "vapi_send_sms_tool",
      requestedPhoneNumber:
        textValue(args.phoneNumber) ??
        textValue(args.customerPhone) ??
        textValue(args.toNumber) ??
        textValue(args.to) ??
        null,
    },
    source: "vapi_send_sms_tool",
    subject: null,
    userId,
    workspaceId,
  });

  const sentTo = contact.name ?? contact.company ?? contact.phone ?? "the contact";

  return {
    answer: result.externalSend
      ? `Sent the SMS to ${sentTo}.`
      : `Recorded the SMS for ${sentTo}, but external SMS sending is not active for this workspace.`,
    contactId: contact.id,
    conversationId,
    dryRun: result.dryRun,
    externalSend: result.externalSend,
    ok: true,
    outboundMessageId: result.outboundMessageId,
    uiBlocks: contactCardsForVoiceTool(contacts),
  };
}

function fieldLabel(value: string | null, label: string) {
  return value ? `${label} ${value}.` : null;
}

function describeMatchedContact(contact: {
  address?: string | null;
  company?: string | null;
  contactType?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
}) {
  return [
    contact.name ? `${contact.name}.` : "Matched contact found.",
    fieldLabel(contact.phone ?? null, "Phone"),
    fieldLabel(contact.email ?? null, "Email"),
    fieldLabel(contact.address ?? null, "Address"),
    fieldLabel(contact.company ?? null, "Company"),
    fieldLabel(contact.contactType ?? null, "Type"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function describeContactOptions(
  contacts: Awaited<ReturnType<typeof lookupVoiceContactsForTool>>,
) {
  return contacts
    .slice(0, 3)
    .map((contact, index) => {
      const parts = [
        `${index + 1}) ${contact.name ?? contact.company ?? "Contact"}`,
        contact.phone ? `phone ${contact.phone}` : null,
        contact.email ? `email ${contact.email}` : null,
        contact.company ? `company ${contact.company}` : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(", ");

      return parts;
    })
    .join(" ");
}

async function loadWorkspace(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  workspaceId: string,
): Promise<WorkspaceSummary> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `Unable to load Vapi tool workspace: ${error?.message ?? "not found"}`,
    );
  }

  return {
    id: String(data.id),
    name: String(data.name),
    slug: String(data.slug),
  };
}

async function recordWebSearchUsage({
  prompt,
  result,
  supabase,
  userId,
  workspaceId,
}: {
  prompt: string;
  result: Awaited<ReturnType<typeof runAssistantWebSearch>>;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  userId: string;
  workspaceId: string;
}) {
  if (result.fallbackReason) {
    return;
  }

  const model =
    process.env.ASSISTANT_WEB_SEARCH_MODEL?.trim() ||
    process.env.OPENAI_BALANCED_MODEL?.trim() ||
    process.env.ASSISTANT_MODEL?.trim() ||
    "gpt-4.1-mini";
  const tokenUsage =
    result.tokenUsage ??
    openAiUsageFromTokenCounts({
      estimated: true,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  const usageEvents = buildLlmUsageEvents({
    context: {
      metadata: { source: "vapi_internal_voice_web_search_tool" },
      providerUsageId: result.providerUsageId,
      userId,
      workspaceId,
    },
    model,
    provider: "openai",
    service: "llm",
    usage: tokenUsage,
  });

  if (result.webSearchUsed) {
    usageEvents.push(
      buildOpenAiWebSearchCallUsageEvent({
        context: {
          metadata: { source: "vapi_internal_voice_web_search_tool" },
          providerUsageId: result.providerUsageId,
          userId,
          workspaceId,
        },
        model,
      }),
    );
  }

  const totals = usageEventTotals(usageEvents);
  const { data: aiRun } = await supabase
    .from("ai_runs")
    .insert({
      actual_cost: String(totals.costSnapshot),
      completed_at: new Date().toISOString(),
      estimated_cost: String(totals.costSnapshot),
      input_refs: { prompt, source: "vapi_internal_voice_tool" },
      mode: "tool",
      model,
      output: {
        sourceCount: result.sources.length,
        webSearchUsed: result.webSearchUsed,
      },
      provider: "openai",
      risk_level: "low",
      status: "completed",
      task_type: "web_search",
      tool_calls: [],
      usage: {
        cachedInputTokens: tokenUsage.cachedInputTokens,
        customerCharge: totals.customerChargeSnapshot,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        reasoningTokens: tokenUsage.reasoningTokens,
        totalTokens: tokenUsage.totalTokens,
      },
      user_id: userId,
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (!aiRun?.id) {
    return;
  }

  const aiRunId = String(aiRun.id);

  await supabase.from("usage_events").insert(
    toUsageEventRows(
      usageEvents.map((event) => ({
        ...event,
        aiRunId,
        sourceId: aiRunId,
        sourceType: "ai_run",
      })),
    ),
  );
}

export async function POST(request: Request) {
  if (!verifyVapiToolRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  let toolCallId: string | null = null;

  try {
    const toolCall = vapiToolCallPayload(payload);
    toolCallId = toolCall.id ?? null;
    const workspaceId = vapiToolWorkspaceId(payload);

    if (!workspaceId) {
      return toolResponse({
        ok: false,
        message: "Kyro could not resolve a workspace for this tool call.",
      }, toolCallId);
    }

    const supabase = createServiceSupabaseClient();
    const args = toolCall.arguments;
    const userId = vapiToolUserId(payload);
    const threadId = vapiToolThreadId(payload);
    const prompt =
      textValue(args.prompt) ??
      textValue(args.query) ??
      textValue(args.request) ??
      textValue(args.message);

    await recordVoiceToolEvent({
      eventType: `tool.${toolCall.name ?? "unknown"}.requested`,
      payload,
      providerCallId: toolCall.callId,
      supabase,
      workspaceId,
    });

    const completedToolResponse = async (result: Record<string, unknown>) => {
      await recordVoiceToolEvent({
        eventType: `tool.${toolCall.name ?? "unknown"}.completed`,
        payload: {
          kyroProviderCallId: toolCall.callId,
          kyroThreadId: threadId,
          kyroToolCallId: toolCall.id,
          kyroToolName: toolCall.name,
          kyroToolResult: result,
          kyroUserId: userId,
          kyroWorkspaceId: workspaceId,
          uiBlocks: normalizeAssistantUiBlocks(result.uiBlocks),
        },
        providerCallId: toolCall.callId,
        supabase,
        workspaceId,
      });

      return toolResponse(result, toolCallId);
    };

    if (toolCall.name === "kyro_lookup_contact") {
      const contacts = await lookupVoiceContactsForTool({
        phoneNumber: textValue(args.phoneNumber),
        query: textValue(args.query),
        supabase,
        workspaceId,
      });
      const firstContact = contacts[0];
      const lookupAnswer =
        contacts.length === 0
          ? "No matching contacts found."
          : contacts.length === 1
            ? `Displayed the matching contact card. ${describeMatchedContact(firstContact)} If the user asked for one of those details, give it directly. Otherwise continue with the useful next step and avoid reading out unnecessary long details.`
            : `Displayed ${contacts.length} possible contact cards. Likely matches: ${describeContactOptions(contacts)} Ask the user which one they mean before taking action.`;

      return completedToolResponse({
        answer: lookupAnswer,
        contacts,
        count: contacts.length,
        ok: true,
        uiBlocks: contactCardsForVoiceTool(contacts),
      });
    }

    if (toolCall.name === "kyro_update_contact") {
      if (!userId) {
        return completedToolResponse({
          ok: false,
          message: "Kyro needs a user id to update contact profiles.",
        });
      }

      const result = await updateContactFromAssistantTool({
        args,
        source: "vapi_internal_voice",
        supabase,
        userId,
        workspaceId,
      });

      return completedToolResponse({
        ...result,
        uiBlocks:
          result.contacts && result.contacts.length > 0
            ? contactCardsForVoiceTool(result.contacts)
            : [],
      });
    }

    if (toolCall.name === "kyro_start_outbound_call") {
      if (!userId) {
        return completedToolResponse({
          ok: false,
          message: "Kyro needs a user id to start outbound phone calls.",
        });
      }

      if (!vapiToolCanStartOutboundCall(payload)) {
        return completedToolResponse({
          ok: false,
          message:
            "Outbound phone calls can only be started from trusted internal Kyro calls.",
        });
      }

      const phoneNumber =
        textValue(args.phoneNumber) ??
        textValue(args.customerPhone) ??
        textValue(args.toNumber) ??
        textValue(args.to);
      const instructions =
        textValue(args.instructions) ??
        textValue(args.callInstructions) ??
        textValue(args.message) ??
        textValue(args.note);
      const contextSummary =
        textValue(args.contextSummary) ??
        textValue(args.recentChatContext) ??
        textValue(args.callContext) ??
        textValue(args.outboundCallContext);
      const resolutionPrompt = [
        prompt,
        textValue(args.contactName),
        phoneNumber,
        instructions,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ");
      const resolution = await resolveOutboundCallRequest({
        contactId: textValue(args.contactId),
        contextSummary,
        conversationId: textValue(args.conversationId),
        instructions,
        leadId: textValue(args.leadId),
        phoneNumber,
        prompt: resolutionPrompt || "Outbound phone call",
        supabase,
        workspaceId,
      });

      if (resolution.status !== "ready") {
        const links = resolution.matches.map((contact) => ({
          href: `/contacts/${contact.id}`,
          label: contact.name ?? contact.company ?? contact.phone ?? "Contact",
          meta: contact.email ?? contact.phone ?? undefined,
        }));

        return completedToolResponse({
          answer:
            resolution.status === "ambiguous"
              ? "I found more than one possible contact. Ask the user which one they mean before starting the call."
              : resolution.status === "missing_phone"
                ? "That contact does not have a phone number saved yet."
                : resolution.status === "missing_instructions"
                  ? "Ask the user what Kyro should say on the outbound call."
                  : "I could not find a matching contact or phone number for that outbound call.",
          ok: false,
          resolution,
          uiBlocks: links.length
            ? linkCardsBlock("Possible call recipients", links)
            : [],
        });
      }

      const result = await createOutboundVoiceCall({
        contactId: resolution.contactId,
        contextSummary: resolution.contextSummary,
        conversationId: resolution.conversationId,
        instructions: resolution.instructions,
        leadId: resolution.leadId,
        phoneNumber: resolution.phoneNumber,
        supabase,
        threadId,
        user: toolUser(userId),
        workspaceId,
      });

      return completedToolResponse({
        answer: `Started the outbound call to ${
          resolution.contactName ?? resolution.phoneNumber
        }.`,
        ok: true,
        providerCallId: result.providerCallId,
        status: result.status,
        voiceCallId: result.voiceCallId,
      });
    }

    if (toolCall.name === "kyro_send_drafted_sms") {
      if (!userId) {
        return completedToolResponse({
          ok: false,
          message: "Kyro needs a user id to send drafted SMS replies.",
        });
      }

      if (!vapiToolCanSendOutboundSms(payload)) {
        return completedToolResponse({
          ok: false,
          message:
            "Drafted SMS replies can only be sent from trusted internal Kyro calls.",
        });
      }

      const explicitActionId = textValue(args.actionId);
      let draftAction = explicitActionId
        ? await loadDraftSmsActionById({
            actionId: explicitActionId,
            supabase,
            workspaceId,
          })
        : null;

      const contacts = explicitActionId
        ? []
        : await resolveDraftSmsContact({
            args,
            prompt,
            supabase,
            workspaceId,
          });

      if (!draftAction) {
        if (contacts.length === 0) {
          return completedToolResponse({
            answer:
              "I could not find a matching contact with a drafted SMS ready to send.",
            ok: false,
            uiBlocks: [],
          });
        }

        if (contacts.length > 1) {
          return completedToolResponse({
            answer:
              "I found more than one possible contact. Ask the user which one they mean before sending the drafted SMS.",
            contacts,
            ok: false,
            uiBlocks: contactCardsForVoiceTool(contacts),
          });
        }

        const contact = contacts[0];
        draftAction = await findLatestDraftSmsForContact({
          contactId: contact.id,
          conversationId: textValue(args.conversationId),
          supabase,
          workspaceId,
        });
      }

      if (!draftAction) {
        return completedToolResponse({
          answer:
            "I found the contact, but there is no pending drafted SMS ready to send.",
          contacts,
          ok: false,
          uiBlocks: contactCardsForVoiceTool(contacts),
        });
      }

      if (!isSmsDraftAction(draftAction)) {
        return completedToolResponse({
          answer:
            "I found that draft action, but it is not a pending SMS draft.",
          ok: false,
        });
      }

      await executeDraftSmsActionForTool({
        action: draftAction,
        supabase,
        userId,
      });

      const sentTo =
        contacts[0]?.name ??
        contacts[0]?.company ??
        contacts[0]?.phone ??
        "the contact";

      return completedToolResponse({
        answer: `Sent the drafted SMS to ${sentTo}.`,
        actionId: draftAction.id,
        ok: true,
        uiBlocks: contacts.length ? contactCardsForVoiceTool(contacts) : [],
      });
    }

    if (toolCall.name === "kyro_send_sms") {
      if (!userId) {
        return completedToolResponse({
          ok: false,
          message: "Kyro needs a user id to send SMS messages.",
        });
      }

      if (!vapiToolCanSendOutboundSms(payload)) {
        return completedToolResponse({
          ok: false,
          message:
            "SMS messages can only be sent from trusted internal Kyro calls.",
        });
      }

      const body = explicitSmsBody(args);
      const explicitActionId = textValue(args.actionId);

      if (explicitActionId && !body) {
        const draftAction = await loadDraftSmsActionById({
          actionId: explicitActionId,
          supabase,
          workspaceId,
        });

        if (!draftAction || !isSmsDraftAction(draftAction)) {
          return completedToolResponse({
            answer: "I could not find a pending drafted SMS for that action.",
            ok: false,
          });
        }

        await executeDraftSmsActionForTool({
          action: draftAction,
          supabase,
          userId,
        });

        return completedToolResponse({
          actionId: draftAction.id,
          answer: "Sent the drafted SMS.",
          ok: true,
        });
      }

      const contacts = await resolveDraftSmsContact({
        args,
        prompt,
        supabase,
        workspaceId,
      });

      if (contacts.length === 0) {
        return completedToolResponse({
          answer:
            "I could not find a matching contact to send that SMS to.",
          ok: false,
          uiBlocks: [],
        });
      }

      if (contacts.length > 1) {
        return completedToolResponse({
          answer:
            "I found more than one possible contact. Ask the user which one they mean before sending the SMS.",
          contacts,
          ok: false,
          uiBlocks: contactCardsForVoiceTool(contacts),
        });
      }

      if (!body) {
        const draftAction = await findLatestDraftSmsForContact({
          contactId: contacts[0].id,
          conversationId: textValue(args.conversationId),
          supabase,
          workspaceId,
        });

        if (!draftAction) {
          return completedToolResponse({
            answer:
              "I found the contact, but there is no drafted SMS ready to send. Ask the user what message they want sent.",
            contacts,
            ok: false,
            uiBlocks: contactCardsForVoiceTool(contacts),
          });
        }

        await executeDraftSmsActionForTool({
          action: draftAction,
          supabase,
          userId,
        });

        const sentTo =
          contacts[0].name ??
          contacts[0].company ??
          contacts[0].phone ??
          "the contact";

        return completedToolResponse({
          actionId: draftAction.id,
          answer: `Sent the drafted SMS to ${sentTo}.`,
          ok: true,
          uiBlocks: contactCardsForVoiceTool(contacts),
        });
      }

      return completedToolResponse(
        await sendExplicitSmsForTool({
          args,
          body,
          contacts,
          idempotencyKey: toolCall.id,
          supabase,
          userId,
          workspaceId,
        }),
      );
    }

    if (
      toolCall.name === "kyro_context_lookup" ||
      toolCall.name === "kyro_assistant_command"
    ) {
      if (!prompt || !userId) {
        return completedToolResponse({
          ok: false,
          message: "Kyro needs a prompt and user id for assistant context tools.",
        });
      }

      const workspace = await loadWorkspace(supabase, workspaceId);
      const result = await resolveAssistantCommand({
        prompt,
        supabase,
        threadId,
        user: toolUser(userId),
        workspace,
      });
      let answer = result.fallbackAnswer;
      let uiBlocks = result.uiBlocks ?? [];

      if (
        shouldAttachContactCardsForVoicePrompt(prompt) &&
        !hasContactPreviewLink(uiBlocks)
      ) {
        const contacts = await lookupVoiceContactsForTool({
          query: prompt,
          supabase,
          workspaceId,
        });

        if (contacts.length > 0) {
          uiBlocks = [
            ...uiBlocks,
            ...contactCardsForVoiceTool(contacts),
          ];
          const firstContact = contacts[0];
          answer =
            contacts.length === 1
              ? `Putting ${firstContact.name ?? firstContact.company ?? "that contact"} on screen now.`
              : `I found ${contacts.length} matching contacts. Pick the one you want on screen.`;
        }
      }

      return completedToolResponse({
        answer,
        context: result.context,
        intent: result.intent,
        links: result.links,
        mutation: result.mutation ?? null,
        ok: true,
        title: result.title,
        uiBlocks,
      });
    }

    if (toolCall.name === "kyro_web_search") {
      if (!prompt || !userId) {
        return completedToolResponse({
          ok: false,
          message: "Kyro needs a search prompt and user id for web search.",
        });
      }

      if (!assistantWebSearchEnabled()) {
        return completedToolResponse({
          ok: false,
          message: "Web search is disabled for this Kyro environment.",
        });
      }

      const result = await runAssistantWebSearch({ prompt });

      await recordWebSearchUsage({
        prompt,
        result,
        supabase,
        userId,
        workspaceId,
      });

      return completedToolResponse({
        answer: result.text,
        fallbackReason: result.fallbackReason ?? null,
        ok: true,
        sourceCount: result.sources.length,
        sources: result.sources,
        uiBlocks: linkCardsBlock("Web sources", result.sources),
        webSearchUsed: result.webSearchUsed,
      });
    }

    if (toolCall.name === "kyro_check_recent_email") {
      if (!userId) {
        return completedToolResponse({
          ok: false,
          message: "Kyro needs a user id to check connected inboxes.",
        });
      }

      const providerArg = textValue(args.provider);
      const provider: InboundEmailProvider | undefined =
        providerArg === "google" || providerArg === "microsoft"
          ? providerArg
          : undefined;
      const result = await syncInboundEmail({
        provider,
        supabase,
        trigger: "assistant",
        user: toolUser(userId),
        workspaceId,
      });
      const answer =
        result.needsReconnect.length > 0
          ? `I checked email, but ${result.needsReconnect.length} connected account needs reconnecting with inbox-read permission. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
          : result.errors.length > 0
            ? `I checked email with ${result.errors.length} issue(s). I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
            : `I checked email. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages} into Kyro, observed ${result.observedMessages}, and skipped ${result.duplicates} duplicate(s).`;

      return completedToolResponse({
        answer,
        ok: true,
        result,
      });
    }

    if (toolCall.name === "kyro_record_call_note") {
      await recordVoiceToolEvent({
        eventType: "tool.kyro_record_call_note.completed",
        payload: {
          ...payload,
          kyroNote: textValue(args.note),
          kyroPriority: textValue(args.priority),
        },
        providerCallId: toolCall.callId,
        supabase,
        workspaceId,
      });

      return completedToolResponse({
        ok: true,
        recorded: true,
      });
    }

    return completedToolResponse({
      ok: false,
      message: `Unsupported Kyro voice tool: ${toolCall.name ?? "unknown"}.`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run Vapi tool.";

    return toolResponse(
      {
        ok: false,
        message,
      },
      toolCallId,
    );
  }
}
