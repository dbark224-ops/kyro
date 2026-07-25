"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  calendarAddressFromFormData,
  createCalendarEventRecord,
  deleteCalendarEventRecord,
  normalizeCalendarEventStatus,
  normalizeCalendarEventType,
  resolveCalendarLinkedEntities,
  updateCalendarEventRecord,
} from "../../lib/calendar/events";
import {
  CALENDAR_SETTINGS_POLICY_TYPE,
  CALENDAR_WEEK_LAYOUTS,
  getCalendarSettings,
  normalizeCalendarSettings,
  type CalendarWeekLayout,
} from "../../lib/calendar/settings";
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

  const linked = await resolveCalendarLinkedEntities({
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
    redirectWithCalendarMessage(
      "engine_error",
      "Choose an event to update.",
      redirectTo,
    );
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
      error instanceof Error
        ? error.message
        : "Unable to update calendar event.",
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
    redirectWithCalendarMessage(
      "engine_error",
      "Choose an event to delete.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    await deleteCalendarEventRecord({
      appointmentId,
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
      error instanceof Error
        ? error.message
        : "Unable to delete calendar event.",
      redirectTo,
    );
  }

  redirectWithCalendarMessage(
    "engine_message",
    "Calendar event deleted.",
    redirectTo,
  );
}

export async function updateCalendarWeekLayoutAction(input: {
  weekDaysBefore: number;
  weekLayout: CalendarWeekLayout;
}) {
  if (!CALENDAR_WEEK_LAYOUTS.includes(input.weekLayout)) {
    throw new Error("Choose a valid calendar week layout.");
  }

  if (
    !Number.isInteger(input.weekDaysBefore) ||
    input.weekDaysBefore < 0 ||
    input.weekDaysBefore > 6
  ) {
    throw new Error("Choose between zero and six days before the focus day.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const beforeSettings = await getCalendarSettings(supabase, workspace.id);
  const settings = normalizeCalendarSettings({
    ...beforeSettings,
    weekDaysBefore: input.weekDaysBefore,
    weekLayout: input.weekLayout,
  });
  const { data, error } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: CALENDAR_SETTINGS_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      { onConflict: "workspace_id,policy_type" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to save calendar week layout: ${error?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(supabase, {
    action: "calendar_week_layout.updated",
    actorId: user.id,
    actorType: "user",
    after: {
      weekDaysBefore: settings.weekDaysBefore,
      weekLayout: settings.weekLayout,
    },
    before: {
      weekDaysBefore: beforeSettings.weekDaysBefore,
      weekLayout: beforeSettings.weekLayout,
    },
    entityId: String(data.id),
    entityType: "workspace_policy",
    workspaceId: workspace.id,
  });

  return {
    weekDaysBefore: settings.weekDaysBefore,
    weekLayout: settings.weekLayout,
  };
}
