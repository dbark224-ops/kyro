import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import { getVoiceSettings } from "../assistant/voice-settings";
import {
  createCalendarEventRecord,
  normalizeCalendarEventStatus,
} from "../calendar/events";
import {
  getCalendarSettings,
  normalizeCalendarEventType,
} from "../calendar/settings";
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  isoFromDateKeyAndMinutes,
  providerDateTimeToIso,
  safeTimeZone,
  timeZoneParts,
} from "../timezone";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import { notifyInboundVoiceInquiry } from "./inbound-inquiry-notifications";
import { textValue } from "@kyro/core";

export const INBOUND_BOOKING_TOOL_NAME = "kyro_request_booking" as const;

type BookingToolAction = "check_availability" | "request_booking";

type BusyCalendarEvent = {
  endsAt: string;
  id: string;
  startsAt: string;
};

type InboundBookingRequest = {
  action: BookingToolAction;
  args: Record<string, unknown>;
  idempotencyKey?: string | null;
  providerCallId?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
};

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function compactText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();

  return clean.length <= maxLength
    ? clean
    : `${clean.slice(0, maxLength - 1).trim()}...`;
}

function minutesFromTime(value: string | null | undefined) {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);

  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function roundedUpToHalfHour(minutes: number) {
  return Math.ceil(minutes / 30) * 30;
}

function dayName(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  })
    .format(value)
    .toLowerCase();
}

function slotMinutes(value: string, timeZone: string) {
  const parts = timeZoneParts(new Date(value), timeZone);
  return parts.hour * 60 + parts.minute;
}

export function calendarIntervalsOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
) {
  return (
    new Date(leftStart).getTime() < new Date(rightEnd).getTime() &&
    new Date(leftEnd).getTime() > new Date(rightStart).getTime()
  );
}

function slotFitsBusinessHours(input: {
  endsAt: string;
  schedule: Awaited<
    ReturnType<typeof getWorkspaceGeneralSettings>
  >["businessProfile"]["workingHoursSchedule"];
  startsAt: string;
  timeZone: string;
}) {
  if (
    dateKeyInTimeZone(input.startsAt, input.timeZone) !==
    dateKeyInTimeZone(input.endsAt, input.timeZone)
  ) {
    return false;
  }

  const day = input.schedule.days.find(
    (candidate) =>
      candidate.day === dayName(new Date(input.startsAt), input.timeZone),
  );
  const dayStart = minutesFromTime(day?.startTime);
  const dayEnd = minutesFromTime(day?.endTime);

  return Boolean(
    day?.enabled &&
      dayStart !== null &&
      dayEnd !== null &&
      slotMinutes(input.startsAt, input.timeZone) >= dayStart &&
      slotMinutes(input.endsAt, input.timeZone) <= dayEnd,
  );
}

function slotIsFree(input: {
  bufferAfter: number;
  bufferBefore: number;
  busy: BusyCalendarEvent[];
  endsAt: string;
  startsAt: string;
}) {
  const requestedStart = new Date(input.startsAt).getTime();
  const requestedEnd = new Date(input.endsAt).getTime();

  return !input.busy.some((event) => {
    const busyStart =
      new Date(event.startsAt).getTime() - input.bufferBefore * 60_000;
    const busyEnd =
      new Date(event.endsAt).getTime() + input.bufferAfter * 60_000;

    return requestedStart < busyEnd && requestedEnd > busyStart;
  });
}

async function loadBusyCalendarEvents(input: {
  from: string;
  supabase: SupabaseClient;
  to: string;
  workspaceId: string;
}) {
  const { data, error } = await input.supabase
    .from("conversation_appointments")
    .select("id,status,starts_at,ends_at")
    .eq("workspace_id", input.workspaceId)
    .neq("status", "cancelled")
    .lt("starts_at", input.to)
    .gt("ends_at", input.from)
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to check calendar availability: ${error.message}`);
  }

  return (data ?? [])
    .map((event) => ({
      endsAt: textValue(event.ends_at),
      id: String(event.id),
      startsAt: textValue(event.starts_at),
    }))
    .filter(
      (event): event is BusyCalendarEvent =>
        Boolean(event.startsAt && event.endsAt),
    );
}

function formatSlot(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

async function availableSlots(input: {
  busy: BusyCalendarEvent[];
  calendarSettings: Awaited<ReturnType<typeof getCalendarSettings>>;
  durationMinutes: number;
  from: string;
  generalSettings: Awaited<ReturnType<typeof getWorkspaceGeneralSettings>>;
  limit?: number;
  to: string;
}) {
  const timeZone = safeTimeZone(input.generalSettings.timeZone);
  const startDateKey = dateKeyInTimeZone(input.from, timeZone);
  const endTimestamp = new Date(input.to).getTime();
  const firstParts = timeZoneParts(new Date(input.from), timeZone);
  const firstMinutes = firstParts.hour * 60 + firstParts.minute;
  const slots: Array<{ endsAt: string; startsAt: string }> = [];

  for (let dayOffset = 0; dayOffset < 15; dayOffset += 1) {
    const dateKey = addDaysToDateKey(startDateKey, dayOffset);
    const midday = new Date(isoFromDateKeyAndMinutes(dateKey, 12 * 60, timeZone));
    const day = input.generalSettings.businessProfile.workingHoursSchedule.days.find(
      (candidate) => candidate.day === dayName(midday, timeZone),
    );
    const dayStart = minutesFromTime(day?.startTime);
    const dayEnd = minutesFromTime(day?.endTime);

    if (!day?.enabled || dayStart === null || dayEnd === null) {
      continue;
    }

    const firstSlot =
      dayOffset === 0
        ? Math.max(dayStart, roundedUpToHalfHour(firstMinutes))
        : dayStart;

    for (
      let minute = firstSlot;
      minute + input.durationMinutes <= dayEnd;
      minute += 30
    ) {
      const startsAt = isoFromDateKeyAndMinutes(dateKey, minute, timeZone);
      const endsAt = new Date(
        new Date(startsAt).getTime() + input.durationMinutes * 60_000,
      ).toISOString();

      if (
        new Date(startsAt).getTime() < new Date(input.from).getTime() ||
        new Date(endsAt).getTime() > endTimestamp
      ) {
        continue;
      }

      if (
        slotIsFree({
          bufferAfter: input.calendarSettings.bufferMinutesAfter,
          bufferBefore: input.calendarSettings.bufferMinutesBefore,
          busy: input.busy,
          endsAt,
          startsAt,
        })
      ) {
        slots.push({ endsAt, startsAt });
      }

      if (slots.length >= (input.limit ?? 4)) {
        return slots;
      }
    }
  }

  return slots;
}

export async function findWorkspaceAvailableSlots(input: {
  durationMinutes?: number;
  from: string;
  limit?: number;
  supabase: SupabaseClient;
  to: string;
  workspaceId: string;
}) {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error("A valid calendar availability window is required.");
  }

  // You cannot book the past, and a slot that has already gone is not
  // availability. A range meaning "today" starts at midnight, so the first
  // free slot inside it was the start of the working day whatever the clock
  // said -- which is how a customer reporting a flood at 1:11pm was offered a
  // visit at 7:00am, six hours earlier. Every caller wants slots it can still
  // offer, so the floor belongs here rather than in each of them.
  const searchFromMs = Math.max(fromMs, Date.now());
  const [calendarSettings, generalSettings] = await Promise.all([
    getCalendarSettings(input.supabase, input.workspaceId),
    getWorkspaceGeneralSettings(input.supabase, input.workspaceId),
  ]);
  const durationMinutes = Math.max(
    15,
    Math.min(
      480,
      Math.round(
        input.durationMinutes ?? calendarSettings.defaultDurationMinutes,
      ),
    ),
  );
  const timeZone = safeTimeZone(generalSettings.timeZone);

  // The whole window is behind us. No slots rather than stale ones: the caller
  // then asks the customer what suits instead of proposing a time that has
  // been and gone.
  if (searchFromMs >= toMs) {
    return { durationMinutes, slots: [], timeZone };
  }

  const searchFrom = new Date(searchFromMs).toISOString();
  const busy = await loadBusyCalendarEvents({
    from: new Date(
      searchFromMs - calendarSettings.bufferMinutesBefore * 60_000,
    ).toISOString(),
    supabase: input.supabase,
    to: new Date(
      toMs + calendarSettings.bufferMinutesAfter * 60_000,
    ).toISOString(),
    workspaceId: input.workspaceId,
  });
  const slots = await availableSlots({
    busy,
    calendarSettings,
    durationMinutes,
    from: searchFrom,
    generalSettings,
    limit: input.limit,
    to: input.to,
  });

  return {
    durationMinutes,
    slots: slots.map((slot) => ({
      ...slot,
      label: formatSlot(slot.startsAt, timeZone),
    })),
    timeZone,
  };
}

function bookingTitle(args: Record<string, unknown>, callerName: string | null) {
  const supplied =
    textValue(args.title) ??
    textValue(args.serviceType) ??
    textValue(args.jobType);
  const stripped = supplied
    ?.replace(/^calendar\s+event\s+(?:for\s+)?/i, "")
    .replace(/^appointment\s+(?:for\s+)?/i, "")
    .replace(/\s+on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/i, "")
    .replace(/\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b.*$/i, "")
    .trim();

  if (stripped) {
    return compactText(stripped, 100);
  }

  return callerName
    ? compactText(`Quote visit - ${callerName}`, 100)
    : "Customer appointment";
}

async function loadInboundCall(input: {
  providerCallId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  if (!input.providerCallId) {
    return null;
  }

  const { data, error } = await input.supabase
    .from("voice_calls")
    .select(
      "id,provider_call_id,direction,purpose,contact_id,lead_id,conversation_id",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "vapi")
    .eq("provider_call_id", input.providerCallId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load inbound voice call: ${error.message}`);
  }

  if (
    !data ||
    data.direction !== "inbound" ||
    !["inbound_customer", "voicemail_overflow"].includes(String(data.purpose))
  ) {
    return null;
  }

  return {
    contactId: textValue(data.contact_id),
    conversationId: textValue(data.conversation_id),
    id: String(data.id),
    leadId: textValue(data.lead_id),
    providerCallId: textValue(data.provider_call_id),
    purpose: String(data.purpose),
  };
}

async function existingToolEvent(input: {
  idempotencyKey: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  if (!input.idempotencyKey) {
    return null;
  }

  const { data, error } = await input.supabase
    .from("conversation_appointments")
    .select("id,title,status,starts_at,ends_at")
    .eq("workspace_id", input.workspaceId)
    .contains("metadata", { vapiToolCallId: input.idempotencyKey })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to inspect booking request: ${error.message}`);
  }

  return data;
}

export async function requestInboundVoiceBooking(
  input: InboundBookingRequest,
) {
  const [voiceSettings, calendarSettings, generalSettings] = await Promise.all([
    getVoiceSettings(input.supabase, input.workspaceId),
    getCalendarSettings(input.supabase, input.workspaceId),
    getWorkspaceGeneralSettings(input.supabase, input.workspaceId),
  ]);
  const mode = voiceSettings.phoneAgentInboundInquiryMode;
  const timeZone = safeTimeZone(generalSettings.timeZone);

  if (mode === "capture_notify") {
    return {
      answer:
        "This business reviews appointment requests before offering a time. Capture the caller's preferred timing with kyro_record_call_note and say the business will follow up.",
      mode,
      ok: false,
      reason: "booking_disabled",
    } as const;
  }

  const durationMinutes = Math.max(
    15,
    Math.min(
      480,
      Math.round(
        numberValue(input.args.durationMinutes) ??
          calendarSettings.defaultDurationMinutes,
      ),
    ),
  );
  const requestedStart = providerDateTimeToIso(
    textValue(input.args.requestedStart),
    timeZone,
  );
  const requestedEnd =
    providerDateTimeToIso(textValue(input.args.requestedEnd), timeZone) ??
    (requestedStart
      ? new Date(
          new Date(requestedStart).getTime() + durationMinutes * 60_000,
        ).toISOString()
      : null);
  const searchFrom =
    providerDateTimeToIso(textValue(input.args.windowStart), timeZone) ??
    requestedStart ??
    new Date().toISOString();
  const searchTo =
    providerDateTimeToIso(textValue(input.args.windowEnd), timeZone) ??
    new Date(new Date(searchFrom).getTime() + 14 * 24 * 60 * 60_000).toISOString();

  if (new Date(searchTo).getTime() <= new Date(searchFrom).getTime()) {
    return {
      answer: "The requested calendar window is invalid. Ask for the date and time again.",
      mode,
      ok: false,
      reason: "invalid_window",
    } as const;
  }

  const busy = await loadBusyCalendarEvents({
    from: new Date(
      new Date(searchFrom).getTime() -
        calendarSettings.bufferMinutesBefore * 60_000,
    ).toISOString(),
    supabase: input.supabase,
    to: new Date(
      new Date(searchTo).getTime() +
        calendarSettings.bufferMinutesAfter * 60_000,
    ).toISOString(),
    workspaceId: input.workspaceId,
  });
  const alternatives = await availableSlots({
    busy,
    calendarSettings,
    durationMinutes,
    from: searchFrom,
    generalSettings,
    limit: 4,
    to: searchTo,
  });

  if (input.action === "check_availability") {
    const exactAvailable = Boolean(
      requestedStart &&
        requestedEnd &&
        new Date(requestedStart).getTime() >= Date.now() &&
        slotFitsBusinessHours({
          endsAt: requestedEnd,
          schedule: generalSettings.businessProfile.workingHoursSchedule,
          startsAt: requestedStart,
          timeZone,
        }) &&
        slotIsFree({
          bufferAfter: calendarSettings.bufferMinutesAfter,
          bufferBefore: calendarSettings.bufferMinutesBefore,
          busy,
          endsAt: requestedEnd,
          startsAt: requestedStart,
        }),
    );
    const slots = alternatives.map((slot) => ({
      endsAt: slot.endsAt,
      label: formatSlot(slot.startsAt, timeZone),
      startsAt: slot.startsAt,
    }));

    return {
      answer: exactAvailable
        ? `${formatSlot(requestedStart!, timeZone)} is available.`
        : slots.length
          ? `That time is not available. The next available options are ${slots.map((slot) => slot.label).join(", ")}.`
          : "No available time was found in that window. Take the preferred timing as a message for the business.",
      available: exactAvailable,
      durationMinutes,
      mode,
      ok: true,
      slots,
      timeZone,
    } as const;
  }

  if (!requestedStart || !requestedEnd) {
    return {
      answer: "Ask the caller for a specific date and time before requesting the booking.",
      mode,
      ok: false,
      reason: "time_required",
    } as const;
  }

  const exactAvailable =
    new Date(requestedStart).getTime() >= Date.now() &&
    slotFitsBusinessHours({
      endsAt: requestedEnd,
      schedule: generalSettings.businessProfile.workingHoursSchedule,
      startsAt: requestedStart,
      timeZone,
    }) &&
    slotIsFree({
      bufferAfter: calendarSettings.bufferMinutesAfter,
      bufferBefore: calendarSettings.bufferMinutesBefore,
      busy,
      endsAt: requestedEnd,
      startsAt: requestedStart,
    });

  if (!exactAvailable) {
    const slots = alternatives.map((slot) => ({
      endsAt: slot.endsAt,
      label: formatSlot(slot.startsAt, timeZone),
      startsAt: slot.startsAt,
    }));

    return {
      answer: slots.length
        ? `That time cannot be booked. Offer one of these available options: ${slots.map((slot) => slot.label).join(", ")}.`
        : "That time cannot be booked and no alternative was found in the search window. Take a message for the business.",
      available: false,
      mode,
      ok: false,
      reason: "slot_unavailable",
      slots,
      timeZone,
    } as const;
  }

  await assertWorkspaceAutomationAllowed(input.workspaceId);
  const call = await loadInboundCall({
    providerCallId: input.providerCallId ?? null,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });

  if (!call?.contactId || !call.conversationId) {
    return {
      answer:
        "Capture the caller and inquiry with kyro_record_call_note first, then retry this booking request.",
      captureRequired: true,
      mode,
      ok: false,
      reason: "inquiry_not_captured",
    } as const;
  }

  const existing = await existingToolEvent({
    idempotencyKey: input.idempotencyKey ?? null,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });

  if (existing) {
    const existingStartsAt = textValue(existing.starts_at);

    if (!existingStartsAt) {
      throw new Error("The existing inbound booking has no start time.");
    }

    return {
      answer:
        existing.status === "suggested"
          ? `The draft appointment for ${formatSlot(existingStartsAt, timeZone)} is already waiting for approval.`
          : `The appointment for ${formatSlot(existingStartsAt, timeZone)} is already booked.`,
      appointmentId: String(existing.id),
      mode,
      ok: true,
      status: normalizeCalendarEventStatus(
        String(existing.status),
        textValue(existing.starts_at),
      ),
    } as const;
  }

  const [{ data: workspace }, { data: contact }] = await Promise.all([
    input.supabase
      .from("workspaces")
      .select("owner_user_id")
      .eq("id", input.workspaceId)
      .maybeSingle(),
    input.supabase
      .from("contacts")
      .select("name,address")
      .eq("workspace_id", input.workspaceId)
      .eq("id", call.contactId)
      .maybeSingle(),
  ]);
  const userId = textValue(workspace?.owner_user_id);

  if (!userId) {
    throw new Error("The workspace owner could not be resolved for booking.");
  }

  const title = bookingTitle(input.args, textValue(contact?.name));
  const status = mode === "book_from_calendar" ? "scheduled" : "suggested";
  const eventLabel = `${title} at ${formatSlot(requestedStart, timeZone)}`;
  const appointmentId = await createCalendarEventRecord({
    input: {
      appointmentType: normalizeCalendarEventType(
        input.args.eventType,
        calendarSettings.defaultEventType,
      ),
      contactId: call.contactId,
      conversationId: call.conversationId,
      createdByUserId: null,
      description:
        textValue(input.args.note) ??
        `Requested during inbound phone call ${call.providerCallId ?? call.id}.`,
      endsAt: requestedEnd,
      leadId: call.leadId,
      location:
        textValue(input.args.address) ?? textValue(contact?.address),
      locationAddress: null,
      metadata: {
        inboundInquiryMode: mode,
        providerCallId: call.providerCallId,
        source: "vapi_inbound_booking_request",
        vapiToolCallId: input.idempotencyKey ?? null,
        voiceCallId: call.id,
      },
      startsAt: requestedStart,
      status,
      title,
    },
    supabase: input.supabase,
    userId,
    workspaceId: input.workspaceId,
  });

  await notifyInboundVoiceInquiry({
    contactName: textValue(contact?.name),
    conversationId: call.conversationId,
    eventLabel,
    outcome: status === "scheduled" ? "booked" : "proposed",
    providerCallId: call.providerCallId,
    summary:
      textValue(input.args.note) ??
      `${title} requested for ${formatSlot(requestedStart, timeZone)}.`,
    supabase: input.supabase,
    voiceCallId: call.id,
    workspaceId: input.workspaceId,
  }).catch((error) => {
    console.error("Unable to notify workspace about inbound booking", {
      appointmentId,
      error: error instanceof Error ? error.message : "Unknown error",
      voiceCallId: call.id,
      workspaceId: input.workspaceId,
    });
  });

  return {
    answer:
      status === "scheduled"
        ? `Booked ${eventLabel}. Confirm that time with the caller.`
        : `Created a draft appointment for ${eventLabel}. Tell the caller the business will confirm it.`,
    appointmentId,
    endsAt: requestedEnd,
    mode,
    ok: true,
    startsAt: requestedStart,
    status,
    timeZone,
    title,
  } as const;
}
