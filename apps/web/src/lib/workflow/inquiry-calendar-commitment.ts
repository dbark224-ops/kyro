import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCalendarEventRecord,
  resolveCalendarLinkedEntities,
  updateCalendarEventRecord,
} from "../calendar/events";
import {
  getCalendarSettings,
  type CalendarEventType,
} from "../calendar/settings";
import { upsertCalendarConfirmationFutureStep } from "./inquiry-future-steps";

const INQUIRY_COMMITMENT_EVENT_SOURCE = "assistant_inquiry_commitment";
const ACTIVE_COMMITMENT_STATUSES = [
  "suggested",
  "awaiting_customer",
  "needs_business_approval",
  "scheduled",
] as const;

type InquiryCommitmentEventRow = {
  appointment_type: string | null;
  contact_id: string | null;
  id: string;
  lead_id: string | null;
  location: string | null;
  metadata: unknown;
};

export type VerifiedInquiryAvailability = {
  endsAt: string;
  label: string;
  startsAt: string;
  timeZone: string;
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function verifiedInquiryAvailabilityFromActionInput(
  value: unknown,
): VerifiedInquiryAvailability | null {
  const availability = objectRecord(
    objectRecord(value).verifiedAvailability,
  );
  const startsAt = textValue(availability.startsAt);
  const endsAt = textValue(availability.endsAt);
  const label = textValue(availability.label);
  const timeZone = textValue(availability.timeZone);
  const startsAtMs = startsAt ? Date.parse(startsAt) : Number.NaN;
  const endsAtMs = endsAt ? Date.parse(endsAt) : Number.NaN;

  if (
    !startsAt ||
    !endsAt ||
    !label ||
    !timeZone ||
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs) ||
    endsAtMs <= startsAtMs
  ) {
    return null;
  }

  return { endsAt, label, startsAt, timeZone };
}

function commitmentTitle(actionInput: Record<string, unknown>) {
  const inquiryFacts = objectRecord(actionInput.inquiryFacts);
  const jobType = textValue(inquiryFacts.jobType);

  if (!jobType || jobType.toLowerCase() === "general inquiry") {
    return "Quote visit";
  }

  const title = /\b(?:quote|quotation|estimate|site visit)\b/i.test(jobType)
    ? jobType
    : `${jobType} quote`;

  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`.slice(0, 90);
}

async function existingCommitmentEvent({
  conversationId,
  supabase,
  workspaceId,
}: {
  conversationId: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select("id,appointment_type,contact_id,lead_id,location,metadata")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .in("status", [...ACTIVE_COMMITMENT_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(
      `Unable to inspect the inquiry calendar hold: ${error.message}`,
    );
  }

  return (
    ((data ?? []) as InquiryCommitmentEventRow[]).find(
      (event) =>
        objectRecord(event.metadata).source ===
        INQUIRY_COMMITMENT_EVENT_SOURCE,
    ) ?? null
  );
}

function confirmationExpiry(startsAt: string) {
  const startsAtMs = Date.parse(startsAt);
  const minimumWait = Date.now() + 15 * 60 * 1000;
  const standardWait = Date.now() + 24 * 60 * 60 * 1000;
  const beforeAppointment = startsAtMs - 2 * 60 * 60 * 1000;

  return new Date(
    Math.max(minimumWait, Math.min(standardWait, beforeAppointment)),
  ).toISOString();
}

export async function upsertInquiryReplyCalendarCommitment({
  actionId,
  actionInput,
  conversationId,
  outboundMessageId,
  replyBody,
  supabase,
  userId,
  workspaceId,
}: {
  actionId: string;
  actionInput: Record<string, unknown>;
  conversationId: string;
  outboundMessageId?: string | null;
  replyBody: string;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const availability =
    verifiedInquiryAvailabilityFromActionInput(actionInput);

  if (!availability) {
    return null;
  }

  const [calendarSettings, existingEvent] = await Promise.all([
    getCalendarSettings(supabase, workspaceId),
    existingCommitmentEvent({ conversationId, supabase, workspaceId }),
  ]);
  const linked = await resolveCalendarLinkedEntities({
    contactId: existingEvent?.contact_id ?? null,
    conversationId,
    leadId: existingEvent?.lead_id ?? null,
    supabase,
    workspaceId,
  });
  const inquiryFacts = objectRecord(actionInput.inquiryFacts);
  const location =
    textValue(inquiryFacts.address) ?? existingEvent?.location ?? null;
  const title = commitmentTitle(actionInput);
  const input = {
    appointmentType:
      (existingEvent?.appointment_type as CalendarEventType | null) ??
      calendarSettings.defaultEventType,
    contactId: linked.contactId,
    conversationId,
    description: replyBody,
    endsAt: availability.endsAt,
    leadId: linked.leadId,
    location,
    locationAddress: null,
    metadata: {
      actionId,
      customerConfirmation: "awaiting_customer",
      source: INQUIRY_COMMITMENT_EVENT_SOURCE,
      verifiedAvailability: availability,
    },
    startsAt: availability.startsAt,
    status: "awaiting_customer" as const,
    title,
  };
  let eventId: string;
  let action: "created" | "updated";

  if (existingEvent) {
    await updateCalendarEventRecord({
      appointmentId: existingEvent.id,
      input,
      supabase,
      userId,
      workspaceId,
    });
    eventId = existingEvent.id;
    action = "updated";
  } else {
    eventId = await createCalendarEventRecord({
      input,
      supabase,
      userId,
      workspaceId,
    });
    action = "created";
  }

  await upsertCalendarConfirmationFutureStep({
    calendarEventId: eventId,
    contactId: linked.contactId,
    conversationId,
    expiresAt: confirmationExpiry(availability.startsAt),
    leadId: linked.leadId,
    messageId: outboundMessageId ?? null,
    offeredTimeLabel: availability.label,
    supabase,
    workspaceId,
  });

  return {
    action,
    eventId,
    startsAt: availability.startsAt,
    timeZone: availability.timeZone,
    title,
  };
}
