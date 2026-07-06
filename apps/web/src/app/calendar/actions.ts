"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  calendarAddressFromFormData,
  createCalendarEventRecord,
  normalizeCalendarEventStatus,
  normalizeCalendarEventType,
  updateCalendarEventRecord,
} from "../../lib/calendar/events";
import { deleteAppointmentFromExternalCalendar } from "../../lib/calendar/provider-sync";
import { insertAuditLog } from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: string) {
  return value.trim() ? value.trim() : null;
}

function optionalIsoDateTime(value: string) {
  if (!value.trim()) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeCalendarRedirect(value: string) {
  if (!value.startsWith("/calendar")) {
    return "/calendar";
  }

  return value;
}

function redirectWithCalendarMessage(
  key: "engine_error" | "engine_message",
  message: string,
  redirectTo = "/calendar",
): never {
  const [path, query = ""] = safeCalendarRedirect(redirectTo).split("?");
  const params = new URLSearchParams(query);
  params.set(key, message);

  redirect(`${path}?${params.toString()}`);
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
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"];
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

async function eventInputFromForm(
  formData: FormData,
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>["supabase"],
  workspaceId: string,
) {
  const startsAt = optionalIsoDateTime(
    formString(formData, "startsAt") || formString(formData, "startsAtIso"),
  );
  const endsAt = optionalIsoDateTime(
    formString(formData, "endsAt") || formString(formData, "endsAtIso"),
  );
  const title = formString(formData, "title");
  const conversationId = nullableText(formString(formData, "conversationId"));
  const rawLeadId = nullableText(formString(formData, "leadId"));
  const rawContactId = nullableText(formString(formData, "contactId"));
  const address = calendarAddressFromFormData(formData, "location");

  if (!title) {
    throw new Error("Add an event title first.");
  }

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error("The end time needs to be after the start time.");
  }

  const linked = await resolveLinkedEntities({
    contactId: rawContactId,
    conversationId,
    leadId: rawLeadId,
    supabase,
    workspaceId,
  });

  return {
    appointmentType: normalizeCalendarEventType(
      formString(formData, "appointmentType"),
    ),
    contactId: linked.contactId,
    conversationId,
    description: nullableText(formString(formData, "description")),
    endsAt,
    leadId: linked.leadId,
    location: address.location,
    locationAddress: address.metadata,
    metadata: { source: "calendar" },
    startsAt,
    status: normalizeCalendarEventStatus(
      formString(formData, "status"),
      startsAt,
    ),
    title,
  };
}

export async function createCalendarEventAction(formData: FormData) {
  const redirectTo = safeCalendarRedirect(formString(formData, "redirectTo"));
  const { supabase, user, workspace } = await requireWorkspaceContext();
  let appointmentId: string;

  try {
    const input = await eventInputFromForm(formData, supabase, workspace.id);
    appointmentId = await createCalendarEventRecord({
      input,
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    });

    revalidatePath("/calendar");
    revalidatePath("/inbox");
    revalidatePath("/contacts");
  } catch (error) {
    redirectWithCalendarMessage(
      "engine_error",
      error instanceof Error ? error.message : "Unable to save calendar event.",
      redirectTo,
    );
  }

  redirectWithCalendarMessage(
    "engine_message",
    "Calendar event saved.",
    `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}event=${appointmentId}`,
  );
}

export async function updateCalendarEventAction(formData: FormData) {
  const appointmentId = formString(formData, "appointmentId");
  const redirectTo = safeCalendarRedirect(formString(formData, "redirectTo"));

  if (!appointmentId) {
    redirectWithCalendarMessage("engine_error", "Choose an event to update.", redirectTo);
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    const input = await eventInputFromForm(formData, supabase, workspace.id);

    await updateCalendarEventRecord({
      appointmentId,
      input,
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    });

    revalidatePath("/calendar");
    revalidatePath("/inbox");
    revalidatePath("/contacts");
  } catch (error) {
    redirectWithCalendarMessage(
      "engine_error",
      error instanceof Error ? error.message : "Unable to update calendar event.",
      redirectTo,
    );
  }

  redirectWithCalendarMessage(
    "engine_message",
    "Calendar event updated.",
    `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}event=${appointmentId}`,
  );
}

export async function deleteCalendarEventAction(formData: FormData) {
  const appointmentId = formString(formData, "appointmentId");
  const redirectTo = safeCalendarRedirect(formString(formData, "redirectTo"));

  if (!appointmentId) {
    redirectWithCalendarMessage("engine_error", "Choose an event to delete.", redirectTo);
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    await deleteAppointmentFromExternalCalendar({
      appointmentId,
      supabase,
      workspaceId: workspace.id,
    });

    const { error } = await supabase
      .from("conversation_appointments")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("id", appointmentId);

    if (error) {
      throw new Error(error.message);
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "calendar_event.deleted",
      entityType: "conversation_appointment",
      entityId: appointmentId,
    });

    revalidatePath("/calendar");
    revalidatePath("/inbox");
    revalidatePath("/contacts");
  } catch (error) {
    redirectWithCalendarMessage(
      "engine_error",
      error instanceof Error ? error.message : "Unable to delete calendar event.",
      redirectTo,
    );
  }

  redirectWithCalendarMessage(
    "engine_message",
    "Calendar event deleted.",
    redirectTo,
  );
}
