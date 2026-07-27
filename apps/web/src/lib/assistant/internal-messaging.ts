import type { SupabaseClient, User } from "@supabase/supabase-js";
import { textValueOrEmpty as textValue } from "@kyro/core";
import { recordOutboundDirectSms } from "../communication/outbound";
import { splitIntoSmsMessages } from "../communication/sms-length";
import { acknowledgeEscalationFromReply } from "../escalation/urgent-escalation";

/**
 * Two messages of room for an answer over SMS, and a hard stop at three.
 *
 * Enough to quote a drafted reply back in full; past that the owner is being
 * texted an essay, and the answer belongs in the app.
 */
const MAX_ASSISTANT_SMS_PARTS = 3;
import { normalizeContactPhoneForRegion } from "../crm/identity";
import { sendInternalBugNotification } from "../internal-notifications";
import { runAssistantTurn } from "./engine";
import {
  appendUserAssistantMessage,
  finalizeAssistantTurn,
  getAssistantTurnContext,
  getOrCreateInternalMessagingThread,
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

type InternalMessagingUserProfile = {
  created_at?: unknown;
  email?: unknown;
  first_name?: unknown;
  id?: unknown;
  last_name?: unknown;
  name?: unknown;
};

function barePhone(value: string) {
  return value.replace(/^whatsapp:/i, "").trim();
}

function normalizedPhone(value: string) {
  return (
    normalizeContactPhoneForRegion(barePhone(value), null) ?? barePhone(value)
  );
}

export function internalMessagingUserFromProfile(
  profile: InternalMessagingUserProfile,
  fallbackUserId: string,
): User {
  const id = textValue(profile.id) || fallbackUserId;
  const firstName = textValue(profile.first_name);
  const lastName = textValue(profile.last_name);
  const name =
    textValue(profile.name) || [firstName, lastName].filter(Boolean).join(" ");
  const email = textValue(profile.email);

  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: textValue(profile.created_at) || "1970-01-01T00:00:00.000Z",
    email: email || undefined,
    id,
    role: "authenticated",
    user_metadata: {
      first_name: firstName || undefined,
      full_name: name || undefined,
      last_name: lastName || undefined,
      name: name || undefined,
    },
  };
}

async function loadInternalMessagingUser(
  supabase: SupabaseClient,
  ownerUserId: string,
) {
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id,name,email,first_name,last_name,created_at")
    .eq("id", ownerUserId)
    .maybeSingle();

  if (profile) {
    return internalMessagingUserFromProfile(profile, ownerUserId);
  }

  const { data, error: authError } =
    await supabase.auth.admin.getUserById(ownerUserId);

  if (authError || !data.user) {
    const profileReason = profileError?.message
      ? ` Profile lookup failed: ${profileError.message}.`
      : "";
    throw new Error(
      `Unable to load internal messaging user: ${authError?.message ?? "user record was not found"}.${profileReason}`,
    );
  }

  return data.user;
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
    const user = await loadInternalMessagingUser(
      input.supabase,
      input.workspace.ownerUserId,
    );
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

    /*
     * Replying is acknowledgement.
     *
     * Before this, only the link in the escalation message stopped the chain,
     * so answering it in writing -- the obvious response, and how every other
     * Kyro alert works -- left the incident open and the later steps still
     * fired. The owner got phoned about something they had already handled.
     *
     * Done before the assistant turn so the chain stops immediately, and
     * separately from it so a failure here cannot swallow the reply itself.
     */
    const acknowledged = await acknowledgeEscalationFromReply(input.supabase, {
      phoneNumber: barePhone(input.from),
      userId: user.id,
      workspaceId: workspace.id,
    }).catch((acknowledgementError: unknown) => {
      console.error("Unable to acknowledge escalation from reply", {
        error:
          acknowledgementError instanceof Error
            ? acknowledgementError.message
            : "unknown error",
        workspaceId: workspace.id,
      });

      return null;
    });

    const context = await getAssistantTurnContext({
      prompt: input.prompt,
      supabase: input.supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });
    // Tell the turn it happened, so the reply can say so. Stopping the chain
    // silently would leave the owner unsure whether they still need to act.
    const acknowledgementSnapshots = acknowledged
      ? [
          {
            entities: [],
            id: `escalation-acknowledged-${acknowledged.id}`,
            messageCount: 0,
            keyPoints: [
              `This reply acknowledged the urgent escalation "${acknowledged.title}".`,
              "The remaining escalation steps were cancelled, so nobody else will be contacted about it.",
              "Say so plainly in the reply, then answer whatever else they asked.",
            ],
            periodEnd: new Date().toISOString(),
            periodStart: new Date().toISOString(),
            snapshotType: "manual",
            summary: `Urgent escalation "${acknowledged.title}" is now acknowledged and its pending steps are cancelled.`,
            title: "Urgent escalation acknowledged",
          },
        ]
      : [];

    const result = await runAssistantTurn({
      actor,
      contextSnapshots: [
        ...acknowledgementSnapshots,
        ...context.contextSnapshots,
      ],
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

    await finalizeAssistantTurn({
      prompt: input.prompt,
      result,
      supabase: input.supabase,
      threadId,
      user,
      workspaceId: workspace.id,
    });

    // A long answer used to go out as one oversized body and come back to the
    // owner cut off -- asking "what is your drafted reply" and getting half of
    // it. Splitting on a sentence boundary costs exactly the same to send as
    // being truncated by the carrier, and arrives whole.
    const parts =
      input.transport === "sms"
        ? splitIntoSmsMessages(result.content, MAX_ASSISTANT_SMS_PARTS)
        : [result.content.trim()].filter(Boolean);

    for (const [index, body] of parts.entries()) {
      await recordOutboundDirectSms(input.supabase, {
        body,
        consentNote: "Trusted internal Kyro user messaging the assistant.",
        // Part index keeps each message distinct, so a retry still dedupes.
        idempotencyKey: `${input.transport}.assistant.reply.${input.messageSid}${
          index > 0 ? `.${index + 1}` : ""
        }`,
        metadata: {
          inboundEventId: input.eventId,
          inboundMessageSid: input.messageSid,
          ...(parts.length > 1
            ? { messagePart: index + 1, messageParts: parts.length }
            : {}),
          transport: input.transport,
        },
        recipientName:
          user.user_metadata?.full_name ?? user.email ?? "Kyro user",
        recipientPhone: barePhone(input.from),
        source: `assistant.internal_${input.transport}`,
        transport: input.transport,
        userId: user.id,
        workspaceId: workspace.id,
      });
    }
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
