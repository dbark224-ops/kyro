import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import {
  assertSmsSendAllowed,
  recordSmsRecipientPreference,
} from "../communication/sms-compliance";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import {
  findOrCreateTwilioSmsChannel,
  getActiveWorkspaceSmsNumber,
  getTwilioConfig,
  sendTwilioSmsMessage,
  telephonyUsageCost,
  TWILIO_PROVIDER,
  TWILIO_STATUS_WEBHOOK_PATH,
} from "../integrations/twilio";
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  isoFromDateKeyAndMinutes,
  isoRangeForDateKeyRange,
  safeTimeZone,
} from "../timezone";
import { writeOrThrow } from "../supabase/write";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import {
  getWorkspaceGeneralSettings,
  type WorkspaceGeneralSettings,
} from "../workspace/general-settings";
import { getNotificationSettings, type NotificationSettings } from "./settings";
import { textValue } from "@kyro/core";

type WorkspaceRow = {
  id: string;
  name: string | null;
  owner_user_id: string | null;
};

type AppointmentRow = {
  appointment_type: string | null;
  description: string | null;
  ends_at: string | null;
  id: string;
  location: string | null;
  starts_at: string | null;
  status: string | null;
  title: string | null;
};

type DeliverySlot = {
  id: string;
};

export type CalendarNotificationProcessResult = {
  digestsSent: number;
  errors: Array<{ error: string; workspaceId: string }>;
  remindersSent: number;
  skipped: number;
  workspaceCount: number;
};

const DUE_LOOKBACK_MS = 12 * 60_000;
const REMINDER_LOOKAHEAD_MS = 4 * 60 * 60_000;
const DELIVERY_INSERT_DUPLICATE_CODES = new Set(["23505"]);

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? null;
}

function twilioStatusCallbackUrl() {
  const baseUrl = appUrl();

  return baseUrl ? `${baseUrl}${TWILIO_STATUS_WEBHOOK_PATH}` : null;
}

function inDueWindow(scheduledFor: string, now: Date) {
  const scheduledAt = new Date(scheduledFor).getTime();
  const nowMs = now.getTime();

  return scheduledAt <= nowMs && scheduledAt >= nowMs - DUE_LOOKBACK_MS;
}

function minutesFromTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);

  return hour * 60 + minute;
}

function formatEventTime(value: string | null, timeZone: string) {
  if (!value) {
    return "Any time";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatEventDateTime(value: string | null, timeZone: string) {
  if (!value) {
    return "a time still to be set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function digestDateLabel(dateKey: string, timeZone: string) {
  const noon = isoFromDateKeyAndMinutes(dateKey, 12 * 60, timeZone);

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone,
  }).format(new Date(noon));
}

function eventTitle(event: AppointmentRow) {
  return textValue(event.title) ?? "Calendar event";
}

function reminderBody(event: AppointmentRow, timeZone: string) {
  const title = eventTitle(event);
  const time = formatEventDateTime(event.starts_at, timeZone);
  const location = textValue(event.location);

  return [
    `Kyro reminder: ${title} is at ${time}.`,
    location ? `Location: ${location}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function digestBody(
  events: AppointmentRow[],
  dateKey: string,
  timeZone: string,
) {
  const dateLabel = digestDateLabel(dateKey, timeZone);

  if (events.length === 0) {
    return `Kyro calendar for ${dateLabel}: no events scheduled.`;
  }

  const eventLines = events
    .slice(0, 8)
    .map(
      (event) =>
        `${formatEventTime(event.starts_at, timeZone)} ${eventTitle(event)}`,
    );
  const overflow =
    events.length > eventLines.length
      ? ` +${events.length - eventLines.length} more`
      : "";

  return `Kyro calendar for ${dateLabel}: ${eventLines.join("; ")}${overflow}.`;
}

function fallbackRecipientFromGeneral(settings: WorkspaceGeneralSettings) {
  const contacts = settings.businessProfile.workplaceContacts;
  const primary = contacts.find(
    (contact) => contact.primaryEscalationContact && contact.phoneNumber,
  );
  const firstWithPhone = contacts.find((contact) => contact.phoneNumber);

  return (
    textValue(primary?.phoneNumber) ??
    textValue(firstWithPhone?.phoneNumber) ??
    textValue(settings.businessProfile.publicPhoneNumber)
  );
}

function notificationRecipientPhone(
  notificationSettings: NotificationSettings,
  generalSettings: WorkspaceGeneralSettings,
) {
  const rawPhone =
    textValue(notificationSettings.calendarSmsRecipientPhone) ??
    fallbackRecipientFromGeneral(generalSettings);

  if (!rawPhone) {
    return null;
  }

  return (
    normalizeContactPhoneForRegion(
      rawPhone,
      generalSettings.defaultPhoneRegion,
    ) ?? rawPhone
  );
}

async function createDeliverySlot(
  supabase: SupabaseClient,
  input: {
    appointmentId?: string | null;
    body: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    notificationType: "calendar_daily_digest" | "calendar_event_reminder";
    recipientPhone: string;
    scheduledFor: string;
    targetDate?: string | null;
    userId?: string | null;
    workspaceId: string;
  },
): Promise<DeliverySlot | null> {
  const { data, error } = await supabase
    .from("calendar_notification_deliveries")
    .insert({
      appointment_id: input.appointmentId ?? null,
      body: input.body,
      idempotency_key: input.idempotencyKey,
      metadata: input.metadata ?? {},
      notification_type: input.notificationType,
      recipient_phone: input.recipientPhone,
      scheduled_for: input.scheduledFor,
      status: "pending",
      target_date: input.targetDate ?? null,
      user_id: input.userId ?? null,
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  if (error) {
    if (DELIVERY_INSERT_DUPLICATE_CODES.has(error.code ?? "")) {
      return null;
    }

    throw new Error(`Unable to create notification delivery: ${error.message}`);
  }

  return { id: String(data.id) };
}

async function markDeliveryFailed(
  supabase: SupabaseClient,
  deliveryId: string,
  error: unknown,
) {
  const message =
    error instanceof Error ? error.message : "Unable to send calendar SMS.";

  // Logged rather than thrown: the caller is already handling a failure, and
  // replacing it with a bookkeeping error would lose why the send failed.
  const { error: markFailedError } = await supabase
    .from("calendar_notification_deliveries")
    .update({
      attempt_count: 1,
      error: message,
      status: "failed",
    })
    .eq("id", deliveryId);

  if (markFailedError) {
    console.error(
      `Unable to mark calendar delivery ${deliveryId} as failed: ${markFailedError.message}`,
    );
  }
}

async function sendCalendarSmsDelivery(
  supabase: SupabaseClient,
  input: {
    body: string;
    deliveryId: string;
    notificationType: "calendar_daily_digest" | "calendar_event_reminder";
    recipientPhone: string;
    userId: string | null;
    workspaceId: string;
  },
) {
  await assertWorkspaceAutomationAllowed(input.workspaceId);
  await assertSmsSendAllowed(supabase, {
    phoneNumber: input.recipientPhone,
    workspaceId: input.workspaceId,
  });

  const workspaceSmsNumber = await getActiveWorkspaceSmsNumber(
    supabase,
    input.workspaceId,
  );
  const senderNumber =
    workspaceSmsNumber?.phoneNumber ??
    getTwilioConfig()?.defaultFromNumber ??
    null;

  if (!senderNumber) {
    throw new Error("No Kyro SMS sender number is available.");
  }

  // Claiming the delivery before sending is what stops a retry sending the
  // same reminder twice. Failing here is safe -- nothing has gone out yet --
  // so it is worth stopping for.
  await writeOrThrow(
    supabase
      .from("calendar_notification_deliveries")
      .update({ attempt_count: 1, status: "processing" })
      .eq("id", input.deliveryId),
    "Unable to claim the calendar notification delivery",
  );

  const result = await sendTwilioSmsMessage({
    body: input.body,
    from: senderNumber,
    statusCallbackUrl: twilioStatusCallbackUrl(),
    to: input.recipientPhone,
  });
  const channelId = await findOrCreateTwilioSmsChannel(supabase, {
    phoneNumber: senderNumber,
    providerPhoneNumberId: workspaceSmsNumber?.providerPhoneNumberId ?? null,
    workspaceId: input.workspaceId,
  });
  const now = new Date().toISOString();

  await recordSmsRecipientPreference(supabase, {
    channelNumberId: workspaceSmsNumber?.id ?? null,
    consentNote: "Workspace calendar notification recipient.",
    metadata: {
      channelId,
      deliveryId: input.deliveryId,
      notificationType: input.notificationType,
      providerMessageId: result.messageId,
      source: "calendar_notification",
    },
    phoneNumber: input.recipientPhone,
    source: "calendar_notification",
    status: "staff_internal",
    timestamp: now,
    touch: "outbound",
    workspaceId: input.workspaceId,
  });

  // The claim above already stops a retry re-sending, so throwing here makes a
  // lost record visible without risking a duplicate reminder.
  await writeOrThrow(
    supabase
      .from("calendar_notification_deliveries")
      .update({
        attempt_count: 1,
        error: null,
        metadata: {
          channelId,
          twilio: {
            accountSid: result.accountSid,
            direction: result.direction,
            numSegments: result.numSegments,
            price: result.price,
            priceUnit: result.priceUnit,
            status: result.status,
          },
          workspacePhoneNumberId: workspaceSmsNumber?.id ?? null,
        },
        provider: TWILIO_PROVIDER,
        provider_message_id: result.messageId,
        provider_request_id: result.providerRequestId,
        sent_at: now,
        status: "sent",
      })
      .eq("id", input.deliveryId),
    "Unable to record the sent calendar notification",
  );

  const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
    supabase,
    input.workspaceId,
    "TWILIO_MARKUP_RATE",
  );
  const telephonyCost = telephonyUsageCost({
    direction: "outbound",
    kind: "sms",
    markupRate: usageMarkupRate,
    providerCurrency: result.priceUnit,
    providerPrice: result.price ? Math.abs(result.price) : null,
  });

  // Billable, so a dropped insert is lost revenue -- the same silent path as
  // the AI, outbound and escalation usage writes. Reported rather than thrown:
  // the SMS has already gone out and failing here would not un-send it.
  const { error: usageError } = await supabase.from("usage_events").insert({
    cost_snapshot: String(telephonyCost.cost),
    currency: telephonyCost.currency,
    customer_charge_snapshot: String(telephonyCost.customerCharge),
    markup_snapshot: String(telephonyCost.markup),
    metadata: {
      billingTask: "sms_delivery",
      channelId,
      notificationDeliveryId: input.deliveryId,
      notificationType: input.notificationType,
      providerStatus: result.status,
      sentFrom: senderNumber,
      sentTo: input.recipientPhone,
      source: "calendar_notification",
    },
    model: null,
    provider: TWILIO_PROVIDER,
    provider_usage_id: result.messageId || result.providerRequestId,
    quantity: "1",
    service: "sms",
    source_id: input.deliveryId,
    source_type: "calendar_notification",
    unit: "message",
    unit_cost_snapshot: String(telephonyCost.cost),
    usage_type: "outbound_sms",
    user_id: input.userId,
    workspace_id: input.workspaceId,
  });

  if (usageError) {
    console.error(
      `Unable to record calendar SMS usage for delivery ${input.deliveryId}: ${usageError.message}`,
    );
  }
}

async function loadUpcomingReminderEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  now: Date,
) {
  const to = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS).toISOString();
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select(
      "id,title,description,status,appointment_type,starts_at,ends_at,location",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "scheduled")
    .not("starts_at", "is", null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", to)
    .order("starts_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(`Unable to load reminder events: ${error.message}`);
  }

  return (data ?? []) as AppointmentRow[];
}

async function loadEventsForDigestDate(
  supabase: SupabaseClient,
  input: {
    dateKey: string;
    timeZone: string;
    workspaceId: string;
  },
) {
  const range = isoRangeForDateKeyRange(
    {
      from: input.dateKey,
      to: addDaysToDateKey(input.dateKey, 1),
    },
    input.timeZone,
  );
  const { data, error } = await supabase
    .from("conversation_appointments")
    .select(
      "id,title,description,status,appointment_type,starts_at,ends_at,location",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("status", "scheduled")
    .not("starts_at", "is", null)
    .gte("starts_at", range.from)
    .lt("starts_at", range.to)
    .order("starts_at", { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(`Unable to load digest events: ${error.message}`);
  }

  return (data ?? []) as AppointmentRow[];
}

async function processWorkspaceReminders(
  supabase: SupabaseClient,
  input: {
    generalSettings: WorkspaceGeneralSettings;
    notificationSettings: NotificationSettings;
    now: Date;
    recipientPhone: string;
    workspace: WorkspaceRow;
  },
) {
  if (!input.notificationSettings.calendarSmsRemindersEnabled) {
    return { sent: 0, skipped: 1 };
  }

  const timeZone = safeTimeZone(input.generalSettings.timeZone);
  const events = await loadUpcomingReminderEvents(
    supabase,
    input.workspace.id,
    input.now,
  );
  let sent = 0;
  let skipped = 0;

  for (const event of events) {
    if (!event.starts_at) {
      skipped += 1;
      continue;
    }

    const scheduledFor = new Date(
      new Date(event.starts_at).getTime() -
        input.notificationSettings.calendarSmsReminderMinutes * 60_000,
    ).toISOString();

    if (!inDueWindow(scheduledFor, input.now)) {
      skipped += 1;
      continue;
    }

    const body = reminderBody(event, timeZone);
    const slot = await createDeliverySlot(supabase, {
      appointmentId: event.id,
      body,
      idempotencyKey: [
        "calendar_event_reminder",
        input.workspace.id,
        event.id,
        event.starts_at,
        input.notificationSettings.calendarSmsReminderMinutes,
      ].join(":"),
      metadata: {
        eventStartsAt: event.starts_at,
        reminderMinutes: input.notificationSettings.calendarSmsReminderMinutes,
        timeZone,
      },
      notificationType: "calendar_event_reminder",
      recipientPhone: input.recipientPhone,
      scheduledFor,
      userId: input.workspace.owner_user_id,
      workspaceId: input.workspace.id,
    });

    if (!slot) {
      skipped += 1;
      continue;
    }

    try {
      await sendCalendarSmsDelivery(supabase, {
        body,
        deliveryId: slot.id,
        notificationType: "calendar_event_reminder",
        recipientPhone: input.recipientPhone,
        userId: input.workspace.owner_user_id,
        workspaceId: input.workspace.id,
      });
      sent += 1;
    } catch (error) {
      await markDeliveryFailed(supabase, slot.id, error);
      throw error;
    }
  }

  return { sent, skipped };
}

function digestSchedule(
  settings: NotificationSettings,
  timeZone: string,
  now: Date,
) {
  const today = dateKeyInTimeZone(now, timeZone);
  const scheduledFor = isoFromDateKeyAndMinutes(
    today,
    minutesFromTime(settings.calendarDailyDigestTime),
    timeZone,
  );
  const targetDate =
    settings.calendarDailyDigestTiming === "night_before"
      ? addDaysToDateKey(today, 1)
      : today;

  return { scheduledFor, targetDate };
}

async function processWorkspaceDigest(
  supabase: SupabaseClient,
  input: {
    generalSettings: WorkspaceGeneralSettings;
    notificationSettings: NotificationSettings;
    now: Date;
    recipientPhone: string;
    workspace: WorkspaceRow;
  },
) {
  if (!input.notificationSettings.calendarDailyDigestEnabled) {
    return { sent: 0, skipped: 1 };
  }

  const timeZone = safeTimeZone(input.generalSettings.timeZone);
  const schedule = digestSchedule(
    input.notificationSettings,
    timeZone,
    input.now,
  );

  if (!inDueWindow(schedule.scheduledFor, input.now)) {
    return { sent: 0, skipped: 1 };
  }

  const events = await loadEventsForDigestDate(supabase, {
    dateKey: schedule.targetDate,
    timeZone,
    workspaceId: input.workspace.id,
  });
  const body = digestBody(events, schedule.targetDate, timeZone);
  const slot = await createDeliverySlot(supabase, {
    body,
    idempotencyKey: [
      "calendar_daily_digest",
      input.workspace.id,
      input.notificationSettings.calendarDailyDigestTiming,
      schedule.targetDate,
      input.notificationSettings.calendarDailyDigestTime,
    ].join(":"),
    metadata: {
      eventCount: events.length,
      timeZone,
      timing: input.notificationSettings.calendarDailyDigestTiming,
    },
    notificationType: "calendar_daily_digest",
    recipientPhone: input.recipientPhone,
    scheduledFor: schedule.scheduledFor,
    targetDate: schedule.targetDate,
    userId: input.workspace.owner_user_id,
    workspaceId: input.workspace.id,
  });

  if (!slot) {
    return { sent: 0, skipped: 1 };
  }

  try {
    await sendCalendarSmsDelivery(supabase, {
      body,
      deliveryId: slot.id,
      notificationType: "calendar_daily_digest",
      recipientPhone: input.recipientPhone,
      userId: input.workspace.owner_user_id,
      workspaceId: input.workspace.id,
    });
  } catch (error) {
    await markDeliveryFailed(supabase, slot.id, error);
    throw error;
  }

  return { sent: 1, skipped: 0 };
}

export async function processDueCalendarSmsNotifications(
  supabase: SupabaseClient,
  options: {
    limit?: number;
    now?: Date;
    workspaceId?: string | null;
  } = {},
): Promise<CalendarNotificationProcessResult> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));
  let query = supabase
    .from("workspaces")
    .select("id,name,owner_user_id")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (options.workspaceId) {
    query = query.eq("id", options.workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load workspaces: ${error.message}`);
  }

  const result: CalendarNotificationProcessResult = {
    digestsSent: 0,
    errors: [],
    remindersSent: 0,
    skipped: 0,
    workspaceCount: data?.length ?? 0,
  };

  for (const workspace of (data ?? []) as WorkspaceRow[]) {
    try {
      const [generalSettings, notificationSettings] = await Promise.all([
        getWorkspaceGeneralSettings(supabase, workspace.id),
        getNotificationSettings(supabase, workspace.id),
      ]);
      const recipientPhone = notificationRecipientPhone(
        notificationSettings,
        generalSettings,
      );

      if (!recipientPhone) {
        result.skipped += 1;
        continue;
      }

      const [reminders, digest] = await Promise.all([
        processWorkspaceReminders(supabase, {
          generalSettings,
          notificationSettings,
          now,
          recipientPhone,
          workspace,
        }),
        processWorkspaceDigest(supabase, {
          generalSettings,
          notificationSettings,
          now,
          recipientPhone,
          workspace,
        }),
      ]);

      result.remindersSent += reminders.sent;
      result.digestsSent += digest.sent;
      result.skipped += reminders.skipped + digest.skipped;
    } catch (error) {
      result.errors.push({
        error:
          error instanceof Error
            ? error.message
            : "Calendar notification processing failed.",
        workspaceId: workspace.id,
      });
    }
  }

  return result;
}
