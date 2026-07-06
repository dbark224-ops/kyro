import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

async function hydrateEvents(
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"],
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
    throw new Error(`Unable to load calendar contacts: ${contacts.error.message}`);
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
    const { supabase, workspace } = await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const fallback = defaultRange();
    const from = safeIsoDate(url.searchParams.get("from")) ?? fallback.from;
    const to = safeIsoDate(url.searchParams.get("to")) ?? fallback.to;

    const { data, error } = await supabase
      .from("conversation_appointments")
      .select(
        "id,conversation_id,contact_id,lead_id,appointment_type,title,description,status,starts_at,ends_at,location,external_calendar_provider,external_sync_status,created_at,updated_at",
      )
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
