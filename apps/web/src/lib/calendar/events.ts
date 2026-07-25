import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarAddressMetadata } from "./directions";
import { parseAddressFormData } from "../addresses/form";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  getActiveCalendarFutureStepId,
  resolveCalendarFutureStepFromUserMutation,
} from "../workflow/inquiry-future-steps";
import {
  deleteAppointmentFromExternalCalendar,
  syncAppointmentToExternalCalendar,
} from "./provider-sync";
import {
  normalizeCalendarEventType as normalizeCalendarEventTypeValue,
  type CalendarEventType,
} from "./settings";
export { normalizeCalendarEventType } from "./settings";

export const CALENDAR_EVENT_STATUSES = [
  "suggested",
  "awaiting_customer",
  "needs_business_approval",
  "scheduled",
  "completed",
  "cancelled",
] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

// Defined in ./directions so client components can use them without pulling
// this module's server-only imports into the browser bundle.
export type { CalendarAddressMetadata } from "./directions";
export { googleMapsDirectionsUrl } from "./directions";

export type CalendarEventItem = {
  appointmentType: CalendarEventType;
  contact: {
    company: string | null;
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  contactId: string | null;
  conversation: {
    id: string;
    leadTitle: string | null;
    status: string;
  } | null;
  conversationId: string | null;
  createdAt: string;
  description: string | null;
  endsAt: string | null;
  externalCalendarProvider: string | null;
  externalEventId: string | null;
  externalSyncError: string | null;
  externalSyncStatus: string | null;
  externalSyncedAt: string | null;
  id: string;
  lead: {
    id: string;
    priority: string;
    serviceType: string | null;
    status: string;
    title: string;
  } | null;
  leadId: string | null;
  location: string | null;
  locationAddress: CalendarAddressMetadata | null;
  startsAt: string | null;
  status: string;
  title: string;
  updatedAt: string;
};

export type CalendarEntityOptions = {
  contacts: Array<{
    address: string | null;
    company: string | null;
    email: string | null;
    id: string;
    label: string;
    phone: string | null;
  }>;
  conversations: Array<{
    contactId: string | null;
    detail: string;
    id: string;
    label: string;
    leadId: string | null;
  }>;
  leads: Array<{
    contactId: string | null;
    id: string;
    label: string;
    serviceType: string | null;
    status: string;
  }>;
};

export type CalendarEventMutationInput = {
  appointmentType: CalendarEventType;
  contactId: string | null;
  conversationId: string | null;
  createdByUserId?: string | null;
  description: string | null;
  endsAt: string | null;
  leadId: string | null;
  location: string | null;
  locationAddress: CalendarAddressMetadata | null;
  metadata?: Record<string, unknown>;
  startsAt: string | null;
  status: CalendarEventStatus;
  title: string;
};

type CalendarAppointmentRow = {
  appointment_type: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  created_at: string;
  description: string | null;
  ends_at: string | null;
  external_calendar_provider: string | null;
  external_event_id: string | null;
  external_sync_error: string | null;
  external_sync_status: string | null;
  external_synced_at: string | null;
  id: string;
  lead_id: string | null;
  location: string | null;
  metadata: unknown;
  starts_at: string | null;
  status: string | null;
  title: string | null;
  updated_at: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function normalizeCalendarEventStatus(
  value: string,
  startsAt: string | null,
): CalendarEventStatus {
  if (CALENDAR_EVENT_STATUSES.includes(value as CalendarEventStatus)) {
    return value as CalendarEventStatus;
  }

  return startsAt ? "scheduled" : "suggested";
}

function appointmentMetadata(
  metadata: unknown,
  locationAddress: CalendarAddressMetadata | null,
) {
  const current = objectRecord(metadata);
  const next = { ...current };
  delete next.address;

  return {
    ...next,
    ...(locationAddress ? { address: locationAddress } : {}),
  };
}

function calendarAddressFromMetadata(metadata: unknown) {
  const address = objectRecord(objectRecord(metadata).address);

  if (!Object.keys(address).length) {
    return null;
  }

  return {
    administrativeArea: textValue(address.administrativeArea),
    countryCode: textValue(address.countryCode),
    formattedAddress: textValue(address.formattedAddress),
    latitude: textValue(address.latitude),
    line1: textValue(address.line1),
    line2: textValue(address.line2),
    locality: textValue(address.locality),
    longitude: textValue(address.longitude),
    placeId: textValue(address.placeId),
    postalCode: textValue(address.postalCode),
    source: textValue(address.source),
    structured: objectRecord(address.structured),
    validationStatus: textValue(address.validationStatus),
  } satisfies CalendarAddressMetadata;
}

export function calendarAddressFromFormData(
  formData: FormData,
  name = "location",
): {
  location: string | null;
  metadata: CalendarAddressMetadata | null;
} {
  const parsed = parseAddressFormData(formData, name);

  if (!parsed.address) {
    return { location: null, metadata: null };
  }

  return {
    location: parsed.address,
    metadata: {
      administrativeArea: parsed.address_administrative_area,
      countryCode: parsed.address_country_code,
      formattedAddress: parsed.address,
      latitude: parsed.address_latitude,
      line1: parsed.address_line1,
      line2: parsed.address_line2,
      locality: parsed.address_locality,
      longitude: parsed.address_longitude,
      placeId: parsed.address_place_id,
      postalCode: parsed.address_postal_code,
      source: parsed.address_source,
      structured: objectRecord(parsed.address_structured),
      validationStatus: parsed.address_validation_status,
    },
  };
}

async function hydrateCalendarEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  rows: CalendarAppointmentRow[],
): Promise<CalendarEventItem[]> {
  const contactIds = uniqueIds(rows.map((row) => row.contact_id));
  const leadIds = uniqueIds(rows.map((row) => row.lead_id));
  const conversationIds = uniqueIds(rows.map((row) => row.conversation_id));

  const [contacts, leads, conversations] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from("contacts")
          .select("id,name,email,phone,company,address")
          .eq("workspace_id", workspaceId)
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? supabase
          .from("leads")
          .select("id,title,status,priority,service_type")
          .eq("workspace_id", workspaceId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length > 0
      ? supabase
          .from("conversations")
          .select("id,status,lead_id")
          .eq("workspace_id", workspaceId)
          .in("id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contacts.error) {
    throw new Error(`Unable to load event contacts: ${contacts.error.message}`);
  }

  if (leads.error) {
    throw new Error(`Unable to load event leads: ${leads.error.message}`);
  }

  if (conversations.error) {
    throw new Error(
      `Unable to load event conversations: ${conversations.error.message}`,
    );
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
        priority: String(lead.priority),
        serviceType: textValue(lead.service_type),
        status: String(lead.status),
        title: String(lead.title),
      },
    ]),
  );
  const conversationsById = new Map(
    (conversations.data ?? []).map((conversation) => [
      String(conversation.id),
      {
        id: String(conversation.id),
        leadTitle: conversation.lead_id
          ? (leadsById.get(String(conversation.lead_id))?.title ?? null)
          : null,
        status: String(conversation.status),
      },
    ]),
  );

  return rows.map((row) => ({
    appointmentType: normalizeCalendarEventTypeValue(row.appointment_type),
    contact: row.contact_id ? (contactsById.get(row.contact_id) ?? null) : null,
    contactId: row.contact_id,
    conversation: row.conversation_id
      ? (conversationsById.get(row.conversation_id) ?? null)
      : null,
    conversationId: row.conversation_id,
    createdAt: String(row.created_at),
    description: textValue(row.description),
    endsAt: row.ends_at,
    externalCalendarProvider: row.external_calendar_provider,
    externalEventId: row.external_event_id,
    externalSyncError: row.external_sync_error,
    externalSyncStatus: row.external_sync_status,
    externalSyncedAt: row.external_synced_at,
    id: String(row.id),
    lead: row.lead_id ? (leadsById.get(row.lead_id) ?? null) : null,
    leadId: row.lead_id,
    location: textValue(row.location),
    locationAddress: calendarAddressFromMetadata(row.metadata),
    startsAt: row.starts_at,
    status: row.status ?? "suggested",
    title: row.title ?? "Kyro appointment",
    updatedAt: String(row.updated_at),
  }));
}

export async function getCalendarEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  {
    from,
    to,
  }: {
    from: string;
    to: string;
  },
) {
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select(
      "id,conversation_id,contact_id,lead_id,appointment_type,title,description,status,starts_at,ends_at,location,metadata,external_calendar_provider,external_event_id,external_sync_status,external_sync_error,external_synced_at,created_at,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .or(`starts_at.gte.${from},ends_at.gte.${from}`)
    .lt("starts_at", to)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    throw new Error(`Unable to load calendar events: ${error.message}`);
  }

  return hydrateCalendarEvents(
    supabase,
    workspaceId,
    (data ?? []) as CalendarAppointmentRow[],
  );
}

export async function getCalendarEventById(
  supabase: SupabaseClient,
  workspaceId: string,
  appointmentId: string,
) {
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select(
      "id,conversation_id,contact_id,lead_id,appointment_type,title,description,status,starts_at,ends_at,location,metadata,external_calendar_provider,external_event_id,external_sync_status,external_sync_error,external_synced_at,created_at,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load calendar event: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const [event] = await hydrateCalendarEvents(supabase, workspaceId, [
    data as CalendarAppointmentRow,
  ]);

  return event ?? null;
}

export async function getContactCalendarEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
) {
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select(
      "id,conversation_id,contact_id,lead_id,appointment_type,title,description,status,starts_at,ends_at,location,metadata,external_calendar_provider,external_event_id,external_sync_status,external_sync_error,external_synced_at,created_at,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .order("starts_at", { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) {
    throw new Error(`Unable to load contact calendar events: ${error.message}`);
  }

  return hydrateCalendarEvents(
    supabase,
    workspaceId,
    (data ?? []) as CalendarAppointmentRow[],
  );
}

export async function getCalendarEntityOptions(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<CalendarEntityOptions> {
  const [contacts, leads, conversations] = await Promise.all([
    supabase
      .from("contacts")
      .select("id,name,email,phone,company,address,updated_at")
      .eq("workspace_id", workspaceId)
      .is("merged_into_contact_id", null)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("leads")
      .select("id,title,status,service_type,contact_id,updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("conversations")
      .select("id,status,contact_id,lead_id,last_message_at")
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200),
  ]);

  if (contacts.error) {
    throw new Error(
      `Unable to load calendar contacts: ${contacts.error.message}`,
    );
  }

  if (leads.error) {
    throw new Error(`Unable to load calendar leads: ${leads.error.message}`);
  }

  if (conversations.error) {
    throw new Error(
      `Unable to load calendar conversations: ${conversations.error.message}`,
    );
  }

  const contactLabelsById = new Map(
    (contacts.data ?? []).map((contact) => [
      String(contact.id),
      textValue(contact.name) ??
        textValue(contact.company) ??
        textValue(contact.email) ??
        textValue(contact.phone) ??
        "Contact",
    ]),
  );
  const leadLabelsById = new Map(
    (leads.data ?? []).map((lead) => [String(lead.id), String(lead.title)]),
  );

  return {
    contacts: (contacts.data ?? []).map((contact) => ({
      address: textValue(contact.address),
      company: textValue(contact.company),
      email: textValue(contact.email),
      id: String(contact.id),
      label:
        textValue(contact.name) ??
        textValue(contact.company) ??
        textValue(contact.email) ??
        textValue(contact.phone) ??
        "Contact",
      phone: textValue(contact.phone),
    })),
    conversations: (conversations.data ?? []).map((conversation) => {
      const leadTitle = conversation.lead_id
        ? leadLabelsById.get(String(conversation.lead_id))
        : null;
      const contactLabel = conversation.contact_id
        ? contactLabelsById.get(String(conversation.contact_id))
        : null;

      return {
        contactId: conversation.contact_id
          ? String(conversation.contact_id)
          : null,
        detail: [contactLabel, conversation.status].filter(Boolean).join(" - "),
        id: String(conversation.id),
        label: leadTitle ?? contactLabel ?? "Conversation",
        leadId: conversation.lead_id ? String(conversation.lead_id) : null,
      };
    }),
    leads: (leads.data ?? []).map((lead) => ({
      contactId: lead.contact_id ? String(lead.contact_id) : null,
      id: String(lead.id),
      label: String(lead.title),
      serviceType: textValue(lead.service_type),
      status: String(lead.status),
    })),
  };
}

export async function resolveCalendarLinkedEntities({
  contactId,
  conversationId,
  leadId,
  supabase,
  workspaceId,
}: {
  contactId: string | null;
  conversationId: string | null;
  leadId: string | null;
  supabase: SupabaseClient;
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
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Linked inquiry was not found.");
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
      throw new Error(error.message);
    }

    resolvedContactId = data?.contact_id ? String(data.contact_id) : null;
  }

  return {
    contactId: resolvedContactId,
    leadId: resolvedLeadId,
  };
}

export async function createCalendarEventRecord({
  input,
  supabase,
  userId,
  workspaceId,
}: {
  input: CalendarEventMutationInput;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("conversation_appointments")
    .insert({
      appointment_type: input.appointmentType,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      created_by_user_id: input.createdByUserId ?? userId,
      description: input.description,
      ends_at: input.endsAt,
      lead_id: input.leadId,
      location: input.location,
      metadata: appointmentMetadata(
        input.metadata ?? { source: "calendar" },
        input.locationAddress,
      ),
      starts_at: input.startsAt,
      status: input.status,
      title: input.title,
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create calendar event.");
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "calendar_event.created",
    entityType: "conversation_appointment",
    entityId: String(data.id),
    after: { input },
  });

  await syncAppointmentToExternalCalendar({
    action: "create",
    appointmentId: String(data.id),
    supabase,
    workspaceId,
  });

  return String(data.id);
}

export async function updateCalendarEventRecord({
  appointmentId,
  input,
  supabase,
  userId,
  workspaceId,
}: {
  appointmentId: string;
  input: CalendarEventMutationInput;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const { data: before, error: beforeError } = await supabase
    .from("conversation_appointments")
    .select("id,metadata")
    .eq("workspace_id", workspaceId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (beforeError) {
    throw new Error(beforeError.message);
  }

  if (!before) {
    throw new Error("Calendar event was not found.");
  }

  const { error } = await supabase
    .from("conversation_appointments")
    .update({
      appointment_type: input.appointmentType,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      description: input.description,
      ends_at: input.endsAt,
      lead_id: input.leadId,
      location: input.location,
      metadata: appointmentMetadata(
        {
          ...objectRecord(before.metadata),
          ...objectRecord(input.metadata),
        },
        input.locationAddress,
      ),
      starts_at: input.startsAt,
      status: input.status,
      title: input.title,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", appointmentId);

  if (error) {
    throw new Error(`Unable to update calendar event: ${error.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "calendar_event.updated",
    entityType: "conversation_appointment",
    entityId: appointmentId,
    after: { input },
  });

  await syncAppointmentToExternalCalendar({
    action: "update",
    appointmentId,
    supabase,
    workspaceId,
  });

  await resolveCalendarFutureStepFromUserMutation({
    calendarEventId: appointmentId,
    status: input.status,
    supabase,
    userId,
    workspaceId,
  });
}

export async function deleteCalendarEventRecord({
  appointmentId,
  supabase,
  userId,
  workspaceId,
}: {
  appointmentId: string;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const futureStepId = await getActiveCalendarFutureStepId(
    supabase,
    workspaceId,
    appointmentId,
  );
  const externalDelete = await deleteAppointmentFromExternalCalendar({
    appointmentId,
    supabase,
    workspaceId,
  });

  const { error } = await supabase
    .from("conversation_appointments")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", appointmentId);

  if (error) {
    throw new Error(`Unable to delete calendar event: ${error.message}`);
  }

  await resolveCalendarFutureStepFromUserMutation({
    calendarEventId: appointmentId,
    futureStepId,
    status: "cancelled",
    supabase,
    userId,
    workspaceId,
  });

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "calendar_event.deleted",
    entityType: "conversation_appointment",
    entityId: appointmentId,
    metadata: {
      externalDelete,
    },
  });

  return externalDelete;
}
