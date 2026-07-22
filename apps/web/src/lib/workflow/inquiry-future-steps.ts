import type { SupabaseClient } from "@supabase/supabase-js";
import { syncAppointmentToExternalCalendar } from "../calendar/provider-sync";
import { insertAuditLog } from "../engine/event-action-audit";

export const FUTURE_STEP_STATUSES = [
  "waiting",
  "needs_action",
  "completed",
  "cancelled",
  "expired",
] as const;

export type FutureStepStatus = (typeof FUTURE_STEP_STATUSES)[number];
export type FutureStepDecisionOutcome =
  | "confirmed"
  | "countered"
  | "cancelled"
  | "unrelated";

export type FutureStepDecision = {
  outcome: FutureStepDecisionOutcome;
  requestedTime: string | null;
  reason: string | null;
};

export type ActiveFutureStepContext = {
  id: string;
  kind: string;
  status: FutureStepStatus;
  actionType: string;
  actionPayload: Record<string, unknown>;
  triggerPayload: Record<string, unknown>;
  requiresApproval: boolean;
  calendarEvent: {
    id: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    status: string;
  } | null;
};

type FutureStepRow = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  calendar_event_id: string | null;
  kind: string;
  status: string;
  trigger_payload: unknown;
  action_type: string;
  action_payload: unknown;
  requires_approval: boolean;
  metadata: unknown;
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function futureStepStatus(value: string): FutureStepStatus {
  return FUTURE_STEP_STATUSES.includes(value as FutureStepStatus)
    ? (value as FutureStepStatus)
    : "waiting";
}

export function normalizeFutureStepDecision(
  value: unknown,
): FutureStepDecision {
  const record = objectValue(value);
  const rawOutcome =
    typeof record.outcome === "string" ? record.outcome.trim() : "";
  const outcome: FutureStepDecisionOutcome = [
    "confirmed",
    "countered",
    "cancelled",
    "unrelated",
  ].includes(rawOutcome)
    ? (rawOutcome as FutureStepDecisionOutcome)
    : "unrelated";

  return {
    outcome,
    reason:
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason.trim()
        : null,
    requestedTime:
      typeof record.requestedTime === "string" && record.requestedTime.trim()
        ? record.requestedTime.trim()
        : null,
  };
}

export function classifyFutureStepFallback(
  message: string,
): FutureStepDecision {
  const text = message.trim().toLowerCase();

  if (!text) {
    return { outcome: "unrelated", reason: null, requestedTime: null };
  }

  const cancellation =
    /\b(cancel|cancelled|canceled|no longer need|not going ahead|forget it)\b/.test(
      text,
    );
  if (cancellation) {
    return {
      outcome: "cancelled",
      reason: "The customer explicitly cancelled or abandoned the appointment.",
      requestedTime: null,
    };
  }

  const includesAlternativeTime =
    /\b(instead|rather|how about|could (?:you|we)|can (?:you|we)|what about)\b/.test(
      text,
    ) &&
    /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b(?:morning|afternoon|evening|tomorrow|tonight)\b/.test(
      text,
    );
  if (includesAlternativeTime) {
    return {
      outcome: "countered",
      reason: "The customer proposed a different appointment time.",
      requestedTime: message.trim(),
    };
  }

  const confirmation =
    /\b(yes|yep|yeah|confirmed|confirm|works for me|that works|sounds good|see you then|perfect|okay|ok|fine)\b/.test(
      text,
    );
  if (confirmation) {
    return {
      outcome: "confirmed",
      reason: "The customer explicitly accepted the offered appointment.",
      requestedTime: null,
    };
  }

  return { outcome: "unrelated", reason: null, requestedTime: null };
}

export async function getActiveInquiryFutureStep(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<ActiveFutureStepContext | null> {
  const { data, error } = await supabase
    .from("inquiry_future_steps")
    .select(
      "id,conversation_id,message_id,contact_id,lead_id,calendar_event_id,kind,status,trigger_payload,action_type,action_payload,requires_approval,metadata",
    )
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("status", "waiting")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load pending inquiry workflow: ${error.message}`,
    );
  }

  if (!data) {
    return null;
  }

  const step = data as FutureStepRow;
  let calendarEvent: ActiveFutureStepContext["calendarEvent"] = null;

  if (step.calendar_event_id) {
    const { data: appointment, error: appointmentError } = await supabase
      .from("conversation_appointments")
      .select("id,title,starts_at,ends_at,status")
      .eq("workspace_id", workspaceId)
      .eq("id", step.calendar_event_id)
      .maybeSingle();

    if (appointmentError) {
      throw new Error(
        `Unable to load pending workflow calendar event: ${appointmentError.message}`,
      );
    }

    if (appointment) {
      calendarEvent = {
        endsAt: appointment.ends_at,
        id: appointment.id,
        startsAt: appointment.starts_at,
        status: appointment.status,
        title: appointment.title,
      };
    }
  }

  return {
    actionPayload: objectValue(step.action_payload),
    actionType: step.action_type,
    calendarEvent,
    id: step.id,
    kind: step.kind,
    requiresApproval: step.requires_approval,
    status: futureStepStatus(step.status),
    triggerPayload: objectValue(step.trigger_payload),
  };
}

export async function upsertCalendarConfirmationFutureStep({
  calendarEventId,
  contactId,
  conversationId,
  expiresAt,
  leadId,
  messageId,
  offeredTimeLabel,
  supabase,
  workspaceId,
}: {
  calendarEventId: string;
  contactId?: string | null;
  conversationId: string;
  expiresAt?: string | null;
  leadId?: string | null;
  messageId?: string | null;
  offeredTimeLabel?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data: existing, error: existingError } = await supabase
    .from("inquiry_future_steps")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("calendar_event_id", calendarEventId)
    .in("status", ["waiting", "needs_action"])
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to inspect the calendar confirmation workflow: ${existingError.message}`,
    );
  }

  const values = {
    action_payload: {
      calendarEventId,
      confirmedStatus: "scheduled",
      counteredStatus: "needs_business_approval",
    },
    action_type: "confirm_calendar_event",
    calendar_event_id: calendarEventId,
    contact_id: contactId ?? null,
    conversation_id: conversationId,
    expires_at: expiresAt ?? null,
    kind: "calendar_confirmation",
    lead_id: leadId ?? null,
    message_id: messageId ?? null,
    metadata: { displayLabel: "Waiting for customer confirmation" },
    requires_approval: false,
    status: "waiting",
    trigger_payload: {
      offeredTimeLabel: offeredTimeLabel ?? null,
      trigger: "next_customer_reply",
    },
    trigger_type: "customer_reply",
    workspace_id: workspaceId,
  };

  const query = existing
    ? supabase
        .from("inquiry_future_steps")
        .update(values)
        .eq("workspace_id", workspaceId)
        .eq("id", existing.id)
    : supabase.from("inquiry_future_steps").insert(values);
  const { data, error } = await query.select("id").single();

  if (error) {
    throw new Error(
      `Unable to save the calendar confirmation workflow: ${error.message}`,
    );
  }

  return data.id as string;
}

export async function applyInquiryFutureStepDecision({
  actorId,
  conversationId,
  decision,
  messageId,
  step,
  supabase,
  workspaceId,
}: {
  actorId?: string | null;
  conversationId: string;
  decision: FutureStepDecision;
  messageId?: string | null;
  step: ActiveFutureStepContext;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  if (decision.outcome === "unrelated" || !step.calendarEvent) {
    return { changed: false, outcome: decision.outcome };
  }

  const now = new Date().toISOString();
  const eventMetadata = {
    customerConfirmation:
      decision.outcome === "confirmed"
        ? "confirmed"
        : decision.outcome === "countered"
          ? "countered"
          : "cancelled",
    futureStepId: step.id,
    futureStepReason: decision.reason,
    requestedTime: decision.requestedTime,
  };
  const appointmentStatus =
    decision.outcome === "confirmed"
      ? "scheduled"
      : decision.outcome === "countered"
        ? "needs_business_approval"
        : "cancelled";

  const { data: currentAppointment, error: loadError } = await supabase
    .from("conversation_appointments")
    .select("metadata,status")
    .eq("workspace_id", workspaceId)
    .eq("id", step.calendarEvent.id)
    .single();

  if (loadError) {
    throw new Error(`Unable to load workflow event: ${loadError.message}`);
  }

  const { error: eventError } = await supabase
    .from("conversation_appointments")
    .update({
      metadata: {
        ...objectValue(currentAppointment.metadata),
        ...eventMetadata,
      },
      status: appointmentStatus,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", step.calendarEvent.id);

  if (eventError) {
    throw new Error(`Unable to advance workflow event: ${eventError.message}`);
  }

  if (decision.outcome === "countered") {
    const { data: existingTask, error: taskLookupError } = await supabase
      .from("conversation_tasks")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .eq("status", "open")
      .contains("metadata", { futureStepId: step.id })
      .maybeSingle();

    if (taskLookupError) {
      throw new Error(
        `Unable to inspect workflow review tasks: ${taskLookupError.message}`,
      );
    }

    if (!existingTask) {
      const { error: taskError } = await supabase
        .from("conversation_tasks")
        .insert({
          conversation_id: conversationId,
          description:
            decision.requestedTime ??
            "The customer asked for a different appointment time.",
          due_at: now,
          message_id: messageId ?? null,
          metadata: {
            calendarEventId: step.calendarEvent.id,
            futureStepId: step.id,
            requestedTime: decision.requestedTime,
          },
          priority: "normal",
          status: "open",
          task_type: "review_schedule_change",
          title: "Review customer requested time",
          workspace_id: workspaceId,
        });

      if (taskError) {
        throw new Error(
          `Unable to create workflow review task: ${taskError.message}`,
        );
      }
    }
  }

  const nextStepStatus =
    decision.outcome === "confirmed"
      ? "completed"
      : decision.outcome === "countered"
        ? "needs_action"
        : "cancelled";
  const { error: stepError } = await supabase
    .from("inquiry_future_steps")
    .update({
      cancelled_at: decision.outcome === "cancelled" ? now : null,
      completed_at: decision.outcome === "confirmed" ? now : null,
      metadata: {
        decision,
        displayLabel:
          decision.outcome === "countered"
            ? "Customer requested a different time"
            : decision.outcome === "confirmed"
              ? "Customer confirmed the appointment"
              : "Customer cancelled the appointment",
        resolvedByMessageId: messageId ?? null,
      },
      status: nextStepStatus,
      trigger_payload: {
        ...step.triggerPayload,
        decision,
        resolvedByMessageId: messageId ?? null,
      },
    })
    .eq("workspace_id", workspaceId)
    .eq("id", step.id)
    .eq("status", "waiting");

  if (stepError) {
    throw new Error(`Unable to advance inquiry workflow: ${stepError.message}`);
  }

  await insertAuditLog(supabase, {
    action: "inquiry.future_step.transitioned",
    actorId: actorId ?? undefined,
    actorType: actorId ? "ai" : "system",
    after: {
      calendarEventStatus: appointmentStatus,
      decision,
      futureStepStatus: nextStepStatus,
    },
    before: {
      calendarEventStatus: currentAppointment.status,
      futureStepStatus: step.status,
    },
    entityId: step.id,
    entityType: "inquiry_future_step",
    metadata: {
      calendarEventId: step.calendarEvent.id,
      conversationId,
      messageId: messageId ?? null,
    },
    workspaceId,
  });

  await syncAppointmentToExternalCalendar({
    action: "update",
    appointmentId: step.calendarEvent.id,
    supabase,
    workspaceId,
  }).catch(() => null);

  return {
    calendarEventStatus: appointmentStatus,
    changed: true,
    futureStepStatus: nextStepStatus,
    outcome: decision.outcome,
  };
}

export async function getActiveCalendarFutureStepId(
  supabase: SupabaseClient,
  workspaceId: string,
  calendarEventId: string,
) {
  const { data, error } = await supabase
    .from("inquiry_future_steps")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("calendar_event_id", calendarEventId)
    .in("status", ["waiting", "needs_action"])
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to inspect the event workflow: ${error.message}`);
  }

  return data?.id ? String(data.id) : null;
}

export async function resolveCalendarFutureStepFromUserMutation({
  calendarEventId,
  futureStepId,
  status,
  supabase,
  userId,
  workspaceId,
}: {
  calendarEventId: string;
  futureStepId?: string | null;
  status: string;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const resolvedStatus = ["scheduled", "completed"].includes(status)
    ? "completed"
    : status === "cancelled"
      ? "cancelled"
      : null;

  if (!resolvedStatus) {
    return false;
  }

  const stepId =
    futureStepId ??
    (await getActiveCalendarFutureStepId(
      supabase,
      workspaceId,
      calendarEventId,
    ));

  if (!stepId) {
    return false;
  }

  const { data: step, error: stepLoadError } = await supabase
    .from("inquiry_future_steps")
    .select("id,status,metadata")
    .eq("workspace_id", workspaceId)
    .eq("id", stepId)
    .in("status", ["waiting", "needs_action"])
    .maybeSingle();

  if (stepLoadError) {
    throw new Error(
      `Unable to load the event workflow: ${stepLoadError.message}`,
    );
  }

  if (!step) {
    return false;
  }

  const now = new Date().toISOString();
  const { error: taskError } = await supabase
    .from("conversation_tasks")
    .update({ completed_at: now, status: "completed" })
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .contains("metadata", { futureStepId: stepId });

  if (taskError) {
    throw new Error(`Unable to close the workflow task: ${taskError.message}`);
  }

  const { error: stepUpdateError } = await supabase
    .from("inquiry_future_steps")
    .update({
      cancelled_at: resolvedStatus === "cancelled" ? now : null,
      completed_at: resolvedStatus === "completed" ? now : null,
      metadata: {
        ...objectValue(step.metadata),
        displayLabel:
          resolvedStatus === "completed"
            ? "Appointment handled in the calendar"
            : "Appointment cancelled in the calendar",
        resolvedByUserId: userId,
      },
      status: resolvedStatus,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", stepId)
    .in("status", ["waiting", "needs_action"]);

  if (stepUpdateError) {
    throw new Error(
      `Unable to resolve the event workflow: ${stepUpdateError.message}`,
    );
  }

  await insertAuditLog(supabase, {
    action: "inquiry.future_step.resolved_from_calendar",
    actorId: userId,
    actorType: "user",
    after: { calendarEventStatus: status, futureStepStatus: resolvedStatus },
    before: { futureStepStatus: step.status },
    entityId: stepId,
    entityType: "inquiry_future_step",
    metadata: { calendarEventId },
    workspaceId,
  });

  return true;
}

export async function processExpiredInquiryFutureSteps(
  supabase: SupabaseClient,
  { limit = 100, workspaceId }: { limit?: number; workspaceId: string },
) {
  const now = new Date().toISOString();
  const { data: steps, error } = await supabase
    .from("inquiry_future_steps")
    .select("id,conversation_id,message_id,calendar_event_id,metadata")
    .eq("workspace_id", workspaceId)
    .eq("status", "waiting")
    .not("expires_at", "is", null)
    .lte("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (error) {
    throw new Error(
      `Unable to load expired inquiry workflows: ${error.message}`,
    );
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const step of steps ?? []) {
    try {
      if (step.calendar_event_id) {
        const { data: appointment, error: appointmentError } = await supabase
          .from("conversation_appointments")
          .select("metadata")
          .eq("workspace_id", workspaceId)
          .eq("id", step.calendar_event_id)
          .maybeSingle();

        if (appointmentError) {
          throw new Error(appointmentError.message);
        }

        if (appointment) {
          const { error: eventError } = await supabase
            .from("conversation_appointments")
            .update({
              metadata: {
                ...objectValue(appointment.metadata),
                customerConfirmation: "overdue",
                futureStepId: step.id,
              },
              status: "needs_business_approval",
            })
            .eq("workspace_id", workspaceId)
            .eq("id", step.calendar_event_id);

          if (eventError) {
            throw new Error(eventError.message);
          }
        }
      }

      const { data: existingTask, error: taskLookupError } = await supabase
        .from("conversation_tasks")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", step.conversation_id)
        .eq("status", "open")
        .contains("metadata", { futureStepId: step.id })
        .maybeSingle();

      if (taskLookupError) {
        throw new Error(taskLookupError.message);
      }

      if (!existingTask) {
        const { error: taskError } = await supabase
          .from("conversation_tasks")
          .insert({
            conversation_id: step.conversation_id,
            description:
              "The customer has not confirmed the proposed appointment time.",
            due_at: now,
            message_id: step.message_id,
            metadata: {
              calendarEventId: step.calendar_event_id,
              futureStepId: step.id,
            },
            priority: "normal",
            status: "open",
            task_type: "follow_up_unconfirmed_appointment",
            title: "Follow up on unconfirmed appointment",
            workspace_id: workspaceId,
          });

        if (taskError) {
          throw new Error(taskError.message);
        }
      }

      const { data: expired, error: expireError } = await supabase
        .from("inquiry_future_steps")
        .update({
          metadata: {
            ...objectValue(step.metadata),
            displayLabel: "Customer confirmation is overdue",
            expiredAt: now,
          },
          status: "expired",
        })
        .eq("workspace_id", workspaceId)
        .eq("id", step.id)
        .eq("status", "waiting")
        .select("id")
        .maybeSingle();

      if (expireError) {
        throw new Error(expireError.message);
      }

      if (!expired) {
        results.push({ id: String(step.id), ok: true });
        continue;
      }

      await insertAuditLog(supabase, {
        action: "inquiry.future_step.expired",
        actorType: "system",
        after: {
          calendarEventStatus: step.calendar_event_id
            ? "needs_business_approval"
            : null,
          futureStepStatus: "expired",
        },
        before: { futureStepStatus: "waiting" },
        entityId: String(step.id),
        entityType: "inquiry_future_step",
        metadata: {
          calendarEventId: step.calendar_event_id,
          conversationId: step.conversation_id,
        },
        workspaceId,
      });

      if (step.calendar_event_id) {
        await syncAppointmentToExternalCalendar({
          action: "update",
          appointmentId: String(step.calendar_event_id),
          supabase,
          workspaceId,
        }).catch(() => null);
      }

      results.push({ id: String(step.id), ok: true });
    } catch (stepError) {
      results.push({
        error:
          stepError instanceof Error
            ? stepError.message
            : "Unable to expire inquiry workflow.",
        id: String(step.id),
        ok: false,
      });
    }
  }

  return {
    errors: results.filter((result) => !result.ok),
    processed: results.filter((result) => result.ok).length,
  };
}
