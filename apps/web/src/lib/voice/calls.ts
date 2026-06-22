import type { SupabaseClient } from "@supabase/supabase-js";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((item) => objectRecord(item))
        .filter((item) => Object.keys(item).length > 0)
    : [];
}

function jsonRecord(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return objectRecord(value);
  }

  try {
    return objectRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value);

    if (text) {
      return text;
    }
  }

  return null;
}

function vapiMessage(payload: Record<string, unknown>) {
  return objectRecord(payload.message);
}

function vapiCall(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);

  return objectRecord(message.call ?? payload.call ?? payload);
}

function providerCallId(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);
  const call = vapiCall(payload);

  return firstText(
    call.id,
    message.callId,
    payload.callId,
    payload.call_id,
    payload.id,
  );
}

function callMetadata(payload: Record<string, unknown>) {
  const call = vapiCall(payload);

  return objectRecord(call.metadata ?? payload.metadata);
}

function firstToolCall(payload: Record<string, unknown>) {
  const message = objectRecord(payload.message);
  const directToolCall = objectRecord(message.toolCall ?? payload.toolCall);
  const toolCalls = [
    ...arrayRecords(message.toolCalls),
    ...arrayRecords(message.toolCallList),
    ...arrayRecords(payload.toolCalls),
  ];

  return Object.keys(directToolCall).length > 0
    ? directToolCall
    : (toolCalls[0] ?? {});
}

function tableMissing(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("voice_calls") ||
    message.includes("voice_call_events") ||
    message.includes("does not exist")
  );
}

export function vapiToolCallPayload(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const rawArguments = toolCall.function
    ? jsonRecord(objectRecord(toolCall.function).arguments)
    : jsonRecord(toolCall.arguments);

  return {
    arguments: {
      ...rawArguments,
      ...objectRecord(payload.arguments),
    },
    callId: providerCallId(payload),
    id: textValue(toolCall.id ?? payload.toolCallId),
    name: firstText(
      objectRecord(toolCall.function).name,
      toolCall.name,
      payload.name,
    ),
  };
}

export function vapiToolWorkspaceId(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const toolFunction = objectRecord(toolCall.function);
  const args = jsonRecord(toolFunction.arguments ?? toolCall.arguments);
  const metadata = callMetadata(payload);

  return firstText(args.workspaceId, metadata.workspaceId, payload.workspaceId);
}

export function vapiToolUserId(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const toolFunction = objectRecord(toolCall.function);
  const args = jsonRecord(toolFunction.arguments ?? toolCall.arguments);
  const metadata = callMetadata(payload);

  return firstText(args.userId, metadata.userId, payload.userId);
}

export function vapiToolThreadId(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const toolFunction = objectRecord(toolCall.function);
  const args = jsonRecord(toolFunction.arguments ?? toolCall.arguments);
  const metadata = callMetadata(payload);

  return firstText(args.threadId, metadata.threadId, payload.threadId);
}

export async function lookupVoiceContactsForTool(input: {
  phoneNumber?: string | null;
  query?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const query = input.query?.trim() ?? "";
  let request = input.supabase
    .from("contacts")
    .select("id,name,company,email,phone,address,contact_type")
    .eq("workspace_id", input.workspaceId)
    .is("merged_into_contact_id", null)
    .limit(10);

  if (input.phoneNumber?.trim()) {
    request = request.ilike("phone", `%${input.phoneNumber.trim()}%`);
  } else if (query) {
    request = request.or(
      `name.ilike.%${query}%,company.ilike.%${query}%,email.ilike.%${query}%`,
    );
  }

  const { data, error } = await request;

  if (error) {
    throw new Error(`Unable to search voice contacts: ${error.message}`);
  }

  return ((data ?? []) as Record<string, unknown>[]).map((contact) => ({
    address: textValue(contact.address),
    company: textValue(contact.company),
    contactType: textValue(contact.contact_type),
    email: textValue(contact.email),
    id: String(contact.id),
    name: textValue(contact.name),
    phone: textValue(contact.phone),
  }));
}

export async function recordVoiceToolEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
  providerCallId?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { error } = await input.supabase.from("voice_call_events").insert({
    event_type: input.eventType,
    payload: input.payload,
    provider: "vapi",
    workspace_id: input.workspaceId,
  });

  if (error && !tableMissing(error)) {
    throw new Error(`Unable to record voice tool event: ${error.message}`);
  }

  return { voiceCallId: null };
}

export async function upsertVoiceCallFromVapiEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const metadata = callMetadata(payload);
  const workspaceId = firstText(metadata.workspaceId, payload.workspaceId);

  if (!workspaceId) {
    return {
      callId: null,
      ignored: true,
      reason: "No workspace could be resolved for this Vapi call.",
    };
  }

  const { error } = await supabase.from("voice_call_events").insert({
    event_type: firstText(vapiMessage(payload).type, payload.type) ?? "unknown",
    payload,
    provider: "vapi",
    workspace_id: workspaceId,
  });

  if (error && !tableMissing(error)) {
    throw new Error(`Unable to record Vapi event: ${error.message}`);
  }

  return { callId: null, ignored: false, reason: null };
}
