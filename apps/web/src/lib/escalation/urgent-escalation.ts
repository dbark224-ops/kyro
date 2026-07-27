import { fetchWithTimeout } from "../http/fetch-with-timeout";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateOperatorAlert } from "../ai/customer-message-generation";
import { getPublicAppUrl } from "../app-url";
import {
  assertSmsSendAllowed,
  recordSmsRecipientPreference,
} from "../communication/sms-compliance";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import { insertAuditLog } from "../engine/event-action-audit";
import { createVapiOutboundCall } from "../integrations/vapi";
import {
  getActiveWorkspaceSmsNumber,
  getTwilioConfig,
  sendTwilioSmsMessage,
  telephonyUsageCost,
  twilioMessageTransportForWorkspace,
  TWILIO_PROVIDER,
} from "../integrations/twilio";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import {
  getWorkspaceGeneralSettings,
  type BusinessHoursScheduleSettings,
  type UrgentEscalationTriggerKey,
  type WorkplaceContactSettings,
  type WorkspaceGeneralSettings,
} from "../workspace/general-settings";
import { getVoiceSettings } from "../assistant/voice-settings";
import { objectRecord, textValue } from "@kyro/core";
import { writeOrThrow } from "../supabase/write";

type UrgentEscalationInput = {
  content: string;
  contactId?: string | null;
  conversationId?: string | null;
  existingCustomer?: boolean;
  leadId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  priority?: string | null;
  sourceId?: string | null;
  sourceKey: string;
  sourceType: "email" | "sms" | "voice_call" | "manual" | "system";
  summary?: string | null;
  title?: string | null;
  vipCustomer?: boolean;
};

type EscalationStepRow = {
  attempt_count: number;
  channel: "email" | "app_notification" | "sms" | "phone";
  contact_snapshot: Record<string, unknown> | null;
  id: string;
  incident_id: string;
  max_attempts: number;
  position: number;
  workspace_id: string;
};

type EscalationIncidentRow = {
  acknowledgement_token: string;
  id: string;
  requires_acknowledgement: boolean;
  status: string;
  summary: string;
  title: string;
  workspace_id: string;
};

function boolValue(value: unknown) {
  return value === true || value === "true" || value === 1;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone,
    weekday: "long",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const hour = Number(values.hour) % 24;

  return {
    day: (values.weekday ?? "").toLowerCase(),
    minutes: hour * 60 + Number(values.minute ?? 0),
  };
}

function timeMinutes(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function inTimeWindow(minutes: number, start: number, end: number) {
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

function withinSchedule(
  schedule: BusinessHoursScheduleSettings,
  date: Date,
  timeZone: string,
) {
  const local = localDateParts(date, timeZone);
  const day = schedule.days.find((candidate) => candidate.day === local.day);
  const start = timeMinutes(day?.startTime);
  const end = timeMinutes(day?.endTime);

  return Boolean(
    day?.enabled &&
    start !== null &&
    end !== null &&
    inTimeWindow(local.minutes, start, end),
  );
}

function customHoursApply(settings: WorkspaceGeneralSettings, date: Date) {
  const escalation = settings.businessProfile.urgentEscalation;
  const local = localDateParts(date, settings.timeZone);
  const days = escalation.customDays.toLowerCase();
  const dayEnabled =
    days.includes("every day") ||
    days.includes(local.day) ||
    days.includes(local.day.slice(0, 3));
  const start = timeMinutes(escalation.customStartTime);
  const end = timeMinutes(escalation.customEndTime);

  return Boolean(
    dayEnabled &&
    start !== null &&
    end !== null &&
    inTimeWindow(local.minutes, start, end),
  );
}

function escalationHoursApply(settings: WorkspaceGeneralSettings, date: Date) {
  const mode = settings.businessProfile.urgentEscalation.hoursMode;
  const businessHours = withinSchedule(
    settings.businessProfile.workingHoursSchedule,
    date,
    settings.timeZone,
  );

  if (mode === "business_hours") {
    return businessHours;
  }

  if (mode === "after_hours") {
    return !businessHours;
  }

  if (mode === "custom") {
    return customHoursApply(settings, date);
  }

  return true;
}

export function detectUrgentEscalationTriggers(
  input: UrgentEscalationInput,
  options: { afterHours: boolean },
) {
  // Voice-call titles are generated by Kyro for display and must not be
  // interpreted as customer language when deciding whether a call is urgent.
  const classificationTitle =
    input.sourceType === "voice_call" ? "" : (input.title ?? "");
  const content =
    `${classificationTitle}\n${input.summary ?? ""}\n${input.content}`.toLowerCase();
  const triggers = new Set<UrgentEscalationTriggerKey>();

  if (
    input.priority === "urgent" ||
    /\b(urgent|emergency|asap|immediately|right now|same[- ]day critical)\b/.test(
      content,
    )
  ) {
    triggers.add("explicit_urgency");
  }

  if (
    /\b(burst pipe|flood|flooding|water (?:is )?(?:pouring|gushing)|roof leak|ceiling leak|active leak|property damage)\b/.test(
      content,
    )
  ) {
    triggers.add("active_property_damage");
  }

  if (
    /\b(gas leak|smell gas|electric shock|electrical danger|sparking|fire|smoke|injur(?:y|ed)|unsafe|collapse|live wire|carbon monoxide)\b/.test(
      content,
    )
  ) {
    triggers.add("safety_risk");
  }

  if (
    input.existingCustomer &&
    /\b(your work|previous job|last repair|failed again|came back|warranty|causing damage|made it worse)\b/.test(
      content,
    )
  ) {
    triggers.add("existing_job_serious_issue");
  }

  if (
    /\b(complaint|refund|lawyer|legal action|regulator|ombudsman|bad review|report you|unacceptable|furious)\b/.test(
      content,
    )
  ) {
    triggers.add("complaint_or_reputation_risk");
  }

  if (boolValue(input.metadata?.repeatContact)) {
    triggers.add("repeat_contact_short_window");
  }

  if (
    options.afterHours &&
    /\b(urgent|emergency|asap|burst|flood|leak|no power|no heating|no hot water|locked out)\b/.test(
      content,
    )
  ) {
    triggers.add("after_hours_emergency");
  }

  if (
    /\b(commercial (?:job|project|property|site)|insurance (?:claim|job|repair|work)|whole[- ]house (?:renovation|remodel)|full (?:home|house) (?:renovation|remodel)|emergency callout|large project)\b/.test(
      content,
    )
  ) {
    triggers.add("high_value_lead");
  }

  if (
    /\b(no (?:hot water|heating|power|electricity)|power outage|locked out|cannot access|vulnerable (?:person|customer))\b/.test(
      content,
    )
  ) {
    triggers.add("essential_service_outage");
  }

  if (input.vipCustomer) {
    triggers.add("vip_customer");
  }

  if (
    input.sourceType === "voice_call" &&
    input.existingCustomer &&
    boolValue(input.metadata?.missedOrVoicemail)
  ) {
    triggers.add("missed_known_customer_call");
  }

  if (
    /\b(speak to|talk to|call from) (?:the )?(?:owner|boss|manager|tradie)|owner (?:to )?call|boss (?:to )?call\b/.test(
      content,
    )
  ) {
    triggers.add("asks_for_owner_now");
  }

  return [...triggers];
}

async function ownerFallbackContact(
  supabase: SupabaseClient,
  settings: WorkspaceGeneralSettings,
  workspaceId: string,
) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();
  const ownerUserId = textValue(workspace?.owner_user_id);
  const owner = ownerUserId
    ? await supabase.auth.admin.getUserById(ownerUserId)
    : null;
  const metadata = owner?.data.user?.user_metadata ?? {};

  return {
    email:
      owner?.data.user?.email ?? settings.businessProfile.publicEmail ?? "",
    id: ownerUserId ?? "workspace-owner",
    name:
      textValue(metadata.name) ??
      textValue(metadata.full_name) ??
      "Workspace owner",
    phoneNumber:
      textValue(metadata.kyroMobileNumber) ??
      textValue(metadata.phone) ??
      settings.businessProfile.publicPhoneNumber,
    role: "Owner",
  };
}

function contactForStep(
  contacts: WorkplaceContactSettings[],
  contactId: string,
) {
  const eligible = contacts.filter((contact) => contact.receivesEscalations);
  const primary =
    contacts.find((contact) => contact.primaryEscalationContact) ??
    eligible[0] ??
    contacts[0];
  const fallback =
    eligible.find((contact) => contact.id !== primary?.id) ?? primary;

  if (contactId === "primary") {
    return primary;
  }

  if (contactId === "fallback") {
    return fallback;
  }

  return contacts.find((contact) => contact.id === contactId) ?? primary;
}

function contactSnapshot(
  contact: Partial<WorkplaceContactSettings> & { id?: string; name?: string },
  settings: WorkspaceGeneralSettings,
) {
  const rawPhone =
    textValue(contact.privatePhoneNumber) ?? textValue(contact.phoneNumber);

  return {
    email: textValue(contact.email),
    id: textValue(contact.id),
    name: textValue(contact.name) ?? "Escalation contact",
    phone: rawPhone
      ? (normalizeContactPhoneForRegion(
          rawPhone,
          settings.defaultPhoneRegion,
        ) ?? rawPhone)
      : null,
    role: textValue(contact.role),
  };
}

export async function createUrgentEscalationIncident(
  supabase: SupabaseClient,
  workspaceId: string,
  input: UrgentEscalationInput,
) {
  const settings = await getWorkspaceGeneralSettings(supabase, workspaceId);
  const policy = settings.businessProfile.urgentEscalation;
  const occurredAt = new Date(input.occurredAt ?? Date.now());

  if (!policy.enabled || !escalationHoursApply(settings, occurredAt)) {
    return { created: false, reason: "policy_inactive" } as const;
  }

  const businessHours = withinSchedule(
    settings.businessProfile.workingHoursSchedule,
    occurredAt,
    settings.timeZone,
  );
  const detected = detectUrgentEscalationTriggers(input, {
    afterHours: !businessHours,
  });
  const triggerKeys = detected.filter((key) =>
    policy.triggerKeys.includes(key),
  );

  if (triggerKeys.length === 0) {
    return { created: false, reason: "no_enabled_trigger" } as const;
  }

  const ownerFallback = await ownerFallbackContact(
    supabase,
    settings,
    workspaceId,
  );
  const sourceKey = input.sourceKey.slice(0, 400);
  const written = await writeEscalationAlert(supabase, workspaceId, {
    input,
    triggerKeys,
  });
  const { data: incident, error: incidentError } = await supabase
    .from("urgent_escalation_incidents")
    .insert({
      metadata: {
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        leadId: input.leadId ?? null,
        ...input.metadata,
      },
      occurred_at: occurredAt.toISOString(),
      policy_snapshot: policy,
      requires_acknowledgement: policy.requireAcknowledgement,
      source_id: input.sourceId ?? null,
      source_key: sourceKey,
      source_type: input.sourceType,
      summary: written.summary.slice(0, 1_500),
      title: written.title.slice(0, 240),
      trigger_keys: triggerKeys,
      workspace_id: workspaceId,
    })
    .select("id,acknowledgement_token")
    .single();

  if (incidentError) {
    if (incidentError.code === "23505") {
      const { data: existing } = await supabase
        .from("urgent_escalation_incidents")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", sourceKey)
        .maybeSingle();
      return {
        created: false,
        incidentId: existing?.id ? String(existing.id) : null,
        reason: "duplicate",
      } as const;
    }

    throw new Error(
      `Unable to create urgent escalation: ${incidentError.message}`,
    );
  }

  const steps = policy.steps.map((step, index) => {
    const configuredContact = contactForStep(
      settings.businessProfile.workplaceContacts,
      step.contactId,
    );
    const snapshot = contactSnapshot(
      configuredContact ?? ownerFallback,
      settings,
    );

    return {
      channel: step.channel,
      contact_id: snapshot.id,
      contact_snapshot: snapshot,
      due_at: new Date(
        occurredAt.getTime() + step.delayMinutes * 60_000,
      ).toISOString(),
      incident_id: incident.id,
      policy_step_id: step.id,
      position: index + 1,
      workspace_id: workspaceId,
    };
  });

  if (steps.length > 0) {
    const { error: stepsError } = await supabase
      .from("urgent_escalation_steps")
      .insert(steps);

    if (stepsError) {
      throw new Error(
        `Unable to schedule urgent escalation: ${stepsError.message}`,
      );
    }
  } else {
    await writeOrThrow(
      supabase
        .from("urgent_escalation_incidents")
        .update({ status: "exhausted" })
        .eq("id", incident.id),
      "Unable to mark the urgent escalation incident exhausted",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "system",
    action: "urgent_escalation.triggered",
    entityType: "urgent_escalation_incident",
    entityId: String(incident.id),
    after: { sourceKey, stepCount: steps.length, triggerKeys },
  });

  return {
    acknowledgementToken: String(incident.acknowledgement_token),
    created: true,
    incidentId: String(incident.id),
    triggerKeys,
  } as const;
}

function acknowledgementUrl(token: string) {
  return `${getPublicAppUrl()}/api/escalations/acknowledge?token=${encodeURIComponent(token)}`;
}

/**
 * The alert the owner actually reads.
 *
 * The block header and the acknowledge line are structure, so they stay in
 * code. What goes between them is a judgement the old version could not make:
 * every escalation used the constant title "Urgent customer inquiry" and pasted
 * the customer's raw message underneath, up to 1,500 characters -- roughly ten
 * SMS segments of unreadable wall. Sometimes the exact words are the point
 * ("get this car off my nature strip"); usually "Anne in Bendigo wants a
 * bathroom quote" is more use at a glance. Only the model can tell those apart,
 * so it writes the title and the body and decides which this is.
 */
/**
 * Replying is how you acknowledge this, so that is what it asks for.
 *
 * It used to lead with an acknowledgement link, which was the only thing that
 * actually stopped the chain -- and nobody taps a link while driving to a job.
 * A reply now settles the incident, so the link is a fallback for anyone who
 * would rather open it, not the instruction.
 */
function escalationMessage(incident: EscalationIncidentRow) {
  return [
    `URGENT - ${incident.title}`,
    incident.summary,
    "Reply here and I'll stop escalating this.",
    `Or open it: ${acknowledgementUrl(incident.acknowledgement_token)}`,
  ].join("\n");
}

async function escalationAlertContext(
  supabase: SupabaseClient,
  workspaceId: string,
  input: UrgentEscalationInput,
) {
  if (!input.contactId) {
    return null;
  }

  const { data } = await supabase
    .from("contacts")
    .select("name,company,address,contact_type")
    .eq("workspace_id", workspaceId)
    .eq("id", input.contactId)
    .maybeSingle();

  return data
    ? {
        contactAddress: textValue(data.address),
        contactCompany: textValue(data.company),
        contactName: textValue(data.name),
        contactType: textValue(data.contact_type),
      }
    : null;
}

async function writeEscalationAlert(
  supabase: SupabaseClient,
  workspaceId: string,
  context: { input: UrgentEscalationInput; triggerKeys: string[] },
) {
  const { input, triggerKeys } = context;
  // An explicit title or summary from the caller wins -- nothing overrides a
  // human who already said what this is.
  const explicitTitle = textValue(input.title);
  const explicitSummary = textValue(input.summary);

  if (explicitTitle && explicitSummary) {
    return { summary: explicitSummary, title: explicitTitle };
  }

  try {
    const contact = await escalationAlertContext(supabase, workspaceId, input);
    const written = await generateOperatorAlert({
      contextFacts: {
        ...contact,
        arrivedVia: input.sourceType,
        customerMessage: input.content,
        existingCustomer: input.existingCustomer ?? false,
        priority: input.priority ?? "normal",
        vipCustomer: input.vipCustomer ?? false,
        whyUrgent: triggerKeys,
      },
      purposeRules: [
        "This is an urgent alert about a customer message that needs the owner's attention now.",
        "The subject is a short label for the alert header, at most six words. It names the situation, not the customer's whole message.",
        "The body is one or two short lines. Say who it is and where they are when known, then what they want or what is wrong.",
        "Decide from context.customerMessage whether to quote the customer word for word or to summarise. Quote when the wording is the point; summarise a routine request.",
        "Keep the whole body under 300 characters. It is read on a phone as a text message.",
        "Do not add an acknowledgement link, a greeting, or a sign-off. Those are added around your text.",
      ],
      supabase,
      task: "Write the urgent escalation alert for the business owner.",
      taskType: "urgent_escalation_alert",
      userId: input.metadata?.userId ? String(input.metadata.userId) : "system",
      workspaceId,
    });

    return {
      summary: explicitSummary ?? written.body,
      title: explicitTitle ?? written.subject,
    };
  } catch (error) {
    // An urgent escalation must never be lost because the model was
    // unavailable. This last resort is labelled facts rather than written
    // prose, and it is the only path that reaches the owner unwritten.
    console.warn("Urgent escalation alert generation failed", {
      error: error instanceof Error ? error.message : "unknown_error",
      workspaceId,
    });

    return {
      summary: explicitSummary ?? input.content,
      title: explicitTitle ?? "Urgent customer inquiry",
    };
  }
}

async function sendEmailStep(
  incident: EscalationIncidentRow,
  contact: Record<string, unknown>,
) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const email = textValue(contact.email);

  if (!apiKey || !email) {
    throw new Error("Urgent escalation email recipient is not configured.");
  }

  const response = await fetchWithTimeout("https://api.resend.com/emails", {
    body: JSON.stringify({
      from:
        process.env.KYRO_ESCALATION_EMAIL_FROM?.trim() ||
        process.env.KYRO_AUTH_EMAIL_FROM?.trim() ||
        "Kyro <no-reply@mail.kyroassistant.com>",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px;margin:0 auto;padding:28px;"><p style="font-size:12px;font-weight:700;color:#dc2626;margin:0 0 8px;">URGENT ESCALATION</p><h1 style="font-size:22px;margin:0 0 14px;">${escapeHtml(incident.title)}</h1><p style="white-space:pre-wrap;">${escapeHtml(incident.summary)}</p><a href="${escapeHtml(acknowledgementUrl(incident.acknowledgement_token))}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px;font-weight:700;">Acknowledge</a></div>`,
      subject: `Urgent Kyro escalation: ${incident.title}`,
      text: escalationMessage(incident),
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    throw new Error(
      textValue(payload.message) ?? `Resend returned HTTP ${response.status}.`,
    );
  }

  return { messageId: textValue(payload.id), requestId: null };
}

async function sendSmsStep(
  supabase: SupabaseClient,
  incident: EscalationIncidentRow,
  contact: Record<string, unknown>,
) {
  const phone = textValue(contact.phone);

  if (!phone) {
    throw new Error("Urgent escalation SMS recipient is not configured.");
  }

  await recordSmsRecipientPreference(supabase, {
    consentNote: "Configured workplace urgent escalation contact.",
    phoneNumber: phone,
    source: "urgent_escalation",
    status: "staff_internal",
    touch: "outbound",
    workspaceId: incident.workspace_id,
  });
  await assertSmsSendAllowed(supabase, {
    phoneNumber: phone,
    workspaceId: incident.workspace_id,
  });
  const workspaceNumber = await getActiveWorkspaceSmsNumber(
    supabase,
    incident.workspace_id,
  );
  const from =
    workspaceNumber?.phoneNumber ??
    getTwilioConfig()?.defaultFromNumber ??
    null;
  // Same routing the inbound-inquiry alert uses. Without it this went out as a
  // plain SMS from the workspace number, so on a workspace running through the
  // WhatsApp sandbox the alerts arrived and the escalations did not -- one path
  // had been taught about the sandbox and this one had not.
  const result = await sendTwilioSmsMessage({
    body: escalationMessage(incident),
    from,
    to: phone,
    transport: twilioMessageTransportForWorkspace({
      recipientPhone: phone,
      workspaceId: incident.workspace_id,
    }),
  });
  const usage = telephonyUsageCost({
    direction: "outbound",
    kind: "sms",
    markupRate: await resolveWorkspaceUsageMarkupRate(
      supabase,
      incident.workspace_id,
      "TWILIO_MARKUP_RATE",
    ),
    providerPrice: result.price,
    providerCurrency: result.priceUnit,
  });

  // Billable, so a dropped insert is lost revenue -- the same silent path as
  // the AI and outbound usage writes. Reported rather than thrown: the SMS has
  // already gone out and failing here would not un-send it.
  const { error: usageError } = await supabase.from("usage_events").insert({
    cost_snapshot: String(usage.cost),
    currency: usage.currency,
    customer_charge_snapshot: String(usage.customerCharge),
    markup_snapshot: String(usage.markup),
    metadata: { incidentId: incident.id, source: "urgent_escalation" },
    provider: TWILIO_PROVIDER,
    provider_usage_id: result.messageId,
    quantity: "1",
    service: "sms",
    source_id: incident.id,
    source_type: "urgent_escalation_incident",
    unit: "message",
    unit_cost_snapshot: String(usage.cost),
    usage_type: "outbound_sms",
    workspace_id: incident.workspace_id,
  });

  if (usageError) {
    console.error(
      `Unable to record urgent escalation SMS usage for incident ${incident.id}: ${usageError.message}`,
    );
  }

  return { messageId: result.messageId, requestId: result.providerRequestId };
}

async function escalationVapiPhoneNumberId(
  supabase: SupabaseClient,
  workspaceId: string,
  fallback: string | null,
) {
  if (fallback) {
    return fallback;
  }

  const { data } = await supabase
    .from("workspace_phone_numbers")
    .select("provider_phone_number_id,metadata")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("assigned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const metadata =
    data?.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};

  return (
    textValue(metadata.vapiPhoneNumberId) ??
    textValue(data?.provider_phone_number_id)
  );
}

/**
 * The in-app notification step.
 *
 * There is no message to push out here: the step row *is* the notification.
 * `getNotificationSummary` selects escalation steps with channel
 * "app_notification" and status "sent" whose incident is still open, and
 * renders each one in the notification bell with a link that acknowledges it.
 * Recording the step as sent is what publishes it.
 *
 * That is a real delivery, not a fake one -- which is why this is not the
 * throwing branch. I previously mistook the null provider id for "nobody was
 * contacted" and made this channel fail, which took the bell's escalation
 * notifications with it. A provider id is absent because the app is the
 * provider, not because nothing happened.
 *
 * The half that does not exist yet is mobile push. The Expo client in the
 * kyro-mobile repo is where that belongs -- it needs to register a device
 * token before this side has anywhere to send one. Until then this reaches
 * the owner only while they have the web app open, which is why it sits at
 * delay 0 alongside email, with SMS and a phone call escalating behind it.
 */
function sendAppNotificationStep() {
  return { messageId: null, requestId: null };
}

async function sendPhoneStep(
  supabase: SupabaseClient,
  incident: EscalationIncidentRow,
  contact: Record<string, unknown>,
) {
  const phone = textValue(contact.phone);
  const settings = await getVoiceSettings(supabase, incident.workspace_id);
  const assistantId = settings.vapiOutboundAssistantId;
  const phoneNumberId = await escalationVapiPhoneNumberId(
    supabase,
    incident.workspace_id,
    settings.vapiPhoneNumberId,
  );

  if (!phone || !assistantId || !phoneNumberId) {
    throw new Error(
      "Urgent escalation phone delivery is not fully configured.",
    );
  }

  const message = escalationMessage(incident);
  const result = await createVapiOutboundCall({
    assistantId,
    assistantOverrides: {
      variableValues: {
        call_instructions: `This is an internal urgent escalation. Explain this clearly and ask the recipient to acknowledge it: ${message}`,
        kyro_context: message,
      },
    },
    customerNumber: phone,
    metadata: {
      direction: "outbound",
      incidentId: incident.id,
      purpose: "urgent_escalation",
      workspaceId: incident.workspace_id,
    },
    phoneNumberId,
  });

  return { messageId: result.id, requestId: null };
}

async function finishIncidentIfExhausted(
  supabase: SupabaseClient,
  incidentId: string,
) {
  const { data } = await supabase
    .from("urgent_escalation_steps")
    .select("status")
    .eq("incident_id", incidentId);
  const statuses = (data ?? []).map((row) => String(row.status));

  if (
    statuses.length > 0 &&
    statuses.every((status) =>
      ["sent", "failed", "skipped", "cancelled"].includes(status),
    )
  ) {
    await writeOrThrow(
      supabase
        .from("urgent_escalation_incidents")
        .update({ status: "exhausted" })
        .eq("id", incidentId)
        .eq("status", "open"),
      "Unable to mark the urgent escalation incident exhausted",
    );
  }
}

async function processClaimedStep(
  supabase: SupabaseClient,
  step: EscalationStepRow,
) {
  const { data, error } = await supabase
    .from("urgent_escalation_incidents")
    .select(
      "id,workspace_id,title,summary,status,requires_acknowledgement,acknowledgement_token",
    )
    .eq("id", step.incident_id)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `Unable to load escalation incident: ${error?.message ?? "not found"}`,
    );
  }

  const incident = data as EscalationIncidentRow;

  if (incident.status !== "open") {
    await writeOrThrow(
      supabase
        .from("urgent_escalation_steps")
        .update({ status: "cancelled" })
        .eq("id", step.id),
      "Unable to cancel the urgent escalation step",
    );
    return { cancelled: true, stepId: step.id };
  }

  const contact = step.contact_snapshot ?? {};
  const delivery =
    step.channel === "email"
      ? await sendEmailStep(incident, contact)
      : step.channel === "sms"
        ? await sendSmsStep(supabase, incident, contact)
        : step.channel === "phone"
          ? await sendPhoneStep(supabase, incident, contact)
          : step.channel === "app_notification"
            ? sendAppNotificationStep()
            : // Any channel with no delivery at all. Reporting "sent" for one of
              // those is worse than failing, because a failure hands on to the
              // next step while a false success quietly ends the chain.
              (() => {
                throw new Error(
                  `Escalation channel "${step.channel}" has no delivery method, so nobody was contacted.`,
                );
              })();

  await writeOrThrow(
    supabase
      .from("urgent_escalation_steps")
      .update({
        error: null,
        // Release the claim lease so a finished step is never reclaimed.
        lease_expires_at: null,
        provider_message_id: delivery.messageId,
        provider_request_id: delivery.requestId,
        sent_at: new Date().toISOString(),
        status: "sent",
      })
      .eq("id", step.id),
    "Unable to record urgent escalation step delivery",
  );
  await finishIncidentIfExhausted(supabase, step.incident_id);

  return { channel: step.channel, sent: true, stepId: step.id };
}

export async function processDueUrgentEscalations(
  supabase: SupabaseClient,
  options: { limit?: number } = {},
) {
  const { data, error } = await supabase.rpc(
    "claim_due_urgent_escalation_steps",
    { p_limit: Math.max(1, Math.min(options.limit ?? 50, 200)) },
  );

  if (error) {
    throw new Error(`Unable to claim urgent escalation work: ${error.message}`);
  }

  const results = [];

  for (const rawStep of (data ?? []) as EscalationStepRow[]) {
    try {
      results.push(await processClaimedStep(supabase, rawStep));
    } catch (stepError) {
      const terminal = rawStep.attempt_count >= rawStep.max_attempts;
      // Not thrown: the loop still has other steps to process, and stepError
      // below is the failure worth reporting. Losing this write would strand
      // the step holding its lease, which is what the lease expiry exists to
      // recover from -- but it should be visible when it happens.
      const { error: markStepError } = await supabase
        .from("urgent_escalation_steps")
        .update({
          due_at: terminal
            ? new Date().toISOString()
            : new Date(
                Date.now() +
                  Math.min(60, 5 * 2 ** rawStep.attempt_count) * 60_000,
              ).toISOString(),
          error:
            stepError instanceof Error
              ? stepError.message
              : "Urgent escalation delivery failed.",
          // Release the claim lease; the retry is scheduled by due_at above.
          lease_expires_at: null,
          status: terminal ? "failed" : "pending",
        })
        .eq("id", rawStep.id);

      if (markStepError) {
        console.error(
          `Unable to record urgent escalation step ${rawStep.id} failure, lease will expire instead: ${markStepError.message}`,
        );
      }
      await finishIncidentIfExhausted(supabase, rawStep.incident_id);
      results.push({
        error:
          stepError instanceof Error ? stepError.message : "Delivery failed.",
        sent: false,
        stepId: rawStep.id,
      });
    }
  }

  return results;
}

/**
 * Stop the chain once a human is engaged.
 *
 * Shared by both ways in: the acknowledgement link, and simply replying to the
 * message. Cancelling the pending steps is the whole point -- an acknowledged
 * incident that keeps phoning people is worse than one that never escalated.
 */
async function settleAcknowledgedIncident(
  supabase: SupabaseClient,
  incident: { id: unknown; title: unknown; workspace_id: unknown },
  input: { source: "reply" | "token"; userId?: string | null },
) {
  await writeOrThrow(
    supabase
      .from("urgent_escalation_steps")
      .update({ status: "cancelled" })
      .eq("incident_id", incident.id)
      .eq("status", "pending"),
    "Unable to cancel pending urgent escalation steps",
  );
  await insertAuditLog(supabase, {
    workspaceId: String(incident.workspace_id),
    actorType: input.userId ? "user" : "system",
    actorId: input.userId ?? undefined,
    action: "urgent_escalation.acknowledged",
    entityType: "urgent_escalation_incident",
    entityId: String(incident.id),
    after: { source: input.source, title: incident.title },
  });

  return {
    id: String(incident.id),
    title: String(incident.title),
    workspaceId: String(incident.workspace_id),
  };
}

export async function acknowledgeUrgentEscalation(
  supabase: SupabaseClient,
  input: { token: string; userId?: string | null },
) {
  const { data: incident, error } = await supabase
    .from("urgent_escalation_incidents")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_user_id: input.userId ?? null,
      status: "acknowledged",
    })
    .eq("acknowledgement_token", input.token)
    .eq("status", "open")
    .select("id,workspace_id,title")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to acknowledge escalation: ${error.message}`);
  }

  if (!incident) {
    return null;
  }

  return settleAcknowledgedIncident(supabase, incident, {
    source: "token",
    userId: input.userId,
  });
}

/** Last ten digits, so +1 505 555 0177 and 5055550177 are the same person. */
function samePhoneNumber(left: string | null | undefined, right: string) {
  const leftDigits = (left ?? "").replace(/\D/g, "").slice(-10);
  const rightDigits = right.replace(/\D/g, "").slice(-10);

  return Boolean(
    leftDigits &&
    rightDigits &&
    leftDigits.length >= 7 &&
    leftDigits === rightDigits,
  );
}

/**
 * How long after being escalated a reply still counts as acknowledgement.
 *
 * Long enough to cover a phone left in a pocket, short enough that tomorrow's
 * unrelated "morning" does not silently close last night's incident.
 */
const REPLY_ACKNOWLEDGEMENT_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Treat a reply from an escalated contact as acknowledgement.
 *
 * The escalation message used to carry a link, and tapping it was the only way
 * to stop the chain. Replying -- the obvious thing to do, and how every other
 * Kyro alert works -- did nothing, so the owner could answer in writing and
 * still get phoned about it minutes later.
 *
 * Any reply counts. The point is that a human is now engaged, not that they
 * have agreed to anything; requiring a particular word would be the same
 * mistake as telling people to text back "SEND IT".
 */
export async function acknowledgeEscalationFromReply(
  supabase: SupabaseClient,
  input: { phoneNumber: string; userId?: string | null; workspaceId: string },
) {
  const since = new Date(
    Date.now() - REPLY_ACKNOWLEDGEMENT_WINDOW_MS,
  ).toISOString();
  const { data, error } = await supabase
    .from("urgent_escalation_steps")
    .select("incident_id,contact_snapshot,sent_at")
    .eq("workspace_id", input.workspaceId)
    .eq("status", "sent")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(
      `Unable to look for an escalation to acknowledge: ${error.message}`,
    );
  }

  // Phone formats vary between what was configured and what Twilio reports, so
  // this compares digits rather than asking the database for an exact match.
  const match = (data ?? []).find((step) =>
    samePhoneNumber(
      textValue(objectRecord(step.contact_snapshot).phone),
      input.phoneNumber,
    ),
  );

  if (!match) {
    return null;
  }

  const { data: incident, error: incidentError } = await supabase
    .from("urgent_escalation_incidents")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_user_id: input.userId ?? null,
      status: "acknowledged",
    })
    .eq("id", match.incident_id)
    .eq("workspace_id", input.workspaceId)
    // Only an open incident. A second reply must not reopen or re-audit one
    // that is already settled.
    .eq("status", "open")
    .select("id,workspace_id,title")
    .maybeSingle();

  if (incidentError) {
    throw new Error(
      `Unable to acknowledge escalation from reply: ${incidentError.message}`,
    );
  }

  if (!incident) {
    return null;
  }

  return settleAcknowledgedIncident(supabase, incident, {
    source: "reply",
    userId: input.userId,
  });
}
