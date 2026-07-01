import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  elevenLabsVapiVoiceOverride,
  elevenLabsVoicePresetById,
  getVoiceSettings,
} from "../assistant/voice-settings";
import { buildVapiCurrentTimeContext } from "../assistant/vapi-time";
import {
  createVapiOutboundCall,
  deleteVapiCallData,
  VAPI_CARRIER_PROVIDER,
  VAPI_PROVIDER,
  VAPI_WEBHOOK_PATH,
  vapiEndpointUrl,
  vapiWebhookCredentialId,
} from "../integrations/vapi";
import {
  telephonyUsageCost,
  TWILIO_PROVIDER,
} from "../integrations/twilio";
import { insertAuditLog } from "../engine/event-action-audit";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import {
  DEFAULT_WORKSPACE_GENERAL_SETTINGS,
  getWorkspaceGeneralSettings,
} from "../workspace/general-settings";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import {
  vapiUserContextLine,
  vapiUserIdentityFromUser,
  vapiUserVariableValues,
  type VapiUserIdentity,
} from "../assistant/vapi-user-context";

export const VOICE_RECORDING_RETENTION_DAYS = 30;

export type VoiceCallDirection = "inbound" | "outbound";
export type VoiceCallPurpose =
  | "inbound_customer"
  | "inbound_user"
  | "outbound_customer"
  | "test"
  | "voicemail_overflow";
export type VoiceCallStatus =
  | "cancelled"
  | "completed"
  | "created"
  | "failed"
  | "in_progress"
  | "missed"
  | "queued"
  | "ringing";

export type VoiceCallPreview = {
  call: {
    carrierProvider: string;
    costCustomerAmount: number;
    costProviderAmount: number;
    createdAt: string;
    currency: string;
    customerNumber: string | null;
    direction: VoiceCallDirection;
    durationSeconds: number | null;
    endedAt: string | null;
    endedReason: string | null;
    fromNumber: string | null;
    id: string;
    provider: string;
    providerAssistantId: string | null;
    providerCallId: string | null;
    providerPhoneNumberId: string | null;
    purpose: VoiceCallPurpose;
    recordingDeletedAt: string | null;
    recordingExpiresAt: string | null;
    recordingRetentionDays: number;
    recordingUrl: string | null;
    startedAt: string | null;
    status: VoiceCallStatus;
    summary: string | null;
    toNumber: string | null;
    transcript: string | null;
    updatedAt: string;
  };
  contact: {
    address: string | null;
    company: string | null;
    contactType: string | null;
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  conversation: {
    id: string;
    lastMessageAt: string | null;
    status: string;
  } | null;
  events: Array<{
    createdAt: string;
    eventType: string;
    id: string;
  }>;
  lead: {
    id: string;
    status: string;
    title: string;
  } | null;
};

type WorkspacePhoneNumberMatch = {
  countryCode: string | null;
  id: string;
  metadata: Record<string, unknown>;
  normalizedPhone: string;
  phoneNumber: string;
  providerPhoneNumberId: string | null;
  region: string | null;
  workspaceId: string;
};

type OutboundVoiceNumberSelection = {
  countryCode: string | null;
  fromNumber: string | null;
  normalizedFromNumber: string | null;
  phoneNumberId: string;
  reason: string;
  region: string | null;
  workspacePhoneNumberId: string | null;
};

type VoiceCallAutomationTarget = {
  contactId: string | null;
  conversationId: string | null;
  direction: VoiceCallDirection;
  fromNumber: string | null;
  id: string | null;
  leadId: string | null;
  providerCallId: string | null;
  purpose: VoiceCallPurpose;
  summary: string | null;
  toNumber: string | null;
  transcript: string | null;
};

type PostCallTaskPlan = {
  description: string;
  dueAt: string | null;
  priority: "high" | "low" | "normal" | "urgent";
  taskType: string;
  title: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function remotelyReachableUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" && url.hostname !== "localhost"
      ? value
      : null;
  } catch {
    return null;
  }
}

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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((item) => objectRecord(item))
        .filter((item) => Object.keys(item).length > 0)
    : [];
}

function jsonRecord(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return objectRecord(value);
  }

  try {
    return objectRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value);

    if (text) {
      return text;
    }
  }

  return null;
}

function tableMissing(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("voice_calls") ||
    message.includes("voice_call_events") ||
    message.includes("does not exist")
  );
}

export function isVoiceCallTableMissing(
  error: { code?: string; message?: string } | null,
) {
  return tableMissing(error);
}

function normalizePhone(value: string | null) {
  return value ? normalizeContactPhoneForRegion(value, "AU") : null;
}

function statusFromEvent(value: string | null): VoiceCallStatus {
  const normalized = value?.toLowerCase().replace(/-/g, "_") ?? "";

  if (
    normalized.includes("ended") ||
    normalized.includes("completed") ||
    normalized.includes("hang")
  ) {
    return "completed";
  }

  if (normalized.includes("failed") || normalized.includes("error")) {
    return "failed";
  }

  if (normalized.includes("ring")) {
    return "ringing";
  }

  if (
    normalized.includes("started") ||
    normalized.includes("speech") ||
    normalized.includes("transcript") ||
    normalized.includes("in_progress")
  ) {
    return "in_progress";
  }

  if (normalized.includes("queued") || normalized.includes("created")) {
    return "queued";
  }

  if (normalized.includes("missed")) {
    return "missed";
  }

  if (normalized.includes("cancel")) {
    return "cancelled";
  }

  return "created";
}

function vapiMessage(payload: Record<string, unknown>) {
  return objectRecord(payload.message);
}

function vapiCall(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);

  return objectRecord(message.call ?? payload.call ?? payload);
}

function vapiArtifact(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);

  return objectRecord(message.artifact ?? payload.artifact);
}

function vapiAnalysis(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);

  return objectRecord(message.analysis ?? payload.analysis);
}

function providerCallId(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);
  const call = vapiCall(payload);

  return firstText(
    call.id,
    message.callId,
    payload.callId,
    payload.call_id,
    payload.id,
  );
}

function eventType(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);

  return (
    firstText(message.type, payload.type, payload.event, payload.eventType) ??
    "unknown"
  );
}

function callMetadata(payload: Record<string, unknown>) {
  const call = vapiCall(payload);

  return objectRecord(call.metadata ?? payload.metadata);
}

function callDirection(payload: Record<string, unknown>): VoiceCallDirection {
  const metadata = callMetadata(payload);
  const call = vapiCall(payload);
  const raw = `${firstText(
    metadata.direction,
    call.direction,
    call.type,
    payload.direction,
  ) ?? ""}`.toLowerCase();

  return raw.includes("out") ? "outbound" : "inbound";
}

function phoneNumbers(
  payload: Record<string, unknown>,
  direction: VoiceCallDirection,
) {
  const call = vapiCall(payload);
  const customer = objectRecord(call.customer);
  const phoneNumber = objectRecord(call.phoneNumber);
  const providerDetails = objectRecord(
    call.phoneCallProviderDetails ?? call.providerDetails,
  );
  const providerFrom = firstText(
    providerDetails.from,
    call.from,
    call.fromNumber,
    payload.from,
    payload.fromNumber,
  );
  const providerTo = firstText(
    providerDetails.to,
    call.to,
    call.toNumber,
    payload.to,
    payload.toNumber,
  );
  const customerNumber = firstText(customer.number);
  const kyroNumber = firstText(phoneNumber.number);
  const from =
    direction === "outbound"
      ? (providerFrom ?? kyroNumber)
      : (customerNumber ?? providerFrom);
  const to =
    direction === "outbound"
      ? (customerNumber ?? providerTo)
      : (kyroNumber ?? providerTo);

  return { from, to };
}

function callPurpose(
  payload: Record<string, unknown>,
  input: {
    direction: VoiceCallDirection;
    fromNumber: string | null;
    matchedWorkspaceNumber?: WorkspacePhoneNumberMatch | null;
    userNumbers: string[];
  },
): VoiceCallPurpose {
  const metadata = callMetadata(payload);
  const explicitPurpose = textValue(metadata.purpose ?? payload.purpose);

  if (
    explicitPurpose === "inbound_customer" ||
    explicitPurpose === "inbound_user" ||
    explicitPurpose === "outbound_customer" ||
    explicitPurpose === "test" ||
    explicitPurpose === "voicemail_overflow"
  ) {
    return explicitPurpose;
  }

  if (input.direction === "outbound") {
    return "outbound_customer";
  }

  const normalizedFrom = normalizePhone(input.fromNumber);
  const normalizedUserNumbers = input.userNumbers
    .map((number) => normalizePhone(number))
    .filter((number): number is string => Boolean(number));

  if (normalizedFrom && normalizedUserNumbers.includes(normalizedFrom)) {
    return "inbound_user";
  }

  const numberMetadata = objectRecord(input.matchedWorkspaceNumber?.metadata);
  const numberPurpose = textValue(
    numberMetadata.voicePurpose ?? numberMetadata.purpose,
  );

  if (numberPurpose === "voicemail_overflow") {
    return "voicemail_overflow";
  }

  return "inbound_customer";
}

function callSummary(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);
  const analysis = vapiAnalysis(payload);

  return firstText(
    message.summary,
    payload.summary,
    analysis.summary,
    analysis.callSummary,
  );
}

function callTranscript(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);
  const artifact = vapiArtifact(payload);

  return firstText(
    message.transcript,
    payload.transcript,
    artifact.transcript,
  );
}

function callRecordingUrl(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);
  const artifact = vapiArtifact(payload);

  return firstText(
    message.recordingUrl,
    payload.recordingUrl,
    artifact.recordingUrl,
    artifact.stereoRecordingUrl,
  );
}

function providerAssistantId(payload: Record<string, unknown>) {
  const call = vapiCall(payload);
  const assistant = objectRecord(call.assistant);

  return firstText(call.assistantId, assistant.id, payload.assistantId);
}

function providerPhoneNumberId(payload: Record<string, unknown>) {
  const call = vapiCall(payload);
  const phoneNumber = objectRecord(call.phoneNumber);

  return firstText(call.phoneNumberId, phoneNumber.id, payload.phoneNumberId);
}

function timestampValue(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value);

    if (text && !Number.isNaN(new Date(text).getTime())) {
      return text;
    }
  }

  return null;
}

function callTiming(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);
  const call = vapiCall(payload);

  return {
    endedAt: timestampValue(
      message.endedAt,
      message.endTime,
      call.endedAt,
      call.ended_at,
      call.endedAt,
      payload.endedAt,
      payload.endTime,
    ),
    startedAt: timestampValue(
      message.startedAt,
      message.startTime,
      call.startedAt,
      call.started_at,
      call.createdAt,
      payload.startedAt,
      payload.startTime,
    ),
  };
}

function durationSeconds(payload: Record<string, unknown>) {
  const message = vapiMessage(payload);
  const call = vapiCall(payload);
  const duration =
    numberValue(message.durationSeconds) ??
    numberValue(call.durationSeconds) ??
    numberValue(payload.durationSeconds) ??
    numberValue(message.duration) ??
    numberValue(payload.duration);

  if (duration === null) {
    return null;
  }

  return duration > 1000 ? Math.round(duration / 1000) : Math.round(duration);
}

function callCost(payload: Record<string, unknown>, markupRate?: number | null) {
  const message = vapiMessage(payload);
  const call = vapiCall(payload);
  const cost =
    numberValue(message.cost) ??
    numberValue(call.cost) ??
    numberValue(payload.cost);
  const usage = telephonyUsageCost({
    direction: callDirection(payload),
    kind: "voice_call",
    markupRate,
    providerPrice: cost,
  });

  return {
    currency: usage.currency,
    customerCharge: usage.customerCharge,
    providerCost: usage.cost,
  };
}

async function workspaceOwnerId(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load workspace owner: ${error.message}`);
  }

  return textValue(data?.owner_user_id);
}

function addDaysIso(value: string | null, days: number) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString();
}

function recordingExpiryFromTiming(input: {
  createdAt?: string | null;
  endedAt?: string | null;
  startedAt?: string | null;
}) {
  return addDaysIso(
    timestampValue(input.endedAt, input.startedAt, input.createdAt) ??
      new Date().toISOString(),
    VOICE_RECORDING_RETENTION_DAYS,
  );
}

function validTimestamp(value: unknown) {
  const text = textValue(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addHoursIso(startIso: string, hours: number) {
  const date = new Date(startIso);
  date.setHours(date.getHours() + hours);

  return date.toISOString();
}

function normalizedPriority(value: unknown, note: string) {
  const explicit = textValue(value)?.toLowerCase();

  if (
    explicit === "low" ||
    explicit === "normal" ||
    explicit === "high" ||
    explicit === "urgent"
  ) {
    return explicit satisfies PostCallTaskPlan["priority"];
  }

  const lower = note.toLowerCase();

  if (/\b(emergency|urgent|asap|danger|unsafe|flood|burst|gas leak)\b/.test(lower)) {
    return "urgent";
  }

  if (/\b(complaint|angry|unhappy|refund|escalate|same day)\b/.test(lower)) {
    return "high";
  }

  return "normal";
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "yes", "y", "1"].includes(normalized)) {
      return true;
    }

    if (["false", "no", "n", "0"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function compactText(value: string | null, maxLength = 220) {
  const clean = value?.replace(/\s+/g, " ").trim();

  if (!clean) {
    return null;
  }

  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

function statusDetailFromCall(input: {
  endedReason: string | null;
  recordingUrl: string | null;
  status: VoiceCallStatus;
  summary: string | null;
  transcript: string | null;
}) {
  const hasTranscript = Boolean(input.transcript);
  const hasSummary = Boolean(input.summary);
  const failed = input.status === "failed" || input.status === "missed";
  const partial =
    failed ||
    (input.status === "completed" && !hasTranscript && !hasSummary);

  return {
    endedReason: input.endedReason,
    hasRecording: Boolean(input.recordingUrl),
    hasSummary,
    hasTranscript,
    needsReview: partial,
    partial,
    status: input.status,
  };
}

function assistantSelectionFromMetadata(
  metadata: Record<string, unknown>,
  reportedAssistantId: string | null,
) {
  const rawSelection = objectRecord(metadata.assistantSelection);
  const selectedAssistantId =
    textValue(rawSelection.selectedAssistantId) ??
    textValue(metadata.selectedAssistantId);
  const purpose =
    textValue(rawSelection.purpose) ?? textValue(metadata.purpose);
  const expectedVoicemailAssistantId = textValue(
    rawSelection.expectedVoicemailAssistantId,
  );
  const proofStatus =
    purpose === "voicemail_overflow" &&
    expectedVoicemailAssistantId &&
    reportedAssistantId
      ? reportedAssistantId === expectedVoicemailAssistantId
        ? "reported_assistant_matched"
        : "reported_assistant_mismatch"
      : textValue(rawSelection.proofStatus) ??
        (reportedAssistantId && selectedAssistantId
          ? reportedAssistantId === selectedAssistantId
            ? "reported_assistant_matched"
            : "reported_assistant_mismatch"
          : "awaiting_reported_assistant");

  return {
    ...rawSelection,
    expectedVoicemailAssistantId,
    proofStatus,
    purpose,
    reportedAssistantId,
    selectedAssistantId,
  };
}

function voiceCallSubject(call: VoiceCallAutomationTarget) {
  const party =
    call.direction === "outbound"
      ? (call.toNumber ?? call.fromNumber)
      : (call.fromNumber ?? call.toNumber);

  if (call.purpose === "voicemail_overflow") {
    return party ? `Voicemail overflow from ${party}` : "Voicemail overflow";
  }

  return party ? `Phone call with ${party}` : "Phone call";
}

function taskPlanFromCallNote(input: {
  args: Record<string, unknown>;
  call: VoiceCallAutomationTarget | null;
  note: string;
  priority: PostCallTaskPlan["priority"];
}) {
  const args = input.args;
  const note = input.note;
  const lower = note.toLowerCase();
  const explicitTaskTitle = textValue(args.taskTitle ?? args.title);
  const explicitTaskType = textValue(args.taskType);
  const explicitDueAt = validTimestamp(
    args.dueAt ?? args.followUpAt ?? args.callbackAt ?? args.bookingAt,
  );
  const createTask =
    booleanValue(args.createTask) ??
    Boolean(
      explicitTaskTitle ||
        textValue(args.taskDescription ?? args.description) ||
        explicitDueAt,
    );
  const callbackRequested =
    booleanValue(args.callbackRequested) ??
    /\b(call back|callback|return call|ring back|phone back)\b/.test(lower);
  const quoteFollowUp =
    booleanValue(args.quoteRequested) ??
    /\b(quote|estimate|price|pricing|invoice)\b/.test(lower);
  const bookingFollowUp =
    booleanValue(args.bookingRequested) ??
    /\b(book|booking|schedule|appointment|site visit|come out|come around)\b/.test(
      lower,
    );
  const complaintFollowUp =
    booleanValue(args.complaint) ??
    /\b(complaint|unhappy|angry|refund|bad service|escalate)\b/.test(lower);
  const voicemailReview =
    input.call?.purpose === "voicemail_overflow" && Boolean(compactText(note));
  const shouldCreateTask =
    createTask ||
    callbackRequested ||
    quoteFollowUp ||
    bookingFollowUp ||
    complaintFollowUp ||
    voicemailReview ||
    input.priority === "urgent";

  if (!shouldCreateTask) {
    return null;
  }

  const taskType =
    explicitTaskType ??
    (complaintFollowUp
        ? "call_complaint_follow_up"
        : callbackRequested
          ? "call_callback"
          : quoteFollowUp
            ? "call_quote_follow_up"
            : bookingFollowUp
              ? "call_booking_follow_up"
              : voicemailReview
                ? "voicemail_overflow_review"
                : "call_follow_up");
  const title =
    explicitTaskTitle ??
    (complaintFollowUp
      ? "Review call complaint"
      : callbackRequested
        ? "Call customer back"
        : quoteFollowUp
          ? "Prepare quote follow-up"
          : bookingFollowUp
            ? "Arrange booking or site visit"
            : input.priority === "urgent"
              ? "Review urgent call"
              : voicemailReview
                ? "Review voicemail overflow call"
                : "Follow up from phone call");
  const description =
    textValue(args.taskDescription ?? args.description) ??
    compactText(note, 500) ??
    "Review the phone call outcome.";
  const dueAt =
    explicitDueAt ??
    (input.priority === "urgent"
      ? addHoursIso(new Date().toISOString(), 1)
      : callbackRequested || complaintFollowUp
        ? addHoursIso(new Date().toISOString(), 4)
        : voicemailReview
          ? addHoursIso(new Date().toISOString(), 4)
        : null);

  return {
    description,
    dueAt,
    priority: input.priority,
    taskType,
    title,
  } satisfies PostCallTaskPlan;
}

function fallbackVoiceCallAutomationTarget(input: {
  args: Record<string, unknown>;
  payload: Record<string, unknown>;
  providerCallId?: string | null;
}) {
  const metadata = callMetadata(input.payload);
  const direction = callDirection(input.payload);
  const { from, to } = phoneNumbers(input.payload, direction);
  const explicitPurpose = textValue(metadata.purpose ?? input.args.purpose);
  const purpose =
    explicitPurpose === "inbound_customer" ||
    explicitPurpose === "inbound_user" ||
    explicitPurpose === "outbound_customer" ||
    explicitPurpose === "test" ||
    explicitPurpose === "voicemail_overflow"
      ? explicitPurpose
      : direction === "outbound"
        ? "outbound_customer"
        : "inbound_customer";

  return {
    contactId: textValue(input.args.contactId ?? metadata.contactId),
    conversationId: textValue(input.args.conversationId ?? metadata.conversationId),
    direction,
    fromNumber: from ?? textValue(metadata.callerNumber),
    id: null,
    leadId: textValue(input.args.leadId ?? metadata.leadId),
    providerCallId: input.providerCallId ?? providerCallId(input.payload),
    purpose,
    summary: null,
    toNumber: to ?? textValue(metadata.kyroNumber),
    transcript: null,
  } satisfies VoiceCallAutomationTarget;
}

async function workspaceName(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load workspace name: ${error.message}`);
  }

  return textValue(data?.name);
}

async function findWorkspaceVoiceNumber(
  supabase: SupabaseClient,
  rawNumber: string | null,
) {
  const normalized = normalizePhone(rawNumber);

  if (!normalized) {
    return null;
  }

  const { data, error } = await supabase
    .from("workspace_phone_numbers")
    .select(
      "id,workspace_id,phone_number,normalized_phone,provider_phone_number_id,country_code,region,metadata,capabilities,status",
    )
    .eq("provider", TWILIO_PROVIDER)
    .eq("normalized_phone", normalized)
    .in("status", ["active", "pending"])
    .limit(1)
    .maybeSingle();

  if (error) {
    if (tableMissing(error)) {
      return null;
    }

    throw new Error(`Unable to match voice phone number: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const capabilities = objectRecord(data.capabilities);

  if (capabilities.voice === false) {
    return null;
  }

  return {
    countryCode: textValue(data.country_code),
    id: String(data.id),
    metadata: objectRecord(data.metadata),
    normalizedPhone: String(data.normalized_phone),
    phoneNumber: String(data.phone_number),
    providerPhoneNumberId: textValue(data.provider_phone_number_id),
    region: textValue(data.region),
    workspaceId: String(data.workspace_id),
  } satisfies WorkspacePhoneNumberMatch;
}

function countryCodeFromPhoneNumber(normalizedPhone: string | null) {
  if (!normalizedPhone) {
    return null;
  }

  const prefixMap: Array<[string, string]> = [
    ["+61", "AU"],
    ["+1", "US"],
    ["+44", "GB"],
    ["+64", "NZ"],
    ["+353", "IE"],
    ["+65", "SG"],
    ["+91", "IN"],
    ["+63", "PH"],
    ["+27", "ZA"],
    ["+971", "AE"],
    ["+86", "CN"],
    ["+852", "HK"],
    ["+60", "MY"],
  ];
  const match = prefixMap.find(([prefix]) =>
    normalizedPhone.startsWith(prefix),
  );

  return match?.[1] ?? null;
}

function workspaceNumberCountry(row: {
  countryCode?: string | null;
  metadata?: Record<string, unknown>;
  normalizedPhone?: string | null;
}) {
  const metadata = objectRecord(row.metadata);
  const raw =
    textValue(row.countryCode) ??
    textValue(metadata.countryCode) ??
    textValue(metadata.country_code) ??
    countryCodeFromPhoneNumber(row.normalizedPhone ?? null);

  return raw?.toUpperCase() ?? null;
}

function workspaceNumberVapiPhoneNumberId(row: {
  metadata?: Record<string, unknown>;
}) {
  const metadata = objectRecord(row.metadata);
  const vapi = objectRecord(metadata.vapi);

  return firstText(
    metadata.vapiPhoneNumberId,
    metadata.vapi_phone_number_id,
    metadata.vapiNumberId,
    metadata.vapi_number_id,
    vapi.phoneNumberId,
    vapi.phone_number_id,
    vapi.numberId,
  );
}

async function loadWorkspaceOutboundVoiceNumbers(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Array<Omit<OutboundVoiceNumberSelection, "reason">>> {
  const { data, error } = await supabase
    .from("workspace_phone_numbers")
    .select(
      "id,workspace_id,phone_number,normalized_phone,provider_phone_number_id,country_code,region,metadata,capabilities,status,created_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", TWILIO_PROVIDER)
    .in("status", ["active", "pending"])
    .order("created_at", { ascending: true });

  if (error) {
    if (tableMissing(error)) {
      return [];
    }

    throw new Error(`Unable to load workspace voice numbers: ${error.message}`);
  }

  const numbers: Array<Omit<OutboundVoiceNumberSelection, "reason">> = [];

  for (const row of data ?? []) {
    const capabilities = objectRecord(row.capabilities);

    if (capabilities.voice === false) {
      continue;
    }

    const metadata = objectRecord(row.metadata);
    const normalizedPhone = textValue(row.normalized_phone);
    const countryCode = workspaceNumberCountry({
      countryCode: textValue(row.country_code),
      metadata,
      normalizedPhone,
    });
    const vapiPhoneNumberId = workspaceNumberVapiPhoneNumberId({ metadata });

    if (!vapiPhoneNumberId) {
      continue;
    }

    numbers.push({
      countryCode,
      fromNumber: textValue(row.phone_number),
      normalizedFromNumber: normalizedPhone,
      phoneNumberId: vapiPhoneNumberId,
      region: textValue(row.region),
      workspacePhoneNumberId: String(row.id),
    });
  }

  return numbers;
}

async function selectOutboundVapiPhoneNumber(input: {
  customerNumber: string;
  fallbackPhoneNumberId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<OutboundVoiceNumberSelection | null> {
  const numbers = await loadWorkspaceOutboundVoiceNumbers(
    input.supabase,
    input.workspaceId,
  );
  const destinationCountry = countryCodeFromPhoneNumber(input.customerNumber);

  if (destinationCountry) {
    const regionalMatch = numbers.find(
      (number) => number.countryCode === destinationCountry,
    );

    if (regionalMatch) {
      return {
        ...regionalMatch,
        reason: `Matched destination country ${destinationCountry}.`,
      };
    }
  }

  const firstWorkspaceNumber = numbers[0];

  if (firstWorkspaceNumber) {
    return {
      ...firstWorkspaceNumber,
      reason: destinationCountry
        ? `No ${destinationCountry} number found; using first active workspace voice number.`
        : "No destination country inferred; using first active workspace voice number.",
    };
  }

  if (input.fallbackPhoneNumberId) {
    return {
      countryCode: null,
      fromNumber: null,
      normalizedFromNumber: null,
      phoneNumberId: input.fallbackPhoneNumberId,
      reason: "Using voice settings Vapi phone number fallback.",
      region: null,
      workspacePhoneNumberId: null,
    };
  }

  return null;
}

async function findContactByPhone(
  supabase: SupabaseClient,
  workspaceId: string,
  rawNumber: string | null,
) {
  const normalized = normalizePhone(rawNumber);

  if (!normalized) {
    return null;
  }

  const { data, error } = await supabase
    .from("contacts")
    .select("id,name,company,email,phone,address,contact_type")
    .eq("workspace_id", workspaceId)
    .eq("normalized_phone", normalized)
    .is("merged_into_contact_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to match voice contact: ${error.message}`);
  }

  return data
    ? {
        address: textValue(data.address),
        company: textValue(data.company),
        contactType: textValue(data.contact_type),
        email: textValue(data.email),
        id: String(data.id),
        name: textValue(data.name),
        phone: textValue(data.phone),
      }
    : null;
}

async function lookupLinkedRows(
  supabase: SupabaseClient,
  workspaceId: string,
  input: {
    contactId: string | null;
    conversationId: string | null;
    leadId: string | null;
  },
) {
  const [contactResult, conversationResult, leadResult] = await Promise.all([
    input.contactId
      ? supabase
          .from("contacts")
          .select("id,name,company,email,phone,address,contact_type")
          .eq("workspace_id", workspaceId)
          .eq("id", input.contactId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.conversationId
      ? supabase
          .from("conversations")
          .select("id,status,last_message_at")
          .eq("workspace_id", workspaceId)
          .eq("id", input.conversationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.leadId
      ? supabase
          .from("leads")
          .select("id,title,status")
          .eq("workspace_id", workspaceId)
          .eq("id", input.leadId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (contactResult.error) {
    throw new Error(`Unable to load voice contact: ${contactResult.error.message}`);
  }

  if (conversationResult.error) {
    throw new Error(
      `Unable to load voice conversation: ${conversationResult.error.message}`,
    );
  }

  if (leadResult.error) {
    throw new Error(`Unable to load voice lead: ${leadResult.error.message}`);
  }

  return {
    contact: contactResult.data
      ? {
          address: textValue(contactResult.data.address),
          company: textValue(contactResult.data.company),
          contactType: textValue(contactResult.data.contact_type),
          email: textValue(contactResult.data.email),
          id: String(contactResult.data.id),
          name: textValue(contactResult.data.name),
          phone: textValue(contactResult.data.phone),
        }
      : null,
    conversation: conversationResult.data
      ? {
          id: String(conversationResult.data.id),
          lastMessageAt: textValue(conversationResult.data.last_message_at),
          status: String(conversationResult.data.status),
        }
      : null,
    lead: leadResult.data
      ? {
          id: String(leadResult.data.id),
          status: String(leadResult.data.status),
          title: String(leadResult.data.title),
        }
      : null,
  };
}

function compactOutboundCallContext(input: {
  assistantContextSummary?: string | null;
  contact: Awaited<ReturnType<typeof lookupLinkedRows>>["contact"];
  conversation: Awaited<ReturnType<typeof lookupLinkedRows>>["conversation"];
  customerNumber: string;
  instructions: string | null;
  lead: Awaited<ReturnType<typeof lookupLinkedRows>>["lead"];
  recentOutboundCallContext?: string | null;
  userIdentity: VapiUserIdentity;
  workspaceName: string | null;
}) {
  const lines = [
    input.workspaceName ? `Workspace: ${input.workspaceName}` : null,
    `${vapiUserContextLine(input.userIdentity, "Kyro account user")} Use this for internal attribution, routing, and escalation; do not read private account-user email or phone details to the customer unless the user's call instruction explicitly says to share them.`,
    `Customer phone: ${input.customerNumber}`,
    input.contact
      ? `Contact: ${[
          input.contact.name,
          input.contact.company,
          input.contact.email,
          input.contact.phone,
          input.contact.address,
        ]
          .filter(Boolean)
          .join(" | ")}`
      : null,
    input.lead
      ? `Lead: ${input.lead.title} | Status: ${input.lead.status}`
      : null,
    input.conversation
      ? `Conversation: ${input.conversation.status}${
          input.conversation.lastMessageAt
            ? ` | Last message: ${input.conversation.lastMessageAt}`
            : ""
        }`
      : null,
    input.assistantContextSummary
      ? `Recent Assistant context:\n${input.assistantContextSummary}`
      : null,
    input.recentOutboundCallContext
      ? `Recent outbound call context:\n${input.recentOutboundCallContext}`
      : null,
    input.instructions ? `User instruction: ${input.instructions}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function compactCallContextValue(value: unknown, maxLength = 900) {
  const clean = textValue(value)?.replace(/\s+/g, " ").trim();

  if (!clean) {
    return null;
  }

  return clean.length > maxLength
    ? `${clean.slice(0, maxLength - 1)}...`
    : clean;
}

async function recentOutboundCallContextForCustomer(input: {
  contactId?: string | null;
  customerNumber: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const query = input.contactId
    ? input.supabase
        .from("voice_calls")
        .select("created_at,status,summary,metadata")
        .eq("workspace_id", input.workspaceId)
        .eq("direction", "outbound")
        .eq("contact_id", input.contactId)
        .order("created_at", { ascending: false })
        .limit(3)
    : input.supabase
        .from("voice_calls")
        .select("created_at,status,summary,metadata")
        .eq("workspace_id", input.workspaceId)
        .eq("direction", "outbound")
        .eq("normalized_to_number", input.customerNumber)
        .order("created_at", { ascending: false })
        .limit(3);
  const { data, error } = await query;

  if (error) {
    if (tableMissing(error)) {
      return null;
    }

    throw new Error(`Unable to load recent outbound call context: ${error.message}`);
  }

  const lines = ((data ?? []) as Record<string, unknown>[])
    .map((row, index) => {
      const metadata = objectRecord(row.metadata);
      const pieces = [
        `Previous outbound call ${index + 1}`,
        textValue(row.created_at) ? `created ${String(row.created_at)}` : null,
        textValue(row.status) ? `status ${String(row.status)}` : null,
        compactCallContextValue(metadata.instructions)
          ? `instruction: ${compactCallContextValue(metadata.instructions)}`
          : null,
        compactCallContextValue(row.summary)
          ? `summary: ${compactCallContextValue(row.summary)}`
          : null,
        compactCallContextValue(metadata.outboundCallContext, 700)
          ? `context: ${compactCallContextValue(metadata.outboundCallContext, 700)}`
          : null,
      ].filter((value): value is string => Boolean(value));

      return pieces.join(" | ");
    })
    .filter((line) => line.trim());

  return lines.length > 0 ? lines.join("\n") : null;
}

function rowToPreviewCall(row: Record<string, unknown>) {
  return {
    carrierProvider: textValue(row.carrier_provider) ?? VAPI_CARRIER_PROVIDER,
    costCustomerAmount: numberValue(row.cost_customer_amount) ?? 0,
    costProviderAmount: numberValue(row.cost_provider_amount) ?? 0,
    createdAt: String(row.created_at),
    currency: textValue(row.currency) ?? "USD",
    customerNumber: textValue(row.customer_number),
    direction:
      row.direction === "outbound" ? "outbound" : ("inbound" as VoiceCallDirection),
    durationSeconds: numberValue(row.duration_seconds),
    endedAt: textValue(row.ended_at),
    endedReason: textValue(row.ended_reason),
    fromNumber: textValue(row.from_number),
    id: String(row.id),
    provider: textValue(row.provider) ?? VAPI_PROVIDER,
    providerAssistantId: textValue(row.provider_assistant_id),
    providerCallId: textValue(row.provider_call_id),
    providerPhoneNumberId: textValue(row.provider_phone_number_id),
    purpose: (textValue(row.purpose) ?? "inbound_customer") as VoiceCallPurpose,
    recordingDeletedAt: textValue(row.recording_deleted_at),
    recordingExpiresAt: textValue(row.recording_expires_at),
    recordingRetentionDays:
      numberValue(row.recording_retention_days) ?? VOICE_RECORDING_RETENTION_DAYS,
    recordingUrl: textValue(row.recording_url),
    startedAt: textValue(row.started_at),
    status: (textValue(row.status) ?? "created") as VoiceCallStatus,
    summary: textValue(row.summary),
    toNumber: textValue(row.to_number),
    transcript: textValue(row.transcript),
    updatedAt: String(row.updated_at),
  } satisfies VoiceCallPreview["call"];
}

export async function getVoiceCallPreview(
  supabase: SupabaseClient,
  workspaceId: string,
  callId: string,
): Promise<VoiceCallPreview | null> {
  const { data: row, error } = await supabase
    .from("voice_calls")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", callId)
    .maybeSingle();

  if (error) {
    if (tableMissing(error)) {
      return null;
    }

    throw new Error(`Unable to load voice call: ${error.message}`);
  }

  if (!row) {
    return null;
  }

  const [linkedRows, eventsResult] = await Promise.all([
    lookupLinkedRows(supabase, workspaceId, {
      contactId: textValue(row.contact_id),
      conversationId: textValue(row.conversation_id),
      leadId: textValue(row.lead_id),
    }),
    supabase
      .from("voice_call_events")
      .select("id,event_type,created_at")
      .eq("workspace_id", workspaceId)
      .eq("voice_call_id", row.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (eventsResult.error && !tableMissing(eventsResult.error)) {
    throw new Error(
      `Unable to load voice call events: ${eventsResult.error.message}`,
    );
  }

  return {
    call: rowToPreviewCall(row as Record<string, unknown>),
    contact: linkedRows.contact,
    conversation: linkedRows.conversation,
    events: eventsResult.error
      ? []
      : ((eventsResult.data ?? []) as Record<string, unknown>[]).map((event) => ({
          createdAt: String(event.created_at),
          eventType: String(event.event_type),
          id: String(event.id),
        })),
    lead: linkedRows.lead,
  };
}

export async function getRecentVoiceCallsForActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 12,
) {
  const { data, error } = await supabase
    .from("voice_calls")
    .select(
      "id,direction,purpose,status,from_number,to_number,customer_number,created_at,started_at,ended_at,summary,transcript,ended_reason,contact_id,lead_id,provider,provider_assistant_id,metadata",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (tableMissing(error)) {
      return [];
    }

    throw new Error(`Unable to load recent voice calls: ${error.message}`);
  }

  return (data ?? []) as Record<string, unknown>[];
}

async function recordVoiceCallUsageIfNeeded(
  supabase: SupabaseClient,
  input: {
    callId: string;
    durationSeconds: number | null;
    providerCallId: string | null;
    providerCost: number;
    customerCharge: number;
    currency: string;
    workspaceId: string;
  },
) {
  if (!input.providerCallId && input.providerCost <= 0 && !input.durationSeconds) {
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("usage_events")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("source_type", "voice_call")
    .eq("source_id", input.callId)
    .eq("usage_type", "voice_call")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to check voice call usage: ${existingError.message}`);
  }

  if (existing) {
    return;
  }

  const quantity = Math.max(1, Math.ceil((input.durationSeconds ?? 0) / 60));
  const unitCost = input.providerCost / quantity;
  const markup =
    input.providerCost > 0
      ? input.customerCharge / Math.max(input.providerCost, 0.000001) - 1
      : 0;

  await supabase.from("usage_events").insert({
    workspace_id: input.workspaceId,
    user_id: null,
    source_type: "voice_call",
    source_id: input.callId,
    provider: VAPI_PROVIDER,
    service: "voice_call",
    model: null,
    usage_type: "voice_call",
    quantity: String(quantity),
    unit: "minute",
    unit_cost_snapshot: String(unitCost),
    markup_snapshot: String(Math.max(0, markup)),
    currency: input.currency,
    cost_snapshot: String(input.providerCost),
    customer_charge_snapshot: String(input.customerCharge),
    provider_usage_id: input.providerCallId,
    metadata: {
      billingTask: "voice_call",
      durationSeconds: input.durationSeconds,
    },
  });
}

export async function upsertVoiceCallFromVapiEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const metadata = callMetadata(payload);
  const providerId = providerCallId(payload);
  const event = eventType(payload);
  const direction = callDirection(payload);
  const { from, to } = phoneNumbers(payload, direction);
  const matchedWorkspaceNumber = await findWorkspaceVoiceNumber(
    supabase,
    direction === "outbound" ? from : to,
  );
  const workspaceId =
    firstText(metadata.workspaceId, payload.workspaceId) ??
    matchedWorkspaceNumber?.workspaceId;

  if (!workspaceId) {
    return {
      callId: null,
      ignored: true,
      reason: "No workspace could be resolved for this Vapi call.",
    };
  }

  const settings = await getVoiceSettings(supabase, workspaceId);
  const purpose = callPurpose(payload, {
    direction,
    fromNumber: from,
    matchedWorkspaceNumber,
    userNumbers: settings.phoneAgentUserNumbers,
  });
  const customerNumber = direction === "outbound" ? to : from;
  const contact = await findContactByPhone(supabase, workspaceId, customerNumber);
  const timing = callTiming(payload);
  const transcript = callTranscript(payload);
  const summary = callSummary(payload);
  const recordingUrl = callRecordingUrl(payload);
  const cost = callCost(
    payload,
    await resolveWorkspaceUsageMarkupRate(
      supabase,
      workspaceId,
      "TWILIO_MARKUP_RATE",
    ),
  );
  const duration = durationSeconds(payload);
  const status = statusFromEvent(event);
  const endedReason = firstText(
    vapiMessage(payload).endedReason,
    vapiCall(payload).endedReason,
    payload.endedReason,
  );
  const reportedAssistantId = providerAssistantId(payload);
  const existingByProviderId = providerId
    ? await supabase
        .from("voice_calls")
        .select(
          "id,metadata,recording_url,recording_expires_at,recording_deleted_at,recording_retention_days",
        )
        .eq("provider", VAPI_PROVIDER)
        .eq("provider_call_id", providerId)
        .maybeSingle()
    : { data: null, error: null };

  if (existingByProviderId.error) {
    if (!tableMissing(existingByProviderId.error)) {
      throw new Error(
        `Unable to load existing Vapi call: ${existingByProviderId.error.message}`,
      );
    }
  }

  const existingRecordingUrl = textValue(existingByProviderId.data?.recording_url);
  const nextRecordingUrl = recordingUrl ?? existingRecordingUrl;
  const nextRecordingDeletedAt = recordingUrl
    ? null
    : textValue(existingByProviderId.data?.recording_deleted_at);
  const nextRecordingExpiresAt = nextRecordingUrl
    ? recordingUrl
      ? recordingExpiryFromTiming(timing)
      : (textValue(existingByProviderId.data?.recording_expires_at) ??
        recordingExpiryFromTiming(timing))
    : null;

  const payloadRow = {
    workspace_id: workspaceId,
    conversation_id: textValue(metadata.conversationId),
    contact_id: contact?.id ?? textValue(metadata.contactId),
    lead_id: textValue(metadata.leadId),
    phone_number_id: matchedWorkspaceNumber?.id ?? textValue(metadata.phoneNumberRowId),
    direction,
    purpose,
    provider: VAPI_PROVIDER,
    carrier_provider: VAPI_CARRIER_PROVIDER,
    provider_call_id: providerId,
    provider_assistant_id: reportedAssistantId,
    provider_phone_number_id:
      providerPhoneNumberId(payload) ?? matchedWorkspaceNumber?.providerPhoneNumberId,
    from_number: from,
    to_number: to,
    normalized_from_number: normalizePhone(from),
    normalized_to_number: normalizePhone(to),
    customer_number: customerNumber,
    status,
    started_at: timing.startedAt,
    ended_at: timing.endedAt,
    duration_seconds: duration,
    recording_url: nextRecordingUrl,
    recording_retention_days: VOICE_RECORDING_RETENTION_DAYS,
    recording_expires_at: nextRecordingExpiresAt,
    recording_deleted_at: nextRecordingDeletedAt,
    transcript,
    summary,
    ended_reason: endedReason,
    cost_provider_amount: String(cost.providerCost),
    cost_customer_amount: String(cost.customerCharge),
    currency: cost.currency,
    metadata: {
      ...objectRecord(existingByProviderId.data?.metadata),
      assistantSelection: assistantSelectionFromMetadata(
        metadata,
        reportedAssistantId,
      ),
      callOutcome: statusDetailFromCall({
        endedReason,
        recordingUrl: nextRecordingUrl,
        status,
        summary,
        transcript,
      }),
      lastEventType: event,
      lastPayloadReceivedAt: new Date().toISOString(),
      recordingRetention: {
        days: VOICE_RECORDING_RETENTION_DAYS,
        expiresAt: nextRecordingExpiresAt,
        policy: "delete_vapi_call_data_and_clear_recording_url",
      },
      vapiMetadata: metadata,
    },
  };
  const result = existingByProviderId.data
    ? await supabase
        .from("voice_calls")
        .update(payloadRow)
        .eq("id", existingByProviderId.data.id)
        .eq("workspace_id", workspaceId)
        .select("id")
        .single()
    : await supabase.from("voice_calls").insert(payloadRow).select("id").single();

  if (result.error || !result.data) {
    throw new Error(
      `Unable to record Vapi call: ${result.error?.message ?? "unknown error"}`,
    );
  }

  const callId = String(result.data.id);

  await supabase.from("voice_call_events").insert({
    workspace_id: workspaceId,
    voice_call_id: callId,
    provider: VAPI_PROVIDER,
    event_type: event,
    payload,
  });

  if (status === "completed") {
    await recordVoiceCallUsageIfNeeded(supabase, {
      callId,
      currency: cost.currency,
      customerCharge: cost.customerCharge,
      durationSeconds: duration,
      providerCallId: providerId,
      providerCost: cost.providerCost,
      workspaceId,
    });
  }

  return { callId, ignored: false, reason: null };
}

export async function cleanupExpiredVoiceCallRecordings(
  supabase: SupabaseClient,
  input: {
    limit?: number;
    now?: Date | string;
    workspaceId?: string | null;
  } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const now =
    input.now instanceof Date
      ? input.now
      : input.now
        ? new Date(input.now)
        : new Date();
  const checkedAt = Number.isNaN(now.getTime())
    ? new Date().toISOString()
    : now.toISOString();
  let query = supabase
    .from("voice_calls")
    .select(
      "id,workspace_id,provider,provider_call_id,recording_expires_at,metadata",
    )
    .not("recording_url", "is", null)
    .is("recording_deleted_at", null)
    .lte("recording_expires_at", checkedAt)
    .order("recording_expires_at", { ascending: true })
    .limit(limit);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    if (tableMissing(error)) {
      return {
        checkedAt,
        deleted: 0,
        failed: 0,
        processed: 0,
        reason: "voice_calls table is not available.",
      };
    }

    throw new Error(
      `Unable to load expired voice recordings: ${error.message}`,
    );
  }

  let deleted = 0;
  let failed = 0;
  const failures: Array<{ callId: string; error: string }> = [];

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const callId = String(row.id);
    const workspaceId = String(row.workspace_id);
    const provider = textValue(row.provider) ?? VAPI_PROVIDER;
    const providerCallId = textValue(row.provider_call_id);
    const metadata = objectRecord(row.metadata);
    const retentionMetadata = {
      ...objectRecord(metadata.recordingRetention),
      attemptedAt: checkedAt,
      expiresAt: textValue(row.recording_expires_at),
      provider,
    };

    if (provider !== VAPI_PROVIDER || !providerCallId) {
      failed += 1;
      const reason =
        provider !== VAPI_PROVIDER
          ? `Recording provider ${provider} is not deletable by the Vapi cleanup worker.`
          : "Vapi provider call id is missing.";
      failures.push({ callId, error: reason });

      await supabase
        .from("voice_calls")
        .update({
          metadata: {
            ...metadata,
            recordingRetention: {
              ...retentionMetadata,
              deletionError: reason,
              status: "delete_failed",
            },
          },
        })
        .eq("workspace_id", workspaceId)
        .eq("id", callId);

      continue;
    }

    const deleteResult = await deleteVapiCallData(providerCallId);

    if (!deleteResult.deleted) {
      failed += 1;
      const reason = deleteResult.error ?? "Vapi recording delete failed.";
      failures.push({ callId, error: reason });

      await supabase
        .from("voice_calls")
        .update({
          metadata: {
            ...metadata,
            recordingRetention: {
              ...retentionMetadata,
              deletionError: reason,
              providerDeleteStatus: deleteResult.status,
              status: "delete_failed",
            },
          },
        })
        .eq("workspace_id", workspaceId)
        .eq("id", callId);

      continue;
    }

    const { error: updateError } = await supabase
      .from("voice_calls")
      .update({
        metadata: {
          ...metadata,
          recordingRetention: {
            ...retentionMetadata,
            deletedAt: checkedAt,
            deletionError: null,
            providerDeleteStatus: deleteResult.status,
            status: "deleted",
          },
        },
        recording_deleted_at: checkedAt,
        recording_url: null,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", callId);

    if (updateError) {
      failed += 1;
      failures.push({ callId, error: updateError.message });
      continue;
    }

    deleted += 1;
  }

  return {
    checkedAt,
    deleted,
    failed,
    failures,
    processed: data?.length ?? 0,
  };
}

export async function lookupVoiceContactsForTool(input: {
  phoneNumber?: string | null;
  query?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const phone = normalizePhone(input.phoneNumber ?? null);
  const query = input.query?.trim() ?? "";

  let request = input.supabase
    .from("contacts")
    .select("id,name,company,email,phone,address,contact_type")
    .eq("workspace_id", input.workspaceId)
    .is("merged_into_contact_id", null)
    .limit(10);

  if (phone) {
    request = request.eq("normalized_phone", phone);
  } else if (query) {
    request = request.or(
      `name.ilike.%${query}%,company.ilike.%${query}%,email.ilike.%${query}%`,
    );
  }

  const { data, error } = await request;

  if (error) {
    throw new Error(`Unable to search voice contacts: ${error.message}`);
  }

  return ((data ?? []) as Record<string, unknown>[]).map((contact) => ({
    address: textValue(contact.address),
    company: textValue(contact.company),
    contactType: textValue(contact.contact_type),
    email: textValue(contact.email),
    id: String(contact.id),
    name: textValue(contact.name),
    phone: textValue(contact.phone),
  }));
}

export async function recordVoiceToolEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
  providerCallId?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  let voiceCallId: string | null = null;

  if (input.providerCallId) {
    const { data, error } = await input.supabase
      .from("voice_calls")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("provider", VAPI_PROVIDER)
      .eq("provider_call_id", input.providerCallId)
      .maybeSingle();

    if (error && !tableMissing(error)) {
      throw new Error(`Unable to load voice call: ${error.message}`);
    }

    voiceCallId = data?.id ? String(data.id) : null;
  }

  const { error } = await input.supabase.from("voice_call_events").insert({
    workspace_id: input.workspaceId,
    voice_call_id: voiceCallId,
    provider: VAPI_PROVIDER,
    event_type: input.eventType,
    payload: input.payload,
  });

  if (error && !tableMissing(error)) {
    throw new Error(`Unable to record voice tool event: ${error.message}`);
  }

  return { voiceCallId };
}

async function loadVoiceCallAutomationTarget(input: {
  args: Record<string, unknown>;
  providerCallId?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const explicitCallId = textValue(input.args.voiceCallId ?? input.args.callId);
  let query = input.supabase
    .from("voice_calls")
    .select(
      "id,conversation_id,contact_id,lead_id,direction,purpose,provider_call_id,from_number,to_number,summary,transcript,metadata",
    )
    .eq("workspace_id", input.workspaceId)
    .limit(1);

  if (explicitCallId) {
    query = query.eq("id", explicitCallId);
  } else if (input.providerCallId) {
    query = query
      .eq("provider", VAPI_PROVIDER)
      .eq("provider_call_id", input.providerCallId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    if (tableMissing(error)) {
      return null;
    }

    throw new Error(`Unable to load voice call for note: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    contactId: textValue(data.contact_id),
    conversationId: textValue(data.conversation_id),
    direction:
      data.direction === "outbound" ? "outbound" : ("inbound" as VoiceCallDirection),
    fromNumber: textValue(data.from_number),
    id: String(data.id),
    leadId: textValue(data.lead_id),
    providerCallId: textValue(data.provider_call_id),
    purpose: (textValue(data.purpose) ?? "inbound_customer") as VoiceCallPurpose,
    summary: textValue(data.summary),
    toNumber: textValue(data.to_number),
    transcript: textValue(data.transcript),
  } satisfies VoiceCallAutomationTarget;
}

async function findOrCreateVoiceConversationChannel(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("type", "vapi_voice")
    .eq("display_name", "Vapi phone")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to load voice channel: ${existingError.message}`);
  }

  if (existing?.id) {
    return String(existing.id);
  }

  const { data: created, error } = await supabase
    .from("channels")
    .insert({
      display_name: "Vapi phone",
      external_id: "vapi_voice",
      settings: {
        source: "vapi_post_call_automation",
      },
      status: "active",
      type: "vapi_voice",
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(
      `Unable to create voice channel: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(created.id);
}

async function ensureVoiceCallConversation(input: {
  call: VoiceCallAutomationTarget | null;
  note: string;
  priority: PostCallTaskPlan["priority"];
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const call = input.call;
  const now = new Date().toISOString();

  if (!call) {
    return {
      contactId: null,
      conversationId: null,
      leadId: null,
      messageId: null,
    };
  }

  const channelId = await findOrCreateVoiceConversationChannel(
    input.supabase,
    input.workspaceId,
  );
  let conversationId = call.conversationId;

  if (!conversationId) {
    const { data: conversation, error } = await input.supabase
      .from("conversations")
      .insert({
        channel_id: channelId,
        contact_id: call.contactId,
        external_thread_id: call.providerCallId
          ? `vapi:${call.providerCallId}`
          : call.id
            ? `voice_call:${call.id}`
            : `vapi_note:${crypto.randomUUID()}`,
        last_message_at: now,
        lead_id: call.leadId,
        status: "open",
        workspace_id: input.workspaceId,
      })
      .select("id")
      .single();

    if (error || !conversation) {
      throw new Error(
        `Unable to create phone conversation: ${error?.message ?? "unknown error"}`,
      );
    }

    conversationId = String(conversation.id);

    if (call.id) {
      await input.supabase
        .from("voice_calls")
        .update({
          conversation_id: conversationId,
        })
        .eq("workspace_id", input.workspaceId)
        .eq("id", call.id);
    }
  } else {
    await input.supabase
      .from("conversations")
      .update({
        contact_id: call.contactId,
        last_message_at: now,
        lead_id: call.leadId,
        status: "open",
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", conversationId);
  }

  const { data: existingMessage, error: existingMessageError } =
    await input.supabase
      .from("messages")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("conversation_id", conversationId)
      .contains(
        "metadata",
        call.id
          ? { voiceCallId: call.id }
          : { providerCallId: call.providerCallId },
      )
      .limit(1)
      .maybeSingle();

  if (existingMessageError) {
    throw new Error(
      `Unable to inspect phone call message: ${existingMessageError.message}`,
    );
  }

  if (existingMessage?.id) {
    return {
      contactId: call.contactId,
      conversationId,
      leadId: call.leadId,
      messageId: String(existingMessage.id),
    };
  }

  const body = [
    input.note,
    call.summary ? `Summary: ${call.summary}` : null,
    !call.summary && call.transcript
      ? `Transcript: ${compactText(call.transcript, 900)}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
  const { data: message, error: messageError } = await input.supabase
    .from("messages")
    .insert({
      body_text: body,
      channel_id: channelId,
      contact_id: call.contactId,
      conversation_id: conversationId,
      direction: call.direction === "outbound" ? "outbound" : "inbound",
      metadata: {
        priority: input.priority,
        providerCallId: call.providerCallId,
        purpose: call.purpose,
        source: "vapi_post_call_automation",
        voiceCallId: call.id,
      },
      received_at: call.direction === "inbound" ? now : null,
      sent_at: call.direction === "outbound" ? now : null,
      subject: voiceCallSubject(call),
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  if (messageError || !message) {
    throw new Error(
      `Unable to create phone call message: ${messageError?.message ?? "unknown error"}`,
    );
  }

  return {
    contactId: call.contactId,
    conversationId,
    leadId: call.leadId,
    messageId: String(message.id),
  };
}

function callCustomerNumber(call: VoiceCallAutomationTarget | null) {
  if (!call) {
    return null;
  }

  return call.direction === "outbound"
    ? (call.toNumber ?? call.fromNumber)
    : (call.fromNumber ?? call.toNumber);
}

function callerDisplayName(args: Record<string, unknown>) {
  return firstText(
    args.contactName,
    args.callerName,
    args.customerName,
    args.name,
  );
}

function callServiceType(args: Record<string, unknown>, note: string) {
  return (
    firstText(args.serviceType, args.jobType, args.workType, args.issueType) ??
    (/quote/i.test(note)
      ? "Quote"
      : /leak|burst|flood/i.test(note)
        ? "Urgent plumbing"
        : null)
  );
}

function shouldCreateLeadForCall(input: {
  args: Record<string, unknown>;
  call: VoiceCallAutomationTarget | null;
  note: string;
  priority: PostCallTaskPlan["priority"];
}) {
  const explicit = booleanValue(input.args.createLead);

  if (explicit !== null) {
    return explicit;
  }

  if (!input.call || input.call.purpose === "inbound_user") {
    return false;
  }

  if (input.call.purpose === "voicemail_overflow") {
    return true;
  }

  const lower = input.note.toLowerCase();

  return (
    input.priority === "urgent" ||
    /\b(job|quote|estimate|book|booking|appointment|site visit|callback|call back|complaint|repair|install|service)\b/.test(
      lower,
    )
  );
}

async function ensureVoiceCallCrmArtifacts(input: {
  args: Record<string, unknown>;
  call: VoiceCallAutomationTarget | null;
  note: string;
  priority: PostCallTaskPlan["priority"];
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const call = input.call;

  if (!call || call.purpose === "inbound_user") {
    return call;
  }

  const customerNumber = callCustomerNumber(call);
  const normalizedCustomerNumber = normalizePhone(customerNumber);
  let contactId = call.contactId;

  if (!contactId) {
    const existingContact = await findContactByPhone(
      input.supabase,
      input.workspaceId,
      customerNumber,
    );

    contactId = existingContact?.id ?? null;
  }

  if (!contactId && (customerNumber || callerDisplayName(input.args))) {
    const name =
      callerDisplayName(input.args) ??
      (customerNumber ? "Unknown phone caller" : "Unknown caller");
    const address = firstText(
      input.args.address,
      input.args.jobAddress,
      input.args.serviceAddress,
    );
    const email = firstText(input.args.email, input.args.customerEmail);
    const { data: contact, error } = await input.supabase
      .from("contacts")
      .insert({
        address,
        contact_type: "lead",
        email,
        lifecycle_reason: "Created from Vapi post-call automation.",
        lifecycle_source: "ai",
        lifecycle_stage: "lead",
        name,
        notes: compactText(input.note, 900),
        normalized_phone: normalizedCustomerNumber,
        phone: customerNumber,
        source: "vapi_phone_call",
        workspace_id: input.workspaceId,
      })
      .select("id")
      .single();

    if (error || !contact) {
      throw new Error(
        `Unable to create caller contact: ${error?.message ?? "unknown error"}`,
      );
    }

    contactId = String(contact.id);

    await insertAuditLog(input.supabase, {
      workspaceId: input.workspaceId,
      actorType: "ai",
      actorId: textValue(input.args.userId) ?? undefined,
      action: "voice_call.contact_created",
      entityType: "contact",
      entityId: contactId,
      after: {
        customerNumber,
        name,
        purpose: call.purpose,
        source: "vapi_phone_call",
      },
    });
  }

  let leadId = call.leadId;

  if (!leadId && contactId && shouldCreateLeadForCall(input)) {
    const displayName =
      callerDisplayName(input.args) ?? customerNumber ?? "unknown caller";
    const serviceType = callServiceType(input.args, input.note);
    const title =
      firstText(input.args.leadTitle) ??
      (serviceType
        ? `${serviceType} call from ${displayName}`
        : call.purpose === "voicemail_overflow"
          ? `Voicemail enquiry from ${displayName}`
          : `Phone enquiry from ${displayName}`);
    const nextStep =
      input.priority === "urgent"
        ? "Review urgently and call the customer back"
        : call.purpose === "voicemail_overflow"
          ? "Review voicemail overflow call and follow up"
          : "Review phone call outcome and follow up";
    const { data: lead, error } = await input.supabase
      .from("leads")
      .insert({
        contact_id: contactId,
        description: compactText(input.note, 1_000),
        next_step: nextStep,
        priority: input.priority,
        service_type: serviceType,
        source: "vapi_phone_call",
        status: "new",
        title,
        workspace_id: input.workspaceId,
      })
      .select("id,title")
      .single();

    if (error || !lead) {
      throw new Error(
        `Unable to create call lead: ${error?.message ?? "unknown error"}`,
      );
    }

    leadId = String(lead.id);

    await insertAuditLog(input.supabase, {
      workspaceId: input.workspaceId,
      actorType: "ai",
      actorId: textValue(input.args.userId) ?? undefined,
      action: "voice_call.lead_created",
      entityType: "lead",
      entityId: leadId,
      after: {
        contactId,
        priority: input.priority,
        purpose: call.purpose,
        title: lead.title,
      },
    });
  }

  if (call.id && (contactId !== call.contactId || leadId !== call.leadId)) {
    await input.supabase
      .from("voice_calls")
      .update({
        contact_id: contactId,
        lead_id: leadId,
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", call.id);
  }

  return {
    ...call,
    contactId,
    leadId,
  } satisfies VoiceCallAutomationTarget;
}

export async function recordVoiceCallPostCallAutomation(input: {
  args: Record<string, unknown>;
  payload: Record<string, unknown>;
  providerCallId?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const note = textValue(input.args.note);

  if (!note) {
    throw new Error("kyro_record_call_note requires a note.");
  }

  const voiceCall = await loadVoiceCallAutomationTarget(input);
  const automationTarget =
    voiceCall ??
    fallbackVoiceCallAutomationTarget({
      args: input.args,
      payload: input.payload,
      providerCallId: input.providerCallId,
    });
  const priority = normalizedPriority(input.args.priority, note);
  const automationTargetWithCrm = await ensureVoiceCallCrmArtifacts({
    args: input.args,
    call: automationTarget,
    note,
    priority,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });
  const target = await ensureVoiceCallConversation({
    call: automationTargetWithCrm,
    note,
    priority,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });
  const metadata = {
    providerCallId: input.providerCallId ?? voiceCall?.providerCallId ?? null,
    source: "vapi_record_call_note_tool",
    toolArgs: {
      callbackRequested: booleanValue(input.args.callbackRequested),
      bookingRequested: booleanValue(input.args.bookingRequested),
      complaint: booleanValue(input.args.complaint),
      createTask: booleanValue(input.args.createTask),
      quoteRequested: booleanValue(input.args.quoteRequested),
    },
    voiceCallId: voiceCall?.id ?? null,
  };

  const { data: noteRow, error: noteError } = await input.supabase
    .from("conversation_notes")
    .insert({
      author_user_id: textValue(input.args.userId),
      body: note,
      contact_id: target.contactId ?? textValue(input.args.contactId),
      conversation_id: target.conversationId ?? textValue(input.args.conversationId),
      lead_id: target.leadId ?? textValue(input.args.leadId),
      message_id: target.messageId,
      metadata,
      visibility: "internal",
      workspace_id: input.workspaceId,
    })
    .select("id")
    .single();

  if (noteError || !noteRow) {
    throw new Error(
      `Unable to create call note: ${noteError?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(input.supabase, {
    workspaceId: input.workspaceId,
    actorType: "ai",
    actorId: textValue(input.args.userId) ?? undefined,
    action: "voice_call.note_created",
    entityType: "conversation_note",
    entityId: String(noteRow.id),
    after: {
      conversationId: target.conversationId,
      priority,
      voiceCallId: voiceCall?.id ?? null,
    },
  });

  const taskPlan = taskPlanFromCallNote({
    args: input.args,
    call: automationTargetWithCrm,
    note,
    priority,
  });
  let taskId: string | null = null;

  if (taskPlan) {
    const { data: task, error: taskError } = await input.supabase
      .from("conversation_tasks")
      .insert({
        assigned_to_user_id: textValue(input.args.userId),
        contact_id: target.contactId ?? textValue(input.args.contactId),
        conversation_id:
          target.conversationId ?? textValue(input.args.conversationId),
        created_by_user_id: textValue(input.args.userId),
        description: taskPlan.description,
        due_at: taskPlan.dueAt,
        lead_id: target.leadId ?? textValue(input.args.leadId),
        message_id: target.messageId,
        metadata: {
          ...metadata,
          noteId: String(noteRow.id),
        },
        priority: taskPlan.priority,
        status: "open",
        task_type: taskPlan.taskType,
        title: taskPlan.title,
        workspace_id: input.workspaceId,
      })
      .select("id")
      .single();

    if (taskError || !task) {
      throw new Error(
        `Unable to create call follow-up task: ${
          taskError?.message ?? "unknown error"
        }`,
      );
    }

    taskId = String(task.id);

    await insertAuditLog(input.supabase, {
      workspaceId: input.workspaceId,
      actorType: "ai",
      actorId: textValue(input.args.userId) ?? undefined,
      action: "voice_call.follow_up_task_created",
      entityType: "conversation_task",
      entityId: taskId,
      after: {
        conversationId: target.conversationId,
        dueAt: taskPlan.dueAt,
        priority: taskPlan.priority,
        taskType: taskPlan.taskType,
        voiceCallId: voiceCall?.id ?? null,
      },
    });
  }

  await recordVoiceToolEvent({
    eventType: "tool.kyro_record_call_note.completed",
    payload: {
      ...input.payload,
      kyroAutomation: {
        conversationId: target.conversationId,
        messageId: target.messageId,
        noteId: String(noteRow.id),
        taskId,
        voiceCallId: voiceCall?.id ?? null,
      },
      kyroNote: note,
      kyroPriority: priority,
    },
    providerCallId: input.providerCallId,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });

  return {
    conversationId: target.conversationId,
    messageId: target.messageId,
    noteId: String(noteRow.id),
    taskId,
    voiceCallId: voiceCall?.id ?? null,
  };
}

export async function createOutboundVoiceCall(input: {
  contactId?: string | null;
  contextSummary?: string | null;
  conversationId?: string | null;
  instructions?: string | null;
  leadId?: string | null;
  phoneNumber: string;
  supabase: SupabaseClient;
  threadId?: string | null;
  user: User;
  workspaceId: string;
}) {
  const settings = await getVoiceSettings(input.supabase, input.workspaceId);

  if (!settings.phoneAgentEnabled || !settings.phoneAgentOutboundEnabled) {
    throw new Error("Outbound phone calls are disabled in voice settings.");
  }

  const customerNumber = normalizePhone(input.phoneNumber);

  if (!customerNumber) {
    throw new Error("Add a valid customer phone number before calling.");
  }

  const assistantId = settings.vapiOutboundAssistantId;
  const phoneNumberSelection = await selectOutboundVapiPhoneNumber({
    customerNumber,
    fallbackPhoneNumberId: settings.vapiPhoneNumberId,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });
  const selectedVoice = elevenLabsVoicePresetById(
    settings.elevenLabsVoicePresetId,
  );

  if (!assistantId) {
    throw new Error("Vapi outbound assistant ID is required before calling.");
  }

  if (!phoneNumberSelection) {
    throw new Error(
      "Add a Vapi phone number ID in voice settings or attach one to an active workspace phone number.",
    );
  }

  const [ownerUserId, outboundWorkspaceName, linkedRows, generalSettings] =
    await Promise.all([
      workspaceOwnerId(input.supabase, input.workspaceId),
      workspaceName(input.supabase, input.workspaceId),
      lookupLinkedRows(input.supabase, input.workspaceId, {
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        leadId: input.leadId ?? null,
      }),
      getWorkspaceGeneralSettings(input.supabase, input.workspaceId).catch(
        () => DEFAULT_WORKSPACE_GENERAL_SETTINGS,
      ),
    ]);
  const currentTime = buildVapiCurrentTimeContext(generalSettings.timeZone);
  const userIdentity = vapiUserIdentityFromUser(input.user);
  const outboundBusinessName =
    textValue(generalSettings.businessProfile.businessName) ??
    outboundWorkspaceName ??
    "";
  const phoneMatchedContact = linkedRows.contact
    ? null
    : await findContactByPhone(input.supabase, input.workspaceId, customerNumber);
  const outboundContact = linkedRows.contact ?? phoneMatchedContact;
  const outboundContactId = input.contactId ?? outboundContact?.id ?? null;
  const outboundConversationId = input.conversationId ?? null;
  const outboundLeadId = input.leadId ?? null;
  const callInstructions = textValue(input.instructions);
  const assistantContextSummary = textValue(input.contextSummary);
  const recentOutboundCallContext = await recentOutboundCallContextForCustomer({
    contactId: outboundContactId,
    customerNumber,
    supabase: input.supabase,
    workspaceId: input.workspaceId,
  });
  const outboundCallContext = compactOutboundCallContext({
    assistantContextSummary,
    contact: outboundContact,
    conversation: linkedRows.conversation,
    customerNumber,
    instructions: callInstructions,
    lead: linkedRows.lead,
    recentOutboundCallContext,
    userIdentity,
    workspaceName: outboundBusinessName || outboundWorkspaceName,
  });
  const outboundCallContextWithTime = [
    currentTime.promptLine,
    outboundCallContext,
  ].join("\n\n");
  const baseMetadata = {
    assistantContextSummary,
    createdByUserId: input.user.id,
    instructions: callInstructions,
    ownerUserId,
    outboundCallContext: outboundCallContextWithTime,
    phoneNumberSelection: {
      countryCode: phoneNumberSelection.countryCode,
      fromNumber: phoneNumberSelection.fromNumber,
      normalizedFromNumber: phoneNumberSelection.normalizedFromNumber,
      reason: phoneNumberSelection.reason,
      region: phoneNumberSelection.region,
      vapiPhoneNumberId: phoneNumberSelection.phoneNumberId,
      workspacePhoneNumberId: phoneNumberSelection.workspacePhoneNumberId,
    },
    source: "kyro.outbound_voice",
    threadId: input.threadId ?? null,
    userEmail: userIdentity.email,
    userName: userIdentity.name,
    userPhone: userIdentity.phone,
  };
  const { data: inserted, error: insertError } = await input.supabase
    .from("voice_calls")
    .insert({
      workspace_id: input.workspaceId,
      conversation_id: outboundConversationId,
      contact_id: outboundContactId,
      lead_id: outboundLeadId,
      phone_number_id: phoneNumberSelection.workspacePhoneNumberId,
      direction: "outbound",
      purpose: "outbound_customer",
      provider: VAPI_PROVIDER,
      carrier_provider: VAPI_CARRIER_PROVIDER,
      provider_assistant_id: assistantId,
      provider_phone_number_id: phoneNumberSelection.phoneNumberId,
      from_number: phoneNumberSelection.fromNumber,
      normalized_from_number: phoneNumberSelection.normalizedFromNumber,
      to_number: customerNumber,
      normalized_to_number: customerNumber,
      customer_number: customerNumber,
      status: "queued",
      metadata: baseMetadata,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `Unable to queue outbound voice call: ${
        insertError?.message ?? "unknown error"
      }`,
    );
  }

  const webhookUrl = remotelyReachableUrl(vapiEndpointUrl(VAPI_WEBHOOK_PATH));
  const webhookCredentialId = vapiWebhookCredentialId();

  try {
    const result = await createVapiOutboundCall({
      assistantId,
      assistantOverrides: {
        server: webhookUrl
          ? {
              ...(webhookCredentialId
                ? { credentialId: webhookCredentialId }
                : {}),
              timeoutSeconds: 45,
              url: webhookUrl,
            }
          : undefined,
        voice: elevenLabsVapiVoiceOverride(settings),
        variableValues: {
          assistant_context_summary: assistantContextSummary ?? "",
          business_name: outboundBusinessName,
          call_instructions: callInstructions ?? "",
          contact_address: outboundContact?.address ?? "",
          contact_company: outboundContact?.company ?? "",
          contact_email: outboundContact?.email ?? "",
          contact_id: outboundContactId ?? "",
          contact_name: outboundContact?.name ?? "",
          contact_phone: outboundContact?.phone ?? "",
          conversation_id: outboundConversationId ?? "",
          conversation_last_message_at:
            linkedRows.conversation?.lastMessageAt ?? "",
          conversation_status: linkedRows.conversation?.status ?? "",
          customer_phone: customerNumber,
          ...currentTime.variableValues,
          kyro_context: outboundCallContextWithTime,
          lead_id: outboundLeadId ?? "",
          lead_status: linkedRows.lead?.status ?? "",
          lead_title: linkedRows.lead?.title ?? "",
          outbound_call_context: outboundCallContextWithTime,
          recent_chat_context: assistantContextSummary ?? "",
          recent_outbound_call_context: recentOutboundCallContext ?? "",
          thread_id: input.threadId ?? "",
          ...vapiUserVariableValues(userIdentity),
          user_id: input.user.id,
          voice_id: selectedVoice.voiceId,
          voice_label: selectedVoice.label,
          voice_demeanor: settings.phoneAgentDemeanor,
          voice_escalation_mode: settings.phoneAgentEscalationMode,
          voice_humour_level: settings.phoneAgentHumourLevel,
          voice_verbosity: settings.phoneAgentVerbosity,
          workspace_id: input.workspaceId,
          workspace_name: outboundWorkspaceName ?? "",
        },
      },
      customerNumber,
      metadata: {
        contactId: outboundContactId,
        conversationId: outboundConversationId,
        direction: "outbound",
        instructions: callInstructions,
        leadId: outboundLeadId,
        ownerUserId,
        outboundCallContext: outboundCallContextWithTime,
        assistantContextSummary,
        recentOutboundCallContext,
        phoneNumberSelection: baseMetadata.phoneNumberSelection,
        purpose: "outbound_customer",
        threadId: input.threadId ?? null,
        userId: input.user.id,
        userEmail: userIdentity.email,
        userName: userIdentity.name,
        userPhone: userIdentity.phone,
        voiceCallId: inserted.id,
        workspaceId: input.workspaceId,
      },
      phoneNumberId: phoneNumberSelection.phoneNumberId,
    });

    await input.supabase
      .from("voice_calls")
      .update({
        provider_call_id: result.id,
        status: result.status ?? "queued",
        metadata: {
          ...baseMetadata,
          providerResponse: result.raw,
        },
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", inserted.id);

    return {
      providerCallId: result.id,
      status: result.status ?? "queued",
      voiceCallId: String(inserted.id),
    };
  } catch (error) {
    await input.supabase
      .from("voice_calls")
      .update({
        ended_reason:
          error instanceof Error ? error.message : "Unable to create Vapi call.",
        status: "failed",
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", inserted.id);

    throw error;
  }
}

export function vapiToolWorkspaceId(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const toolFunction = objectRecord(toolCall.function);
  const args = jsonRecord(toolFunction.arguments ?? toolCall.arguments);
  const metadata = callMetadata(payload);

  return firstText(args.workspaceId, metadata.workspaceId, payload.workspaceId);
}

export function vapiToolCallMetadata(payload: Record<string, unknown>) {
  return callMetadata(payload);
}

export function vapiToolUserId(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const toolFunction = objectRecord(toolCall.function);
  const args = jsonRecord(toolFunction.arguments ?? toolCall.arguments);
  const metadata = callMetadata(payload);

  return firstText(args.userId, metadata.userId, payload.userId);
}

export function vapiToolThreadId(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const toolFunction = objectRecord(toolCall.function);
  const args = jsonRecord(toolFunction.arguments ?? toolCall.arguments);
  const metadata = callMetadata(payload);

  return firstText(args.threadId, metadata.threadId, payload.threadId);
}

function firstToolCall(payload: Record<string, unknown>) {
  const message = objectRecord(payload.message);
  const directToolCall = objectRecord(message.toolCall ?? payload.toolCall);
  const toolCalls = [
    ...arrayRecords(message.toolCalls),
    ...arrayRecords(message.toolCallList),
    ...arrayRecords(payload.toolCalls),
  ];

  return Object.keys(directToolCall).length > 0
    ? directToolCall
    : (toolCalls[0] ?? {});
}

export function vapiToolCallPayload(payload: Record<string, unknown>) {
  const toolCall = firstToolCall(payload);
  const rawArguments = toolCall.function
    ? jsonRecord(objectRecord(toolCall.function).arguments)
    : jsonRecord(toolCall.arguments);

  return {
    arguments: {
      ...rawArguments,
      ...objectRecord(payload.arguments),
    },
    callId: providerCallId(payload),
    id: textValue(toolCall.id ?? payload.toolCallId),
    name: firstText(
      objectRecord(toolCall.function).name,
      toolCall.name,
      payload.name,
    ),
  };
}

export function vapiAssistantGuidance(settings: Awaited<ReturnType<typeof getVoiceSettings>>) {
  return {
    escalationMode: settings.phoneAgentEscalationMode,
    humourLevel: settings.phoneAgentHumourLevel,
    persona: settings.phoneAgentDemeanor,
    userNumberDetails: settings.phoneAgentUserNumberDetails,
    userNumbers: settings.phoneAgentUserNumbers,
    verbosity: settings.phoneAgentVerbosity,
  };
}

export function compactTranscriptPreview(value: string | null, maxLength = 160) {
  const clean = value?.replace(/\s+/g, " ").trim();

  if (!clean) {
    return null;
  }

  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}
