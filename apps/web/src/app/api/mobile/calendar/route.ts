import {
  createCalendarEventRecord,
  getCalendarEvents,
  normalizeCalendarEventStatus,
  normalizeCalendarEventType,
  updateCalendarEventRecord,
  type CalendarEventItem,
  type CalendarEventMutationInput,
} from "../../../../lib/calendar/events";
import { deleteAppointmentFromExternalCalendar } from "../../../../lib/calendar/provider-sync";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import {
  MobileApiError,
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

type CalendarMutationPayload = {
  appointmentType?: unknown;
  contactId?: unknown;
  conversationId?: unknown;
  description?: unknown;
  endsAt?: unknown;
  eventId?: unknown;
  leadId?: unknown;
  location?: unknown;
  startsAt?: unknown;
  status?: unknown;
  title?: unknown;
};

function defaultRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 14);

  const to = new Date(from);
  to.setDate(to.getDate() + 90);

  return { from: from.toISOString(), to: to.toISOString() };
}

function safeIsoDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(value: unknown, message: string) {
  const text = nullableString(value);

  if (!text) {
    throw new MobileApiError(message, 400);
  }

  return text;
}

function optionalIsoDateTime(value: unknown, field: string) {
  const text = nullableString(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    throw new MobileApiError(`Use a valid ${field} date and time.`, 400);
  }

  return date.toISOString();
}

async function requestPayload(request: Request) {
  const payload = await request.json().catch(() => null);

  return payload && typeof payload === "object"
    ? (payload as CalendarMutationPayload)
    : {};
}

async function resolveLinkedEntities({
  contactId,
  conversationId,
  leadId,
  supabase,
  workspaceId,
}: {
  contactId: string | null;
  conversationId: string | null;
  leadId: string | null;
  supabase: Awaited<
    ReturnType<typeof requireMobileWorkspaceContext>
  >["supabase"];
  workspaceId: string;
}) {
  let resolvedContactId = contactId;
  let resolvedLeadId = leadId;

  if (conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id,contact_id,lead_id")
      .eq("workspace_id", workspaceId)
      .eq("id", conversationId)
      .maybeSingle();

    if (error) {
      throw new MobileApiError(error.message, 500);
    }

    if (!data) {
      throw new MobileApiError("Linked inquiry was not found.", 404);
    }

    resolvedContactId ||= data.contact_id ? String(data.contact_id) : null;
    resolvedLeadId ||= data.lead_id ? String(data.lead_id) : null;
  }

  if (resolvedLeadId && !resolvedContactId) {
    const { data, error } = await supabase
      .from("leads")
      .select("id,contact_id")
      .eq("workspace_id", workspaceId)
      .eq("id", resolvedLeadId)
      .maybeSingle();

    if (error) {
      throw new MobileApiError(error.message, 500);
    }

    resolvedContactId = data?.contact_id ? String(data.contact_id) : null;
  }

  return {
    contactId: resolvedContactId,
    leadId: resolvedLeadId,
  };
}

async function eventInputFromPayload({
  payload,
  supabase,
  workspaceId,
}: {
  payload: CalendarMutationPayload;
  supabase: Awaited<
    ReturnType<typeof requireMobileWorkspaceContext>
  >["supabase"];
  workspaceId: string;
}): Promise<CalendarEventMutationInput> {
  const startsAt = optionalIsoDateTime(payload.startsAt, "start");
  const endsAt = optionalIsoDateTime(payload.endsAt, "end");
  const title = requiredString(payload.title, "Add an event title first.");

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new MobileApiError(
      "The end time needs to be after the start time.",
      400,
    );
  }

  const linked = await resolveLinkedEntities({
    contactId: nullableString(payload.contactId),
    conversationId: nullableString(payload.conversationId),
    leadId: nullableString(payload.leadId),
    supabase,
    workspaceId,
  });

  return {
    appointmentType: normalizeCalendarEventType(payload.appointmentType),
    contactId: linked.contactId,
    conversationId: nullableString(payload.conversationId),
    description: nullableString(payload.description),
    endsAt,
    leadId: linked.leadId,
    location: nullableString(payload.location),
    locationAddress: null,
    metadata: { source: "mobile_calendar" },
    startsAt,
    status: normalizeCalendarEventStatus(
      nullableString(payload.status) ?? "",
      startsAt,
    ),
    title,
  };
}

async function loadEventById({
  eventId,
  eventTime,
  supabase,
  workspaceId,
}: {
  eventId: string;
  eventTime: string | null;
  supabase: Awaited<
    ReturnType<typeof requireMobileWorkspaceContext>
  >["supabase"];
  workspaceId: string;
}) {
  const date = eventTime ? new Date(eventTime) : new Date();
  const from = new Date(date);
  from.setDate(from.getDate() - 1);
  const to = new Date(date);
  to.setDate(to.getDate() + 2);
  const events = await getCalendarEvents(supabase, workspaceId, {
    from: from.toISOString(),
    to: to.toISOString(),
  });

  return events.find((event) => event.id === eventId) ?? null;
}

function mutationResponse({
  event,
  message,
  workspace,
}: {
  event: CalendarEventItem | null;
  message: string;
  workspace: Awaited<
    ReturnType<typeof requireMobileWorkspaceContext>
  >["workspace"];
}) {
  return Response.json({
    event,
    message,
    workspace,
  });
}

export async function GET(request: Request) {
  try {
    const { supabase, workspace } =
      await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const fallback = defaultRange();
    const from = safeIsoDate(url.searchParams.get("from")) ?? fallback.from;
    const to = safeIsoDate(url.searchParams.get("to")) ?? fallback.to;
    const events = await getCalendarEvents(supabase, workspace.id, {
      from,
      to,
    });

    return Response.json({
      events,
      range: { from, to },
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = await requestPayload(request);
    const input = await eventInputFromPayload({
      payload,
      supabase,
      workspaceId: workspace.id,
    });
    const appointmentId = await createCalendarEventRecord({
      input,
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    });

    return mutationResponse({
      event: await loadEventById({
        eventId: appointmentId,
        eventTime: input.startsAt,
        supabase,
        workspaceId: workspace.id,
      }),
      message: "Calendar event saved.",
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = await requestPayload(request);
    const appointmentId = requiredString(
      payload.eventId,
      "Choose an event to update.",
    );
    const input = await eventInputFromPayload({
      payload,
      supabase,
      workspaceId: workspace.id,
    });

    await updateCalendarEventRecord({
      appointmentId,
      input,
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    });

    return mutationResponse({
      event: await loadEventById({
        eventId: appointmentId,
        eventTime: input.startsAt,
        supabase,
        workspaceId: workspace.id,
      }),
      message: "Calendar event updated.",
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = await requestPayload(request);
    const appointmentId = requiredString(
      payload.eventId,
      "Choose an event to delete.",
    );

    await deleteAppointmentFromExternalCalendar({
      appointmentId,
      supabase,
      workspaceId: workspace.id,
    });

    const { data, error } = await supabase
      .from("conversation_appointments")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("id", appointmentId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to delete calendar event: ${error.message}`);
    }

    if (!data) {
      throw new MobileApiError("Calendar event was not found.", 404);
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "calendar_event.deleted",
      entityType: "conversation_appointment",
      entityId: appointmentId,
    });

    return Response.json({
      deletedEventId: appointmentId,
      event: null,
      message: "Calendar event deleted.",
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
