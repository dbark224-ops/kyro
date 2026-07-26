import type { SupabaseClient } from "@supabase/supabase-js";
import { recordOutboundDirectSms } from "../communication/outbound";
import { textValue } from "@kyro/core";

export type AssistantDeliveryOrigin = {
  inputSource: string;
  phoneNumber: string | null;
  threadId: string;
  userId: string;
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function assistantDeliveryOrigin(value: unknown) {
  const origin = objectRecord(objectRecord(value).assistantRequestOrigin);
  const threadId = textValue(origin.threadId);
  const userId = textValue(origin.userId);

  if (!threadId || !userId) {
    return null;
  }

  return {
    inputSource: textValue(origin.inputSource) ?? "typed",
    phoneNumber: textValue(origin.phoneNumber),
    threadId,
    userId,
  } satisfies AssistantDeliveryOrigin;
}

export function assistantDeliveryFailureReason({
  errorCode,
  errorMessage,
}: {
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const message = errorMessage?.trim() ?? "";

  if (/does not have an email address/i.test(message)) {
    return "the contact does not have an email address";
  }

  if (/does not have a phone number/i.test(message)) {
    return "the contact does not have a phone number";
  }

  if (
    ["30017", "30032", "30034", "30035", "30036"].includes(errorCode ?? "") ||
    /a2p|campaign|compliance|messaging.*disabled/i.test(message)
  ) {
    return "outbound SMS is not currently available for this number";
  }

  if (["30003", "30005", "30006"].includes(errorCode ?? "")) {
    return "the recipient could not receive the message";
  }

  return "the delivery provider did not complete the send";
}

export async function reportAssistantDeliveryFailure({
  errorCode,
  errorMessage,
  origin,
  outboundQueueId,
  recipient,
  supabase,
  workspaceId,
}: {
  errorCode?: string | null;
  errorMessage?: string | null;
  origin: AssistantDeliveryOrigin;
  outboundQueueId: string;
  recipient?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const reason = assistantDeliveryFailureReason({ errorCode, errorMessage });
  const recipientLabel = recipient?.trim() || "the customer";
  const content = `Kyro prepared the reply to ${recipientLabel}, but it was not delivered because ${reason}. The reply remains available in Kyro so you can retry it or use another channel.`;
  const metadata = {
    deliveryFailureOutboundId: outboundQueueId,
    errorCode: errorCode ?? null,
    inputSource: origin.inputSource,
    source: "assistant.delivery_failure_feedback",
  };

  const { error: messageError } = await supabase
    .from("assistant_messages")
    .insert({
      content,
      intent: "delivery_failed",
      metadata,
      model: "system",
      provider: "kyro",
      role: "assistant",
      thread_id: origin.threadId,
      tool_calls: [],
      ui_blocks: [],
      user_id: origin.userId,
      workspace_id: workspaceId,
    });

  if (messageError) {
    throw new Error(
      `Unable to save assistant delivery feedback: ${messageError.message}`,
    );
  }

  await supabase
    .from("assistant_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", origin.threadId);

  if (
    origin.phoneNumber &&
    ["sms", "whatsapp_sandbox"].includes(origin.inputSource)
  ) {
    await recordOutboundDirectSms(supabase, {
      body: content,
      consentNote: "Trusted internal Kyro user delivery feedback.",
      idempotencyKey: `assistant.delivery_failure_feedback.${outboundQueueId}`,
      metadata: {
        ...metadata,
        suppressFailureFeedback: true,
        transport: origin.inputSource,
      },
      recipientName: "Kyro user",
      recipientPhone: origin.phoneNumber,
      source: "assistant.delivery_failure_feedback",
      userId: origin.userId,
      workspaceId,
    }).catch((error) => {
      console.error("Unable to deliver assistant failure feedback", {
        error: error instanceof Error ? error.message : String(error),
        outboundQueueId,
        workspaceId,
      });
    });
  }

  return content;
}
