import {
  assertActionTransition,
  assertEventTransition,
  getInitialActionStatus,
  type EventStatus
} from "@kyro/api";
import type { ActionStatus, ActionType } from "@kyro/contracts";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { recordOutboundMessage } from "../communication/outbound";
import {
  getCommunicationSettings,
  isOutboundChannel,
  type SignatureVariant,
} from "../communication/settings";
import {
  buildSignedEmailBody,
  selectEmailSignature,
} from "../communication/signatures";

type AuditInput = {
  workspaceId: string;
  actorType: "user" | "ai" | "system";
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export type ActionQueueItem = {
  id: string;
  type: string;
  status: ActionStatus;
  approvalRequired: boolean;
  requestedBy: string;
  createdAt: string;
};

export type EventQueueItem = {
  id: string;
  type: string;
  source: string;
  status: EventStatus;
  createdAt: string;
};

export type AuditLogItem = {
  id: string;
  action: string;
  actorType: string;
  entityType: string;
  createdAt: string;
};

type TransitionAction = {
  id: string;
  workspaceId: string;
  status: ActionStatus;
  type: string;
  targetType: string | null;
  targetId: string | null;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function signatureVariantFromActionInput(
  input: Record<string, unknown>,
  fallback: SignatureVariant,
): SignatureVariant {
  const explicit = textValue(input.signatureVariant);

  if (explicit === "manual" || explicit === "ai_generated") {
    return explicit;
  }

  return Boolean(input.userEditedDraft) || Boolean(input.editedByUserId)
    ? "manual"
    : fallback;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function jsonTextList(value: unknown) {
  return arrayValue(value)
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

function inferTemplateKey(value: string | null) {
  const text = value?.toLowerCase() ?? "";

  if (text.includes("bathroom") || text.includes("renovation")) {
    return "bathroom_renovation";
  }

  if (text.includes("plumb") || text.includes("leak") || text.includes("tap")) {
    return "plumbing_repair";
  }

  return "general_service_quote";
}

export async function insertAuditLog(supabase: SupabaseClient, input: AuditInput) {
  const { error } = await supabase.from("audit_logs").insert({
    workspace_id: input.workspaceId,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? {}
  });

  if (error) {
    throw new Error(`Unable to write audit log: ${error.message}`);
  }
}

export async function requestStubAction(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string
) {
  const idempotencyKey = `manual.stub_action.${crypto.randomUUID()}`;
  const eventPayload = {
    requestedByUserId: user.id,
    actionType: "create_task",
    reason: "Manual dashboard smoke test"
  };

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      type: "manual.stub_action.requested",
      source: "web.dashboard",
      idempotency_key: idempotencyKey,
      payload: eventPayload,
      status: "pending"
    })
    .select("id,type,status")
    .single();

  if (eventError || !event) {
    throw new Error(`Unable to record event: ${eventError?.message ?? "unknown error"}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "event.recorded",
    entityType: "event",
    entityId: String(event.id),
    after: {
      type: event.type,
      status: event.status
    }
  });

  const actionType: ActionType = "create_task";
  const approvalRequired = true;
  const status = getInitialActionStatus(approvalRequired);

  const { data: action, error: actionError } = await supabase
    .from("actions")
    .insert({
      workspace_id: workspaceId,
      type: actionType,
      status,
      requested_by: "user",
      approval_required: approvalRequired,
      target_type: "task",
      input: {
        title: "Follow up on new inbound lead",
        eventId: event.id,
        dryRun: true
      },
      result: {},
      policy_snapshot: {
        source: "dashboard_smoke_test",
        mode: "require_approval"
      }
    })
    .select("id,type,status")
    .single();

  if (actionError || !action) {
    throw new Error(`Unable to request action: ${actionError?.message ?? "unknown error"}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "action.requested",
    entityType: "action",
    entityId: String(action.id),
    after: {
      type: action.type,
      status: action.status
    },
    metadata: {
      eventId: event.id
    }
  });

  return {
    eventId: String(event.id),
    actionId: String(action.id)
  };
}

async function getActionForTransition(supabase: SupabaseClient, actionId: string) {
  const { data, error } = await supabase
    .from("actions")
    .select("id,workspace_id,status,type,target_type,target_id,input,result")
    .eq("id", actionId)
    .single();

  if (error || !data) {
    throw new Error(`Unable to load action: ${error?.message ?? "unknown error"}`);
  }

  return {
    id: String(data.id),
    workspaceId: String(data.workspace_id),
    status: String(data.status) as ActionStatus,
    type: String(data.type),
    targetType: data.target_type ? String(data.target_type) : null,
    targetId: data.target_id ? String(data.target_id) : null,
    input: objectRecord(data.input),
    result: objectRecord(data.result)
  } satisfies TransitionAction;
}

async function recordDraftReplyOutbound(
  supabase: SupabaseClient,
  user: User,
  action: TransitionAction
) {
  if (action.type !== "draft_reply" || action.targetType !== "conversation" || !action.targetId) {
    return null;
  }

  const body = textValue(action.input.body);

  if (!body) {
    throw new Error("Unable to execute draft reply because the reply body is empty.");
  }

  const subject = textValue(action.input.subject) ?? "Thanks for reaching out";
  const channelType = textValue(action.input.channelType) ?? "email";

  if (!isOutboundChannel(channelType)) {
    throw new Error(`${channelType} is not a supported outbound channel.`);
  }

  const communicationSettings = await getCommunicationSettings(supabase, action.workspaceId);
  const signatureVariant = signatureVariantFromActionInput(action.input, "ai_generated");
  const signature = selectEmailSignature(communicationSettings, signatureVariant);
  const signedBody = buildSignedEmailBody({ body, signature });

  const result = await recordOutboundMessage(supabase, {
    workspaceId: action.workspaceId,
    userId: user.id,
    conversationId: action.targetId,
    channelType,
    subject,
    body: signedBody.bodyText,
    htmlBody: signedBody.htmlBody,
    attachmentQuoteDraftId: textValue(action.input.attachmentQuoteDraftId),
    attachments: signedBody.inlineAttachments,
    source: "action.draft_reply",
    actionId: action.id,
    idempotencyKey: `action.${action.id}.draft_reply`,
    settingsSnapshot: {
      ...objectRecord(action.input.settingsSnapshot),
      signatureApplied: signedBody.signatureApplied,
      signatureVariant,
    }
  });

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "system",
    action: result.externalSend ? "message.outbound_sent" : "message.outbound_dry_run_recorded",
    entityType: "message",
    entityId: result.outboundMessageId,
    before: {
      conversationStatus: result.previousConversationStatus
    },
    after: {
      channelType: result.channelType,
      direction: "outbound",
      dryRun: result.dryRun,
      externalMessageId: result.externalMessageId,
      externalSend: result.externalSend,
      conversationId: action.targetId,
      sentTo: result.sentTo,
      subject: result.subject
    },
    metadata: {
      actionId: action.id,
      requestedByUserId: user.id
    }
  });

  return result;
}

async function createQuoteDraftFromAction(
  supabase: SupabaseClient,
  user: User,
  action: TransitionAction
) {
  if (action.type !== "create_quote_draft" || action.targetType !== "conversation" || !action.targetId) {
    return null;
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,workspace_id,contact_id,lead_id")
    .eq("workspace_id", action.workspaceId)
    .eq("id", action.targetId)
    .maybeSingle();

  if (conversationError) {
    throw new Error(`Unable to load quote draft conversation: ${conversationError.message}`);
  }

  if (!conversation) {
    throw new Error("Unable to create quote draft because the conversation was not found.");
  }

  const [contact, lead, savedFacts] = await Promise.all([
    conversation.contact_id
      ? supabase
          .from("contacts")
          .select("name,email,phone,company")
          .eq("workspace_id", action.workspaceId)
          .eq("id", conversation.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    conversation.lead_id
      ? supabase
          .from("leads")
          .select("title,service_type,next_step")
          .eq("workspace_id", action.workspaceId)
          .eq("id", conversation.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("inquiry_facts")
      .select("job_type,address,preferred_time,urgency,budget,fit,missing_info")
      .eq("workspace_id", action.workspaceId)
      .eq("conversation_id", action.targetId)
      .maybeSingle()
  ]);

  if (contact.error) {
    throw new Error(`Unable to load quote draft contact context: ${contact.error.message}`);
  }

  if (lead.error) {
    throw new Error(`Unable to load quote draft lead context: ${lead.error.message}`);
  }

  if (savedFacts.error) {
    throw new Error(`Unable to load quote draft inquiry facts: ${savedFacts.error.message}`);
  }

  const draftInput = objectRecord(action.input.quoteDraft);
  const actionFacts = objectRecord(action.input.inquiryFacts);
  const jobType =
    textValue(savedFacts.data?.job_type) ??
    textValue(actionFacts.jobType) ??
    textValue(lead.data?.service_type) ??
    textValue(lead.data?.title);
  const address =
    textValue(savedFacts.data?.address) ?? textValue(actionFacts.address);
  const preferredTime =
    textValue(savedFacts.data?.preferred_time) ?? textValue(actionFacts.preferredTime);
  const budget =
    textValue(savedFacts.data?.budget) ?? textValue(actionFacts.budget);
  const title =
    textValue(draftInput.title) ??
    (jobType ? `${jobType} quote draft` : null) ??
    textValue(action.input.title) ??
    "Quote draft";
  const lineItems = arrayValue(draftInput.lineItems);
  const rawNotes = draftInput.notes;
  const notes =
    typeof rawNotes === "string"
      ? textValue(rawNotes)
      : Array.isArray(rawNotes)
        ? rawNotes
            .map((item) => (typeof item === "string" ? item.trim() : null))
            .filter((item): item is string => Boolean(item))
            .join("\n")
        : null;

  const { data: quoteDraft, error: quoteError } = await supabase
    .from("quote_drafts")
    .insert({
      workspace_id: action.workspaceId,
      contact_id: conversation.contact_id ?? null,
      lead_id: conversation.lead_id ?? null,
      conversation_id: conversation.id,
      source_action_id: action.id,
      title,
      status: "draft",
      line_items: lineItems,
      notes,
      metadata: {
        budget,
        customerCompany: textValue(contact.data?.company),
        customerEmail: textValue(contact.data?.email),
        customerName: textValue(contact.data?.name) ?? textValue(contact.data?.company),
        customerPhone: textValue(contact.data?.phone),
        source: "action.create_quote_draft",
        requestedByUserId: user.id,
        dryRun: true,
        fit: textValue(savedFacts.data?.fit) ?? textValue(actionFacts.fit),
        inquiryFacts: {
          address,
          budget,
          fit: textValue(savedFacts.data?.fit) ?? textValue(actionFacts.fit),
          jobType,
          missingInfo:
            savedFacts.data?.missing_info !== undefined
              ? jsonTextList(savedFacts.data.missing_info)
              : jsonTextList(actionFacts.missingInfo),
          preferredTime,
          urgency: textValue(savedFacts.data?.urgency) ?? textValue(actionFacts.urgency)
        },
        jobAddress: address,
        jobType,
        preferredTime,
        templateKey: inferTemplateKey(jobType),
      }
    })
    .select("id,title,status")
    .single();

  if (quoteError || !quoteDraft) {
    throw new Error(`Unable to create quote draft: ${quoteError?.message ?? "unknown error"}`);
  }

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "system",
    action: "quote_draft.created",
    entityType: "quote_draft",
    entityId: String(quoteDraft.id),
    after: {
      title: quoteDraft.title,
      status: quoteDraft.status,
      conversationId: action.targetId,
      leadId: conversation.lead_id ? String(conversation.lead_id) : null
    },
    metadata: {
      actionId: action.id,
      requestedByUserId: user.id
    }
  });

  return {
    quoteDraftId: String(quoteDraft.id),
    conversationId: action.targetId,
    dryRun: true,
    externalSend: false,
    executor: "quote_draft_creator"
  };
}

async function recordSendOutboundMessage(
  supabase: SupabaseClient,
  user: User,
  action: TransitionAction
) {
  if (
    action.type !== "send_outbound_message" ||
    action.targetType !== "conversation" ||
    !action.targetId
  ) {
    return null;
  }

  const channelType = textValue(action.input.channelType) ?? "manual";

  if (!isOutboundChannel(channelType)) {
    throw new Error(`${channelType} is not a supported outbound channel.`);
  }

  const body = textValue(action.input.body);

  if (!body) {
    throw new Error("Unable to record outbound message because the body is empty.");
  }

  const communicationSettings = await getCommunicationSettings(supabase, action.workspaceId);
  const signatureVariant = signatureVariantFromActionInput(action.input, "ai_generated");
  const signature = selectEmailSignature(communicationSettings, signatureVariant);
  const signedBody = buildSignedEmailBody({ body, signature });

  const result = await recordOutboundMessage(supabase, {
    workspaceId: action.workspaceId,
    userId: user.id,
    conversationId: action.targetId,
    channelType,
    subject: textValue(action.input.subject),
    body: signedBody.bodyText,
    htmlBody: signedBody.htmlBody,
    attachmentQuoteDraftId: textValue(action.input.attachmentQuoteDraftId),
    attachments: signedBody.inlineAttachments,
    source: "action.send_outbound_message",
    actionId: action.id,
    idempotencyKey: `action.${action.id}.send_outbound_message`,
    settingsSnapshot: {
      ...objectRecord(action.input.settingsSnapshot),
      signatureApplied: signedBody.signatureApplied,
      signatureVariant,
    }
  });

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "system",
    action: result.externalSend ? "message.outbound_sent" : "message.outbound_dry_run_recorded",
    entityType: "message",
    entityId: result.outboundMessageId,
    before: {
      conversationStatus: result.previousConversationStatus
    },
    after: {
      attachmentQuoteDraftId: result.attachmentQuoteDraftId,
      channelType: result.channelType,
      conversationId: result.conversationId,
      direction: "outbound",
      dryRun: result.dryRun,
      externalMessageId: result.externalMessageId,
      externalSend: result.externalSend,
      sentTo: result.sentTo,
      subject: result.subject
    },
    metadata: {
      actionId: action.id,
      requestedByUserId: user.id,
      source: "action.send_outbound_message"
    }
  });

  if (result.attachmentQuoteDraftId && result.quoteDraftStatusAfter) {
    await insertAuditLog(supabase, {
      workspaceId: action.workspaceId,
      actorType: "system",
      action: result.externalSend ? "quote_draft.sent_external" : "quote_draft.sent_dry_run",
      entityType: "quote_draft",
      entityId: result.attachmentQuoteDraftId,
      before: {
        status: result.quoteDraftStatusBefore
      },
      after: {
        status: result.quoteDraftStatusAfter,
        channelType: result.channelType,
        conversationId: result.conversationId,
        dryRun: result.dryRun,
        externalMessageId: result.externalMessageId,
        externalSend: result.externalSend,
        outboundMessageId: result.outboundMessageId
      },
      metadata: {
        actionId: action.id,
        requestedByUserId: user.id,
        source: "action.send_outbound_message"
      }
    });
  }

  return result;
}

async function applyMarkNotFitAction(
  supabase: SupabaseClient,
  user: User,
  action: TransitionAction
) {
  if (action.type !== "mark_not_fit") {
    return null;
  }

  const leadId =
    action.targetType === "lead" && action.targetId ? action.targetId : textValue(action.input.leadId);

  if (!leadId) {
    throw new Error("Unable to mark lead not fit because no lead is attached to the action.");
  }

  const reason = textValue(action.input.reason) ?? "AI proposed this inquiry is not a fit.";
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,status,next_step")
    .eq("workspace_id", action.workspaceId)
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) {
    throw new Error(`Unable to load lead for not-fit action: ${leadError.message}`);
  }

  if (!lead) {
    throw new Error("Unable to mark lead not fit because the lead was not found.");
  }

  const { error: updateError } = await supabase
    .from("leads")
    .update({
      status: "not_fit",
      next_step: reason
    })
    .eq("workspace_id", action.workspaceId)
    .eq("id", leadId);

  if (updateError) {
    throw new Error(`Unable to mark lead not fit: ${updateError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "system",
    action: "lead.marked_not_fit",
    entityType: "lead",
    entityId: leadId,
    before: {
      status: lead.status,
      nextStep: lead.next_step
    },
    after: {
      status: "not_fit",
      nextStep: reason
    },
    metadata: {
      actionId: action.id,
      requestedByUserId: user.id
    }
  });

  return {
    leadId,
    dryRun: false,
    externalSend: false,
    executor: "lead_status_update"
  };
}

function buildInternalActionDryRunResult(action: TransitionAction) {
  if (action.type === "ask_missing_info") {
    return {
      missingInfo: arrayValue(action.input.missingInfo),
      prompt: textValue(action.input.prompt),
      dryRun: true,
      externalSend: false,
      executor: "missing_info_prompt"
    };
  }

  if (action.type === "book_site_visit") {
    return {
      address: textValue(action.input.address),
      preferredTime: textValue(action.input.preferredTime),
      dryRun: true,
      externalSend: false,
      executor: "site_visit_dry_run"
    };
  }

  if (action.type === "schedule_follow_up") {
    return {
      followUpWindow: textValue(action.input.followUpWindow),
      reason: textValue(action.input.reason),
      dryRun: true,
      externalSend: false,
      executor: "follow_up_dry_run"
    };
  }

  return null;
}

async function updateConversationWorkflowAfterAction(
  supabase: SupabaseClient,
  user: User,
  action: TransitionAction
) {
  if (action.targetType !== "conversation" || !action.targetId) {
    return;
  }

  const workflowUpdate = {
    ask_missing_info: {
      nextStep: "Awaiting customer details",
      status: "replied"
    },
    book_site_visit: {
      nextStep: "Site visit plan recorded",
      status: null
    },
    create_quote_draft: {
      nextStep: "Quote draft created for review",
      status: null
    },
    schedule_follow_up: {
      nextStep: "Follow-up reminder recorded",
      status: "replied"
    }
  }[action.type];

  if (!workflowUpdate) {
    return;
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,status,lead_id")
    .eq("workspace_id", action.workspaceId)
    .eq("id", action.targetId)
    .maybeSingle();

  if (conversationError) {
    throw new Error(`Unable to load conversation workflow target: ${conversationError.message}`);
  }

  if (!conversation) {
    return;
  }

  const beforeStatus = String(conversation.status);
  const nextStatus = workflowUpdate.status && beforeStatus !== "resolved"
    ? workflowUpdate.status
    : null;

  if (nextStatus && nextStatus !== beforeStatus) {
    const { error: updateError } = await supabase
      .from("conversations")
      .update({
        status: nextStatus
      })
      .eq("workspace_id", action.workspaceId)
      .eq("id", action.targetId);

    if (updateError) {
      throw new Error(`Unable to update conversation workflow status: ${updateError.message}`);
    }

    await insertAuditLog(supabase, {
      workspaceId: action.workspaceId,
      actorType: "system",
      action: "conversation.workflow_status_updated",
      entityType: "conversation",
      entityId: action.targetId,
      before: {
        status: beforeStatus
      },
      after: {
        status: nextStatus
      },
      metadata: {
        actionId: action.id,
        actionType: action.type,
        requestedByUserId: user.id
      }
    });
  }

  const leadId = conversation.lead_id ? String(conversation.lead_id) : null;

  if (!leadId) {
    return;
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,next_step")
    .eq("workspace_id", action.workspaceId)
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) {
    throw new Error(`Unable to load lead workflow target: ${leadError.message}`);
  }

  if (!lead) {
    return;
  }

  const beforeNextStep = lead.next_step ? String(lead.next_step) : null;

  if (beforeNextStep === workflowUpdate.nextStep) {
    return;
  }

  const { error: leadUpdateError } = await supabase
    .from("leads")
    .update({
      next_step: workflowUpdate.nextStep
    })
    .eq("workspace_id", action.workspaceId)
    .eq("id", leadId);

  if (leadUpdateError) {
    throw new Error(`Unable to update lead next step: ${leadUpdateError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "system",
    action: "lead.next_step_updated",
    entityType: "lead",
    entityId: leadId,
    before: {
      nextStep: beforeNextStep
    },
    after: {
      nextStep: workflowUpdate.nextStep
    },
    metadata: {
      actionId: action.id,
      actionType: action.type,
      conversationId: action.targetId,
      requestedByUserId: user.id
    }
  });
}

export async function approveAction(supabase: SupabaseClient, user: User, actionId: string) {
  const action = await getActionForTransition(supabase, actionId);
  assertActionTransition(action.status, "approved");

  const after = {
    status: "approved",
    approvedByUserId: user.id,
    approvedAt: new Date().toISOString()
  };

  const { data: approvedAction, error } = await supabase
    .from("actions")
    .update({
      status: after.status,
      approved_by_user_id: after.approvedByUserId,
      approved_at: after.approvedAt
    })
    .eq("id", action.id)
    .eq("status", action.status)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to approve action: ${error.message}`);
  }

  if (!approvedAction) {
    throw new Error("Unable to approve action because its status changed.");
  }

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "action.approved",
    entityType: "action",
    entityId: action.id,
    before: {
      status: action.status
    },
    after
  });

  if (action.type === "draft_reply" && action.targetType === "conversation" && action.targetId) {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({
        status: "reply_drafted"
      })
      .eq("workspace_id", action.workspaceId)
      .eq("id", action.targetId);

    if (conversationError) {
      throw new Error(`Unable to update conversation after approval: ${conversationError.message}`);
    }
  }
}

export async function executeAction(supabase: SupabaseClient, user: User, actionId: string) {
  const action = await getActionForTransition(supabase, actionId);
  assertActionTransition(action.status, "executing");

  const executingAt = new Date().toISOString();
  const { data: executingAction, error: executingError } = await supabase
    .from("actions")
    .update({
      status: "executing",
      executed_at: executingAt
    })
    .eq("id", action.id)
    .eq("status", action.status)
    .select("id")
    .maybeSingle();

  if (executingError) {
    throw new Error(`Unable to start action execution: ${executingError.message}`);
  }

  if (!executingAction) {
    throw new Error("Unable to execute action because its status changed.");
  }

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "system",
    action: "action.executing",
    entityType: "action",
    entityId: action.id,
    before: {
      status: action.status
    },
    after: {
      status: "executing"
    },
    metadata: {
      requestedByUserId: user.id
    }
  });

  let result: Record<string, unknown>;

  try {
    const draftReplyResult = await recordDraftReplyOutbound(supabase, user, action);
    const quoteDraftResult = await createQuoteDraftFromAction(supabase, user, action);
    const outboundMessageResult = await recordSendOutboundMessage(supabase, user, action);
    const markNotFitResult = await applyMarkNotFitAction(supabase, user, action);
    const internalResult = buildInternalActionDryRunResult(action);
    const actionResult =
      draftReplyResult ??
      quoteDraftResult ??
      outboundMessageResult ??
      markNotFitResult ??
      internalResult;
    await updateConversationWorkflowAfterAction(supabase, user, action);
    result = {
      ...action.result,
      ...(actionResult ?? {}),
      dryRun: actionResult?.dryRun ?? true,
      externalSend: actionResult?.externalSend ?? false,
      executor: actionResult?.executor ?? "stub",
      completedAt: new Date().toISOString(),
      note: actionResult?.externalSend
        ? "External send completed through the connected provider."
        : "No external side effect was performed."
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const errorMessage =
      error instanceof Error ? error.message : "Action execution failed.";
    const failedResult = {
      ...action.result,
      error: errorMessage,
      failedAt
    };

    await supabase
      .from("actions")
      .update({
        result: failedResult,
        status: "failed"
      })
      .eq("id", action.id)
      .eq("status", "executing");

    await insertAuditLog(supabase, {
      workspaceId: action.workspaceId,
      actorType: "system",
      action: "action.failed",
      entityType: "action",
      entityId: action.id,
      before: {
        status: "executing"
      },
      after: {
        result: failedResult,
        status: "failed"
      },
      metadata: {
        requestedByUserId: user.id
      }
    });

    throw error;
  }

  const { data: completedAction, error: completedError } = await supabase
    .from("actions")
    .update({
      status: "completed",
      result
    })
    .eq("id", action.id)
    .eq("status", "executing")
    .select("id")
    .maybeSingle();

  if (completedError) {
    throw new Error(`Unable to complete action execution: ${completedError.message}`);
  }

  if (!completedAction) {
    throw new Error("Unable to complete action because its status changed.");
  }

  await insertAuditLog(supabase, {
    workspaceId: action.workspaceId,
    actorType: "system",
    action: "action.completed",
    entityType: "action",
    entityId: action.id,
    before: {
      status: "executing"
    },
    after: {
      status: "completed",
      result
    },
    metadata: {
      requestedByUserId: user.id
    }
  });
}

export async function processNextEvent(supabase: SupabaseClient, user: User, workspaceId: string) {
  const { data: event, error: loadError } = await supabase
    .from("events")
    .select("id,type,status")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Unable to load pending event: ${loadError.message}`);
  }

  if (!event) {
    return null;
  }

  const eventId = String(event.id);
  const eventStatus = String(event.status) as EventStatus;
  assertEventTransition(eventStatus, "processing");

  const { error: processingError } = await supabase
    .from("events")
    .update({
      status: "processing"
    })
    .eq("id", eventId);

  if (processingError) {
    throw new Error(`Unable to mark event processing: ${processingError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "system",
    action: "event.processing",
    entityType: "event",
    entityId: eventId,
    before: {
      status: eventStatus
    },
    after: {
      status: "processing"
    },
    metadata: {
      requestedByUserId: user.id
    }
  });

  const { error: processedError } = await supabase
    .from("events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString()
    })
    .eq("id", eventId);

  if (processedError) {
    throw new Error(`Unable to mark event processed: ${processedError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "system",
    action: "event.processed",
    entityType: "event",
    entityId: eventId,
    before: {
      status: "processing"
    },
    after: {
      status: "processed"
    },
    metadata: {
      requestedByUserId: user.id
    }
  });

  return eventId;
}

export async function getEngineQueues(supabase: SupabaseClient, workspaceId: string) {
  const [actions, events, auditLogs] = await Promise.all([
    supabase
      .from("actions")
      .select("id,type,status,approval_required,requested_by,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("events")
      .select("id,type,source,status,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("audit_logs")
      .select("id,action,actor_type,entity_type,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5)
  ]);

  if (actions.error) {
    throw new Error(`Unable to load actions: ${actions.error.message}`);
  }

  if (events.error) {
    throw new Error(`Unable to load events: ${events.error.message}`);
  }

  if (auditLogs.error) {
    throw new Error(`Unable to load audit logs: ${auditLogs.error.message}`);
  }

  return {
    actions: (actions.data ?? [])
      .filter((action) => !["ask_missing_info", "schedule_follow_up"].includes(String(action.type)))
      .slice(0, 5)
      .map((action) => ({
        id: String(action.id),
        type: String(action.type),
        status: String(action.status) as ActionStatus,
        approvalRequired: Boolean(action.approval_required),
        requestedBy: String(action.requested_by),
        createdAt: String(action.created_at)
      })),
    events: (events.data ?? []).map((event) => ({
      id: String(event.id),
      type: String(event.type),
      source: String(event.source),
      status: String(event.status) as EventStatus,
      createdAt: String(event.created_at)
    })),
    auditLogs: (auditLogs.data ?? []).map((log) => ({
      id: String(log.id),
      action: String(log.action),
      actorType: String(log.actor_type),
      entityType: String(log.entity_type),
      createdAt: String(log.created_at)
    }))
  };
}
