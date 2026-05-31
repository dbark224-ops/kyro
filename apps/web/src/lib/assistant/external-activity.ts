import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compactTranscriptPreview,
  getRecentVoiceCallsForActivity,
  isVoiceCallTableMissing,
} from "../voice/calls";

type MessageActivityRow = {
  body_text: string | null;
  channel:
    | {
        display_name: string | null;
        type: string | null;
      }
    | Array<{
        display_name: string | null;
        type: string | null;
      }>
    | null;
  contact:
    | {
        company: string | null;
        email: string | null;
        name: string | null;
        phone: string | null;
      }
    | Array<{
        company: string | null;
        email: string | null;
        name: string | null;
        phone: string | null;
      }>
    | null;
  conversation_id: string | null;
  created_at: string;
  direction: string;
  id: string;
  received_at: string | null;
  sent_at: string | null;
  subject: string | null;
};

type OutboundActivityRow = {
  body_text: string;
  channel_type: string;
  conversation_id: string | null;
  created_at: string;
  failed_at: string | null;
  id: string;
  last_error: string | null;
  provider: string | null;
  recipient: string | null;
  sent_at: string | null;
  service: string | null;
  status: string;
  subject: string | null;
};

export type AssistantExternalActivityItem = {
  at: string;
  href: string | null;
  id: string;
  meta: string;
  preview: string;
  subject: string | null;
  title: string;
  tone: "failed" | "inbound" | "outbound" | "system";
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function truncate(value: string | null, maxLength = 140) {
  if (!value) {
    return "No message body recorded";
  }

  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 1))}...`
    : value;
}

function cleanPreview(value: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? null;
}

function channelKind(value: string) {
  const lower = value.toLowerCase();

  if (lower.includes("sms") || lower.includes("text")) {
    return "SMS";
  }

  if (
    lower.includes("phone") ||
    lower.includes("call") ||
    lower.includes("voice")
  ) {
    return "Phone";
  }

  if (
    lower.includes("email") ||
    lower.includes("gmail") ||
    lower.includes("outlook") ||
    lower.includes("microsoft")
  ) {
    return "Email";
  }

  return formatLabel(value);
}

function contactRoute(row: MessageActivityRow, channel: string) {
  const contact = firstRelation(row.contact);
  const kind = channelKind(channel);

  if (kind === "SMS" || kind === "Phone") {
    return (
      textValue(contact?.phone) ??
      textValue(contact?.email) ??
      textValue(contact?.name) ??
      textValue(contact?.company) ??
      "Unknown contact"
    );
  }

  return (
    textValue(contact?.email) ??
    textValue(contact?.phone) ??
    textValue(contact?.name) ??
    textValue(contact?.company) ??
    "Unknown contact"
  );
}

function channelLabel(row: MessageActivityRow) {
  const channel = firstRelation(row.channel);

  return textValue(channel?.type) ?? textValue(channel?.display_name) ?? "CRM";
}

function channelRoute(channel: string, destination: string | null) {
  const route = textValue(destination);
  const kind = channelKind(channel);

  return route ? `${kind} - ${route}` : kind;
}

function activityTitle(channel: string, direction: "inbound" | "outbound") {
  const kind = channelKind(channel);

  if (kind === "SMS") {
    return direction === "inbound" ? "SMS inbound" : "SMS outbound";
  }

  if (kind === "Phone") {
    return direction === "inbound" ? "Phone inbound" : "Phone outbound";
  }

  return direction === "outbound" ? "Outbound message" : "Inbound message";
}

function toMessageActivity(row: MessageActivityRow): AssistantExternalActivityItem {
  const direction = row.direction === "outbound" ? "outbound" : "inbound";
  const at =
    direction === "outbound"
      ? (row.sent_at ?? row.created_at)
      : (row.received_at ?? row.created_at);
  const channel = channelLabel(row);
  const subject = textValue(row.subject);
  const body = textValue(row.body_text);

  return {
    at,
    href: row.conversation_id ? `/inbox?conversationId=${row.conversation_id}` : null,
    id: `message:${row.id}`,
    meta: channelRoute(channel, contactRoute(row, channel)),
    preview: truncate(cleanPreview(body), 180),
    subject: channelKind(channel) === "SMS" ? null : subject,
    title: activityTitle(channel, direction),
    tone: direction,
  };
}

function toOutboxActivity(
  row: OutboundActivityRow,
): AssistantExternalActivityItem {
  const failed = row.status === "failed" || Boolean(row.failed_at);
  const channel = formatLabel(row.channel_type || row.service || "outbound");
  const recipient = textValue(row.recipient) ?? "recipient";
  const subject = textValue(row.subject);
  const body = textValue(row.body_text);
  const kind = channelKind(channel);
  const title = failed
    ? `${kind} failed`
    : kind === "SMS"
      ? "SMS outbound"
      : kind === "Phone"
        ? "Phone outbound"
        : "Outbound message";

  return {
    at: row.failed_at ?? row.sent_at ?? row.created_at,
    href: row.conversation_id ? `/inbox?conversationId=${row.conversation_id}` : null,
    id: `outbox:${row.id}`,
    meta: channelRoute(channel, recipient),
    preview: failed
      ? (textValue(row.last_error) ?? `Could not send to ${recipient}.`)
      : truncate(cleanPreview(body), 180),
    subject: kind === "SMS" || failed ? null : subject,
    title,
    tone: failed ? "failed" : "outbound",
  };
}

function voiceCallTitle(row: Record<string, unknown>) {
  const purpose = textValue(row.purpose);
  const direction = row.direction === "outbound" ? "outbound" : "inbound";

  if (purpose === "voicemail_overflow") {
    return "Voicemail overflow";
  }

  if (purpose === "inbound_user") {
    return "User voice call";
  }

  return direction === "outbound" ? "Outbound phone call" : "Inbound phone call";
}

function toVoiceCallActivity(
  row: Record<string, unknown>,
): AssistantExternalActivityItem {
  const at =
    textValue(row.ended_at) ??
    textValue(row.started_at) ??
    textValue(row.created_at) ??
    new Date().toISOString();
  const direction = row.direction === "outbound" ? "outbound" : "inbound";
  const customer =
    textValue(row.customer_number) ??
    (direction === "outbound"
      ? textValue(row.to_number)
      : textValue(row.from_number)) ??
    "Unknown number";
  const summary = cleanPreview(textValue(row.summary));
  const transcriptPreview = compactTranscriptPreview(
    cleanPreview(textValue(row.transcript)),
    180,
  );
  const status = textValue(row.status) ?? "recorded";

  return {
    at,
    href: `/voice/calls/${row.id}`,
    id: `voice:${row.id}`,
    meta: `Phone - ${customer}`,
    preview:
      summary ??
      transcriptPreview ??
      textValue(row.ended_reason) ??
      `${formatLabel(status)} call recorded.`,
    subject: summary ? transcriptPreview : null,
    title: voiceCallTitle(row),
    tone:
      status === "failed" || status === "missed"
        ? "failed"
        : direction === "outbound"
          ? "outbound"
          : "inbound",
  };
}

function isUnavailableRelationError(error: { code?: string; message: string }) {
  const message = error.message.toLowerCase();

  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

export async function getAssistantExternalActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 12,
) {
  const [messagesResult, outboxResult, voiceCallsResult] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id,direction,subject,body_text,conversation_id,created_at,received_at,sent_at,contact:contacts(name,company,email,phone),channel:channels(type,display_name)",
      )
      .eq("workspace_id", workspaceId)
      .in("direction", ["inbound", "outbound"])
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("outbound_messages")
      .select(
        "id,channel_type,recipient,subject,body_text,status,created_at,sent_at,failed_at,last_error,conversation_id,provider,service",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit),
    getRecentVoiceCallsForActivity(supabase, workspaceId, limit).catch(
      (error) => {
        if (isVoiceCallTableMissing(error)) {
          return [];
        }

        throw error;
      },
    ),
  ]);

  if (messagesResult.error) {
    if (!isUnavailableRelationError(messagesResult.error)) {
      throw new Error(
        `Unable to load assistant activity messages: ${messagesResult.error.message}`,
      );
    }
  }

  if (outboxResult.error) {
    if (!isUnavailableRelationError(outboxResult.error)) {
      throw new Error(
        `Unable to load assistant outbox activity: ${outboxResult.error.message}`,
      );
    }
  }

  return [
    ...(
      (messagesResult.error
        ? []
        : (messagesResult.data ?? [])) as MessageActivityRow[]
    ).map(toMessageActivity),
    ...(
      (outboxResult.error
        ? []
        : (outboxResult.data ?? [])) as OutboundActivityRow[]
    ).map(toOutboxActivity),
    ...voiceCallsResult.map(toVoiceCallActivity),
  ]
    .sort((left, right) => {
      const leftTime = new Date(left.at).getTime();
      const rightTime = new Date(right.at).getTime();

      return rightTime - leftTime;
    })
    .slice(0, limit);
}
