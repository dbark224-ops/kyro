import type { SupabaseClient, User } from "@supabase/supabase-js";
import { recordOutboundDirectSms } from "../communication/outbound";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import { sendInternalBugNotification } from "../internal-notifications";
import { runAssistantTurn } from "./engine";
import {
  appendAssistantTurnMessage,
  appendUserAssistantMessage,
  getAssistantTurnContext,
  getOrCreateInternalMessagingThread,
  updateAssistantThreadSummary,
} from "./persistence";
import { getVoiceSettings, type VoiceSettings } from "./voice-settings";
import { vapiUserIdentityFromUser } from "./vapi-user-context";
import type { AssistantRequestActor } from "./types";

export type InternalMessagingWorkspace = {
  id: string;
  name: string;
  ownerUserId: string;
};

export type InternalMessageTransport = "sms" | "whatsapp_sandbox";

function barePhone(value: string) {
  return value.replace(/^whatsapp:/i, "").trim();
}

function normalizedPhone(value: string) {
  return (
    normalizeContactPhoneForRegion(barePhone(value), null) ?? barePhone(value)
  );
}

export function trustedInternalPhoneMatches(
  from: string,
  trustedNumbers: string[],
) {
  const sender = normalizedPhone(from);

  return trustedNumbers.some(
    (phoneNumber) => normalizedPhone(phoneNumber) === sender,
  );
}

export async function isTrustedInternalMessagingSender(
  supabase: SupabaseClient,
  workspaceId: string,
  from: string,
) {
  const voiceSettings = await getVoiceSettings(supabase, workspaceId);

  return trustedInternalPhoneMatches(from, voiceSettings.phoneAgentUserNumbers);
}

export function trustedInternalMessagingActor({
  from,
  user,
  voiceSettings,
}: {
  from: string;
  user: User;
  voiceSettings: Pick<VoiceSettings, "phoneAgentUserNumberDetails">;
}): AssistantRequestActor {
  const senderPhone = normalizedPhone(from);
  const matchingDetail = voiceSettings.phoneAgentUserNumberDetails.find(
    (detail) => normalizedPhone(detail.phoneNumber) === senderPhone,
  );
  const accountIdentity = vapiUserIdentityFromUser(user);
  const displayName = matchingDetail?.name || accountIdentity.name || null;

  return {
    displayName,
    firstName:
      displayName?.split(/\s+/)[0] || accountIdentity.firstName || null,
    kind: "trusted_internal_messaging_sender",
    phoneNumber: senderPhone,
    role: matchingDetail?.role ?? null,
    userId: user.id,
  };
}

export async function processInternalAssistantMessage(input: {
  eventId: string;
  from: string;
  messageSid: string;
  prompt: string;
  supabase: SupabaseClient;
  transport: InternalMessageTransport;
  workspace: InternalMessagingWorkspace;
}) {
  let userEmail: string | null = null;

  try {
    const { data, error } = await input.supabase.auth.admin.getUserById(
      input.workspace.ownerUserId,
    );

    if (error || !data.user) {
      throw new Error(
        `Unable to load internal messaging user: ${error?.message ?? "unknown error"}`,
      );
    }

    const user = data.user;
    userEmail = user.email ?? null;
    const voiceSettings = await getVoiceSettings(
      input.supabase,
      input.workspace.id,
    );
    const actor = trustedInternalMessagingActor({
      from: input.from,
      user,
      voiceSettings,
    });
    const workspace = {
      id: input.workspace.id,
      name: input.workspace.name,
    };
    const thread = await getOrCreateInternalMessagingThread(
      input.supabase,
      workspace,
      user,
      {
        displayName: actor.displayName,
        senderPhone: actor.phoneNumber ?? normalizedPhone(input.from),
      },
    );
    const threadId = String(thread.id);

    await appendUserAssistantMessage({
      content: input.prompt,
      inputSource: input.transport,
      supabase: input.supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });

    const context = await getAssistantTurnContext({
      prompt: input.prompt,
      supabase: input.supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    const result = await runAssistantTurn({
      actor,
      contextSnapshots: context.contextSnapshots,
      inputSource: input.transport,
      memories: context.memories,
      prompt: input.prompt,
      recentMessages: context.recentMessages,
      supabase: input.supabase,
      threadId,
      threadSummary: context.summary,
      user,
      workspace,
    });

    await appendAssistantTurnMessage({
      result,
      supabase: input.supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    await updateAssistantThreadSummary({
      prompt: input.prompt,
      result,
      supabase: input.supabase,
      threadId,
      workspaceId: workspace.id,
    });

    await recordOutboundDirectSms(input.supabase, {
      body: result.content,
      consentNote: "Trusted internal Kyro user messaging the assistant.",
      idempotencyKey: `${input.transport}.assistant.reply.${input.messageSid}`,
      metadata: {
        inboundEventId: input.eventId,
        inboundMessageSid: input.messageSid,
        transport: input.transport,
      },
      recipientName: user.user_metadata?.full_name ?? user.email ?? "Kyro user",
      recipientPhone: barePhone(input.from),
      source: `assistant.internal_${input.transport}`,
      transport: input.transport,
      userId: user.id,
      workspaceId: workspace.id,
    });
  } catch (error) {
    await sendInternalBugNotification({
      context: {
        userEmail,
        userId: input.workspace.ownerUserId,
        workspaceId: input.workspace.id,
        workspaceName: input.workspace.name,
      },
      input: {
        context: {
          inboundEventId: input.eventId,
          messageSid: input.messageSid,
          transport: input.transport,
        },
        eventKey: `${input.transport}-assistant-${input.messageSid}`,
        kind: "Internal messaging assistant failure",
        rawMessage: error instanceof Error ? error.message : String(error),
        severity: "error",
        source: `assistant.internal_messaging.${input.transport}`,
        visibleMessage: "Kyro did not return an internal messaging response.",
      },
    }).catch((notificationError) => {
      console.error(
        "Unable to send internal messaging failure notification",
        notificationError,
      );
    });

    throw error;
  }
}
