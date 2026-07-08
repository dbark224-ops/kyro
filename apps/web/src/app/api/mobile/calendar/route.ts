import {
  MobileApiError,
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

const EVENT_SELECT =
  "id,conversation_id,contact_id,lead_id,appointment_type,title,description,status,starts_at,ends_at,location,external_calendar_provider,external_sync_status,created_at,updated_at";
const CALENDAR_EVENT_TYPES = [
  "quote_visit",
  "job",
  "follow_up",
  "site_visit",
  "internal",
  "other",
] as const;
const CALENDAR_EVENT_STATUSES = [
  "suggested",
  "scheduled",
  "completed",
  "cancelled",
] as const;

type AppointmentRow = {
  appointment_type: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  created_at: string;
  description: string | null;
  ends_at: string | null;
  external_calendar_provider: string | null;
  external_sync_status: string | null;
  id: string;
  lead_id: string | null;
  location: string | null;
  starts_at: string | null;
  status: string | null;
  title: string | null;
  updated_at: string;
};

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

type CalendarMutationInput = {
  appointmentType: (typeof CALENDAR_EVENT_TYPES)[number];
  contactId: string | null;
  conversationId: string | null;
  description: string | null;
  endsAt: string | null;
  leadId: string | null;
  location: string | null;
  startsAt: string | null;
  status: (typeof CALENDAR_EVENT_STATUSES)[number];
  title: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

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

function normalizeEventType(value: unknown) {
  const type = nullableString(value);

  return CALENDAR_EVENT_TYPES.includes(
    type as (typeof CALENDAR_EVENT_TYPES)[number],
  )
    ? (type as (typeof CALENDAR_EVENT_TYPES)[number])
    : "other";
}

function normalizeEventStatus(value: unknown, startsAt: string | null) {
  const status = nullableString(value);

  if (
    CALENDAR_EVENT_STATUSES.includes(
      status as (typeof CALENDAR_EVENT_STATUSES)[number],
    )
  ) {
    return status as (typeof CALENDAR_EVENT_STATUSES)[number];
  }

  return startsAt ? "scheduled" : "suggested";
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
}): Promise<CalendarMutationInput> {
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
    appointmentType: normalizeEventType(payload.appointmentType),
    contactId: linked.contactId,
    conversationId: nullableString(payload.conversationId),
    description: nullableString(payload.description),
    endsAt,
    leadId: linked.leadId,
    location: nullableString(payload.location),
    startsAt,
    status: normalizeEventStatus(payload.status, startsAt),
    title,
  };
}

async function hydrateSingleEvent(
  supabase: Awaited<
    ReturnType<typeof requireMobileWorkspaceContext>
  >["supabase"],
  workspaceId: string,
  row: AppointmentRow,
) {
  const [event] = await hydrateEvents(supabase, workspaceId, [row]);

  return event;
}

async function hydrateEvents(
  supabase: Awaited<
    ReturnType<typeof requireMobileWorkspaceContext>
  >["supabase"],
  workspaceId: string,
  rows: AppointmentRow[],
) {
  const contactIds = uniqueIds(rows.map((row) => row.contact_id));
  const leadIds = uniqueIds(rows.map((row) => row.lead_id));

  const [contacts, leads] = await Promise.all([
    contactIds.length
      ? supabase
          .from("contacts")
          .select("id,name,email,phone,company")
          .eq("workspace_id", workspaceId)
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? supabase
          .from("leads")
          .select("id,title,status,priority,service_type")
          .eq("workspace_id", workspaceId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contacts.error) {
    throw new Error(
      `Unable to load calendar contacts: ${contacts.error.message}`,
    );
  }

  if (leads.error) {
    throw new Error(`Unable to load calendar leads: ${leads.error.message}`);
  }

  const contactsById = new Map(
    (contacts.data ?? []).map((contact) => [
      String(contact.id),
      {
        company: textValue(contact.company),
        email: textValue(contact.email),
        id: String(contact.id),
        name: textValue(contact.name),
        phone: textValue(contact.phone),
      },
    ]),
  );
  const leadsById = new Map(
    (leads.data ?? []).map((lead) => [
      String(lead.id),
      {
        id: String(lead.id),
        priority: textValue(lead.priority),
        serviceType: textValue(lead.service_type),
        status: textValue(lead.status),
        title: textValue(lead.title) ?? "Lead",
      },
    ]),
  );

  return rows.map((row) => ({
    appointmentType: row.appointment_type ?? "quote_visit",
    contact: row.contact_id ? (contactsById.get(row.contact_id) ?? null) : null,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    description: textValue(row.description),
    endsAt: row.ends_at,
    externalCalendarProvider: row.external_calendar_provider,
    externalSyncStatus: row.external_sync_status,
    id: String(row.id),
    lead: row.lead_id ? (leadsById.get(row.lead_id) ?? null) : null,
    leadId: row.lead_id,
    location: textValue(row.location),
    startsAt: row.starts_at,
    status: row.status ?? (row.starts_at ? "scheduled" : "suggested"),
    title: textValue(row.title) ?? "Kyro appointment",
    updatedAt: row.updated_at,
  }));
}

export async function GET(request: Request) {
  try {
    const { supabase, workspace } =
      await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const fallback = defaultRange();
    const from = safeIsoDate(url.searchParams.get("from")) ?? fallback.from;
    const to = safeIsoDate(url.searchParams.get("to")) ?? fallback.to;

    const { data, error } = await supabase
      .from("conversation_appointments")
      .select(EVENT_SELECT)
      .eq("workspace_id", workspace.id)
      .or(`starts_at.gte.${from},ends_at.gte.${from}`)
      .lt("starts_at", to)
      .order("starts_at", { ascending: true, nullsFirst: false })
      .limit(500);

    if (error) {
      throw new Error(`Unable to load calendar: ${error.message}`);
    }

    const events = await hydrateEvents(
      supabase,
      workspace.id,
      (data ?? []) as AppointmentRow[],
    );

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

    const { data, error } = await supabase
      .from("conversation_appointments")
      .insert({
        appointment_type: input.appointmentType,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        created_by_user_id: user.id,
        description: input.description,
        ends_at: input.endsAt,
        lead_id: input.leadId,
        location: input.location,
        metadata: { source: "mobile_calendar" },
        starts_at: input.startsAt,
        status: input.status,
        title: input.title,
        workspace_id: workspace.id,
      })
      .select(EVENT_SELECT)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Unable to create calendar event.");
    }

    return Response.json({
      event: await hydrateSingleEvent(
        supabase,
        workspace.id,
        data as AppointmentRow,
      ),
      message: "Calendar event saved.",
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = await requestPayload(request);
    const eventId = requiredString(
      payload.eventId,
      "Choose an event to update.",
    );
    const input = await eventInputFromPayload({
      payload,
      supabase,
      workspaceId: workspace.id,
    });

    const { data, error } = await supabase
      .from("conversation_appointments")
      .update({
        appointment_type: input.appointmentType,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        description: input.description,
        ends_at: input.endsAt,
        lead_id: input.leadId,
        location: input.location,
        starts_at: input.startsAt,
        status: input.status,
        title: input.title,
      })
      .eq("workspace_id", workspace.id)
      .eq("id", eventId)
      .select(EVENT_SELECT)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to update calendar event: ${error.message}`);
    }

    if (!data) {
      throw new MobileApiError("Calendar event was not found.", 404);
    }

    return Response.json({
      event: await hydrateSingleEvent(
        supabase,
        workspace.id,
        data as AppointmentRow,
      ),
      message: "Calendar event updated.",
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = await requestPayload(request);
    const eventId = requiredString(
      payload.eventId,
      "Choose an event to delete.",
    );

    const { data, error } = await supabase
      .from("conversation_appointments")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("id", eventId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to delete calendar event: ${error.message}`);
    }

    if (!data) {
      throw new MobileApiError("Calendar event was not found.", 404);
    }

    return Response.json({
      deletedEventId: eventId,
      event: null,
      message: "Calendar event deleted.",
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
