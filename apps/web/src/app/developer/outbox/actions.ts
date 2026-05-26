"use server";

import { retryOutboundMessage } from "../../../lib/communication/outbound";
import { insertAuditLog } from "../../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const RETRYABLE_OUTBOX_STATUSES = new Set([
  "queued",
  "retry_scheduled",
  "failed",
]);

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeOutboxRedirect(value: string) {
  return value.startsWith("/developer/outbox") && !value.startsWith("//")
    ? value
    : "/developer/outbox";
}

function redirectWithOutboxMessage(
  key: "engine_error" | "engine_message",
  message: string,
  returnTo: string,
): never {
  const target = safeOutboxRedirect(returnTo);
  const separator = target.includes("?") ? "&" : "?";

  redirect(`${target}${separator}${key}=${encodeURIComponent(message)}`);
}

function revalidateOutboxPaths(conversationId?: string | null) {
  revalidatePath("/");
  revalidatePath("/developer");
  revalidatePath("/developer/outbox");
  revalidatePath("/inbox");

  if (conversationId) {
    revalidatePath(`/inbox/${conversationId}`);
  }
}

export async function retryOutboxDeliveryAction(formData: FormData) {
  const outboundQueueId = formString(formData, "outboundQueueId");
  const returnTo = safeOutboxRedirect(formString(formData, "returnTo"));

  if (!outboundQueueId) {
    redirectWithOutboxMessage(
      "engine_error",
      "Outbound delivery id is required.",
      returnTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let result: Awaited<ReturnType<typeof retryOutboundMessage>>;

  try {
    result = await retryOutboundMessage(supabase, {
      workspaceId: workspace.id,
      outboundQueueId,
      userId: user.id,
    });
  } catch (error) {
    redirectWithOutboxMessage(
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to retry outbound delivery.",
      returnTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "outbound_message.manual_retry_completed",
    entityType: "outbound_message",
    entityId: outboundQueueId,
    after: {
      externalMessageId: result.externalMessageId,
      externalSend: result.externalSend,
      messageId: result.outboundMessageId,
      sentTo: result.sentTo,
      status: result.outboxStatus,
    },
    metadata: {
      conversationId: result.conversationId || null,
      source: "developer.outbox_operations",
    },
  });

  revalidateOutboxPaths(result.conversationId || null);
  redirectWithOutboxMessage(
    "engine_message",
    result.externalSend
      ? "Outbound delivery retried and sent."
      : "Outbound delivery retried and recorded.",
    returnTo,
  );
}

export async function dismissOutboxDeliveryAction(formData: FormData) {
  const outboundQueueId = formString(formData, "outboundQueueId");
  const returnTo = safeOutboxRedirect(formString(formData, "returnTo"));

  if (!outboundQueueId) {
    redirectWithOutboxMessage(
      "engine_error",
      "Outbound delivery id is required.",
      returnTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: row, error: loadError } = await supabase
    .from("outbound_messages")
    .select("id,status,metadata,conversation_id,event_id,action_id")
    .eq("workspace_id", workspace.id)
    .eq("id", outboundQueueId)
    .maybeSingle();

  if (loadError) {
    redirectWithOutboxMessage("engine_error", loadError.message, returnTo);
  }

  if (!row) {
    redirectWithOutboxMessage(
      "engine_error",
      "Outbound delivery was not found.",
      returnTo,
    );
  }

  const beforeStatus = String(row.status);

  if (!RETRYABLE_OUTBOX_STATUSES.has(beforeStatus)) {
    redirectWithOutboxMessage(
      "engine_error",
      "Only queued, scheduled, or failed outbox rows can be dismissed.",
      returnTo,
    );
  }

  const dismissedAt = new Date().toISOString();
  const metadata = {
    ...objectRecord(row.metadata),
    dismissedAt,
    dismissedByUserId: user.id,
    dismissedReason: "Dismissed from outbox operations.",
  };
  const { data: dismissed, error: updateError } = await supabase
    .from("outbound_messages")
    .update({
      failed_at: null,
      last_error: null,
      metadata,
      next_attempt_at: null,
      sending_at: null,
      status: "dismissed",
    })
    .eq("workspace_id", workspace.id)
    .eq("id", outboundQueueId)
    .in("status", Array.from(RETRYABLE_OUTBOX_STATUSES))
    .select("id")
    .maybeSingle();

  if (updateError) {
    redirectWithOutboxMessage("engine_error", updateError.message, returnTo);
  }

  if (!dismissed) {
    redirectWithOutboxMessage(
      "engine_error",
      "Unable to dismiss outbound delivery because its status changed.",
      returnTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "outbound_message.dismissed",
    entityType: "outbound_message",
    entityId: outboundQueueId,
    before: {
      status: beforeStatus,
    },
    after: {
      dismissedAt,
      status: "dismissed",
    },
    metadata: {
      actionId: row.action_id ? String(row.action_id) : null,
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      eventId: row.event_id ? String(row.event_id) : null,
      source: "developer.outbox_operations",
    },
  });

  revalidateOutboxPaths(row.conversation_id ? String(row.conversation_id) : null);
  redirectWithOutboxMessage(
    "engine_message",
    "Outbound delivery dismissed.",
    returnTo,
  );
}
