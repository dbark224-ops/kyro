import { getConversationReview } from "../../../../../lib/crm/queries";
import {
  getCommunicationSettings,
  isOutboundChannel,
} from "../../../../../lib/communication/settings";
import {
  buildSignedEmailBody,
  selectEmailSignature,
} from "../../../../../lib/communication/signatures";
import { recordOutboundMessage } from "../../../../../lib/communication/outbound";
import { insertAuditLog } from "../../../../../lib/engine/event-action-audit";
import {
  approveAction,
  executeAction,
} from "../../../../../lib/engine/event-action-audit";
import {
  MobileApiError,
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

const CONVERSATION_STATUSES = new Set([
  "open",
  "reply_drafted",
  "replied",
  "resolved",
]);

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function actionTitle(type: string) {
  if (type === "draft_reply") {
    return "Generated reply";
  }

  if (type === "send_outbound_message") {
    return "Outbound reply";
  }

  if (type === "create_quote_draft") {
    return "Quote draft";
  }

  if (type === "book_site_visit") {
    return "Site visit";
  }

  return formatLabel(type);
}

function actionSummary(input: Record<string, unknown>) {
  const body =
    textValue(input.body) ??
    textValue(input.replyBody) ??
    textValue(input.message);
  const subject = textValue(input.subject);
  const missingInfo = stringValues(input.missingInfo);
  const quoteDraft = objectRecord(input.quoteDraft);
  const quoteTitle = textValue(quoteDraft.title);

  if (subject && body) {
    return `${subject}: ${body}`;
  }

  if (body) {
    return body;
  }

  if (quoteTitle) {
    return quoteTitle;
  }

  if (missingInfo.length) {
    return `Missing: ${missingInfo.join(", ")}`;
  }

  return "Ready for review.";
}

function defaultSubject(
  profile: NonNullable<Awaited<ReturnType<typeof getConversationReview>>>,
) {
  const messageSubject = profile.messages.find((message) =>
    Boolean(message.subject),
  )?.subject;
  const subject =
    messageSubject ?? profile.lead?.title ?? "Thanks for reaching out";

  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function preferredChannel(
  profile: NonNullable<Awaited<ReturnType<typeof getConversationReview>>>,
  allowedChannels: string[],
) {
  if (profile.contact?.email && allowedChannels.includes("email")) {
    return "email";
  }

  if (profile.contact?.phone && allowedChannels.includes("sms")) {
    return "sms";
  }

  return allowedChannels[0] ?? "email";
}

async function buildDetail(request: Request, conversationId: string) {
  const { supabase, workspace } = await requireMobileWorkspaceContext(request);
  const [profile, settings] = await Promise.all([
    getConversationReview(supabase, workspace.id, conversationId),
    getCommunicationSettings(supabase, workspace.id),
  ]);

  if (!profile) {
    throw new MobileApiError("Conversation was not found.", 404);
  }

  const visibleActions = profile.actions
    .filter((action) =>
      ["draft_reply", "send_outbound_message", "create_quote_draft", "book_site_visit"].includes(
        action.type,
      ),
    )
    .filter((action) => ["pending_approval", "approved", "completed"].includes(action.status))
    .slice(0, 8)
    .map((action) => {
      const input = objectRecord(action.input);

      return {
        body: textValue(input.body) ?? textValue(input.replyBody),
        createdAt: action.createdAt,
        id: action.id,
        status: action.status,
        subject: textValue(input.subject),
        summary: actionSummary(input),
        title: actionTitle(action.type),
        type: action.type,
      };
    });
  const title =
    profile.lead?.title ??
    profile.contact?.name ??
    profile.contact?.company ??
    profile.messages[0]?.subject ??
    "Conversation";

  return {
    actions: visibleActions,
    allowedChannels: settings.allowedChannels,
    contact: profile.contact
      ? {
          address: profile.contact.address,
          company: profile.contact.company,
          contactType: profile.contact.contactType,
          email: profile.contact.email,
          id: profile.contact.id,
          name: profile.contact.name,
          phone: profile.contact.phone,
        }
      : null,
    conversation: profile.conversation,
    defaultChannel: preferredChannel(profile, settings.allowedChannels),
    defaultSubject: defaultSubject(profile),
    inquiryFacts: profile.inquiryFacts
      ? {
          address: profile.inquiryFacts.address,
          budget: profile.inquiryFacts.budget,
          fit: profile.inquiryFacts.fit,
          jobType: profile.inquiryFacts.jobType,
          missingInfo: profile.inquiryFacts.missingInfo,
          preferredTime: profile.inquiryFacts.preferredTime,
          urgency: profile.inquiryFacts.urgency,
        }
      : null,
    lead: profile.lead
      ? {
          estimatedValue: profile.lead.estimatedValue,
          nextStep: profile.lead.nextStep,
          priority: profile.lead.priority,
          serviceType: profile.lead.serviceType,
          status: profile.lead.status,
          title: profile.lead.title,
        }
      : null,
    messages: [...profile.messages].reverse().map((message) => ({
      bodyText: message.bodyText,
      channelDisplayName: message.channelDisplayName,
      channelType: message.channelType,
      createdAt: message.createdAt,
      direction: message.direction,
      id: message.id,
      receivedAt: message.receivedAt,
      sentAt: message.sentAt,
      subject: message.subject,
    })),
    outboundMessages: profile.outboundMessages.slice(0, 8).map((message) => ({
      channelType: message.channelType,
      id: message.id,
      lastError: message.lastError,
      provider: message.provider,
      recipient: message.recipient,
      sentAt: message.sentAt,
      status: message.status,
      subject: message.subject,
    })),
    quoteDrafts: profile.quoteDrafts.map((quoteDraft) => ({
      id: quoteDraft.id,
      lineItemCount: Array.isArray(quoteDraft.lineItems)
        ? quoteDraft.lineItems.length
        : 0,
      notes: quoteDraft.notes,
      status: quoteDraft.status,
      title: quoteDraft.title,
      updatedAt: quoteDraft.updatedAt,
    })),
    title,
    workspace,
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;

    return Response.json(await buildDetail(request, conversationId));
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = objectRecord(await request.json().catch(() => null));
    const channelType = textValue(payload.channelType) ?? "";
    const subject = textValue(payload.subject);
    const body = textValue(payload.body);
    const attachmentQuoteDraftId = textValue(payload.attachmentQuoteDraftId);
    const includeSignature = payload.includeSignature !== false;
    const signatureVariant =
      textValue(payload.signatureVariant) === "ai_generated"
        ? "ai_generated"
        : "manual";

    if (!isOutboundChannel(channelType)) {
      throw new MobileApiError("Outbound channel is invalid.", 400);
    }

    if (!body) {
      throw new MobileApiError("Reply body is required.", 400);
    }

    const settings = await getCommunicationSettings(supabase, workspace.id);

    if (!settings.allowedChannels.includes(channelType)) {
      throw new MobileApiError(
        `${channelType.toUpperCase()} is disabled in communication settings.`,
        400,
      );
    }

    const shouldApplySignature = channelType === "email" && includeSignature;
    const signedBody = shouldApplySignature
      ? buildSignedEmailBody({
          body,
          signature: selectEmailSignature(settings, signatureVariant),
        })
      : {
          bodyText: body,
          htmlBody: null,
          inlineAttachments: [],
          signatureApplied: false,
        };
    const outboundResult = await recordOutboundMessage(supabase, {
      attachmentQuoteDraftId,
      attachments: signedBody.inlineAttachments,
      body: signedBody.bodyText,
      channelType,
      conversationId,
      htmlBody: signedBody.htmlBody,
      settingsSnapshot: {
        allowedChannels: settings.allowedChannels,
        approvalRequired: settings.approvalRequired,
        signatureApplied: signedBody.signatureApplied,
        signatureVariant,
        userInitiatedFromMobile: true,
      },
      source: "mobile.inbox.manual_reply",
      subject,
      userId: user.id,
      workspaceId: workspace.id,
    });

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: outboundResult.externalSend
        ? "message.outbound_sent"
        : "message.outbound_dry_run_recorded",
      entityType: "message",
      entityId: outboundResult.outboundMessageId,
      after: {
        channelType: outboundResult.channelType,
        conversationId: outboundResult.conversationId,
        direction: "outbound",
        dryRun: outboundResult.dryRun,
        externalSend: outboundResult.externalSend,
        sentTo: outboundResult.sentTo,
        subject: outboundResult.subject,
      },
      metadata: {
        requestedByUserId: user.id,
        source: "mobile.inbox.manual_reply",
      },
    });

    return Response.json({
      detail: await buildDetail(request, conversationId),
      message: outboundResult.externalSend
        ? "Reply sent."
        : "Reply recorded. External sending is in dry-run mode.",
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = objectRecord(await request.json().catch(() => null));
    const operation = textValue(payload.operation);

    if (operation === "update_status") {
      const status = textValue(payload.status);

      if (!status || !CONVERSATION_STATUSES.has(status)) {
        throw new MobileApiError("Conversation status is invalid.", 400);
      }

      const { data: conversation, error: loadError } = await supabase
        .from("conversations")
        .select("id,status")
        .eq("workspace_id", workspace.id)
        .eq("id", conversationId)
        .maybeSingle();

      if (loadError) {
        throw new Error(loadError.message);
      }

      if (!conversation) {
        throw new MobileApiError("Conversation was not found.", 404);
      }

      const beforeStatus = String(conversation.status);
      const { error: updateError } = await supabase
        .from("conversations")
        .update({ status })
        .eq("workspace_id", workspace.id)
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      await insertAuditLog(supabase, {
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "conversation.status_updated",
        entityType: "conversation",
        entityId: conversationId,
        before: { status: beforeStatus },
        after: { status },
        metadata: {
          source: "mobile.inbox.workflow_controls",
        },
      });

      return Response.json({
        detail: await buildDetail(request, conversationId),
        message: "Conversation status updated.",
      });
    }

    const actionId = textValue(payload.actionId);

    if (!actionId) {
      throw new MobileApiError("Action id is required.", 400);
    }

    if (
      !operation ||
      !["approve", "approve_execute", "execute", "save_draft"].includes(
        operation,
      )
    ) {
      throw new MobileApiError("Action operation is invalid.", 400);
    }

    const { data: action, error: loadError } = await supabase
      .from("actions")
      .select("id,type,status,input,target_type,target_id")
      .eq("workspace_id", workspace.id)
      .eq("target_type", "conversation")
      .eq("target_id", conversationId)
      .eq("id", actionId)
      .maybeSingle();

    if (loadError) {
      throw new Error(loadError.message);
    }

    if (!action) {
      throw new MobileApiError("Action was not found for this conversation.", 404);
    }

    if (operation === "save_draft" || operation === "approve_execute") {
      if (String(action.type) !== "draft_reply") {
        throw new MobileApiError("Only draft reply actions can be edited.", 400);
      }

      if (String(action.status) !== "pending_approval") {
        throw new MobileApiError("Only pending draft replies can be edited.", 400);
      }

      const cleanSubject =
        textValue(payload.subject) ?? textValue(objectRecord(action.input).subject) ?? "Thanks for reaching out";
      const cleanBody = textValue(payload.body);

      if (!cleanBody) {
        throw new MobileApiError("Reply body is required.", 400);
      }

      await saveDraftReplyAction({
        actionId,
        body: cleanBody,
        subject: cleanSubject,
        userId: user.id,
        workspaceId: workspace.id,
        beforeInput: objectRecord(action.input),
        supabase,
      });
    }

    if (operation === "approve" || operation === "approve_execute") {
      await approveAction(supabase, user, actionId);
    }

    if (operation === "execute" || operation === "approve_execute") {
      await executeAction(supabase, user, actionId);
    }

    return Response.json({
      detail: await buildDetail(request, conversationId),
      message: actionOperationMessage(operation),
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

async function saveDraftReplyAction({
  actionId,
  beforeInput,
  body,
  subject,
  supabase,
  userId,
  workspaceId,
}: {
  actionId: string;
  beforeInput: Record<string, unknown>;
  body: string;
  subject: string;
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
  userId: string;
  workspaceId: string;
}) {
  const subjectChanged =
    (textValue(beforeInput.subject) ?? "Thanks for reaching out") !== subject;
  const bodyChanged = (textValue(beforeInput.body) ?? "") !== body;
  const userEditedDraft =
    Boolean(beforeInput.userEditedDraft) ||
    Boolean(beforeInput.editedByUserId) ||
    subjectChanged ||
    bodyChanged;
  const afterInput = {
    ...beforeInput,
    body,
    dryRun: true,
    subject,
    userEditedDraft,
    ...(userEditedDraft
      ? {
          editedAt: new Date().toISOString(),
          editedByUserId: userId,
        }
      : {}),
  };
  const { error } = await supabase
    .from("actions")
    .update({ input: afterInput })
    .eq("workspace_id", workspaceId)
    .eq("id", actionId);

  if (error) {
    throw new Error(`Unable to save draft reply: ${error.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "draft_reply.updated",
    entityType: "action",
    entityId: actionId,
    before: { input: beforeInput },
    after: { input: afterInput },
    metadata: {
      source: "mobile.inbox.action_card",
    },
  });
}

function actionOperationMessage(operation: string) {
  if (operation === "save_draft") {
    return "Draft saved.";
  }

  if (operation === "approve_execute") {
    return "Action approved and sent.";
  }

  if (operation === "approve") {
    return "Action approved.";
  }

  return "Action sent.";
}
