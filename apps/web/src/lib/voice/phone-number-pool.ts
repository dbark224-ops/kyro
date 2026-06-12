import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PHONE_REGION,
  normalizeContactPhoneForRegion,
  normalizePhoneRegion,
  type PhoneRegion,
} from "../crm/identity";
import {
  findOrCreateTwilioSmsChannel,
  TWILIO_PROVIDER,
} from "../integrations/twilio";
import { insertAuditLog } from "../engine/event-action-audit";

export type WorkspacePhoneNumberPoolAssignment = {
  assigned: boolean;
  activationCharged?: boolean;
  countryCode: PhoneRegion;
  number: WorkspacePhoneNumberPoolRow;
};

export type WorkspacePhoneNumberPoolRelease = {
  channelDeactivated: boolean;
  number: WorkspacePhoneNumberPoolRow;
};

export type WorkspacePhoneNumberPoolRow = {
  capabilities: {
    mms?: boolean;
    sms?: boolean;
    voice?: boolean;
  };
  countryCode: string | null;
  currency: string;
  friendlyName: string | null;
  id: string;
  metadata: Record<string, unknown>;
  monthlyCostSnapshot: number;
  normalizedPhone: string;
  phoneNumber: string;
  providerPhoneNumberId: string | null;
  region: string | null;
  status: string;
  vapiPhoneNumberId: string | null;
};

const ASSIGNMENT_SOURCE = "manual_pool";
const PHONE_NUMBER_ACTIVATION_CHARGE_USD = 6;

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function capabilitiesValue(value: unknown) {
  const record = objectRecord(value);

  return {
    mms: Boolean(record.mms),
    sms: Boolean(record.sms),
    voice: Boolean(record.voice),
  };
}

function vapiPhoneNumberId(metadata: Record<string, unknown>) {
  const vapi = objectRecord(metadata.vapi);

  return (
    textValue(metadata.vapiPhoneNumberId) ??
    textValue(metadata.vapi_phone_number_id) ??
    textValue(metadata.vapiNumberId) ??
    textValue(metadata.vapi_number_id) ??
    textValue(vapi.phoneNumberId) ??
    textValue(vapi.phone_number_id) ??
    textValue(vapi.numberId)
  );
}

function toPoolRow(row: Record<string, unknown>): WorkspacePhoneNumberPoolRow {
  const metadata = objectRecord(row.metadata);

  return {
    capabilities: capabilitiesValue(row.capabilities),
    countryCode: textValue(row.country_code),
    currency: textValue(row.currency) ?? "USD",
    friendlyName: textValue(row.friendly_name),
    id: String(row.id),
    metadata,
    monthlyCostSnapshot: numberValue(row.monthly_cost_snapshot) ?? 0,
    normalizedPhone: String(row.normalized_phone),
    phoneNumber: String(row.phone_number),
    providerPhoneNumberId: textValue(row.provider_phone_number_id),
    region: textValue(row.region),
    status: textValue(row.status) ?? "active",
    vapiPhoneNumberId: vapiPhoneNumberId(metadata),
  };
}

function selectColumns() {
  return [
    "id",
    "phone_number",
    "normalized_phone",
    "friendly_name",
    "provider_phone_number_id",
    "country_code",
    "region",
    "capabilities",
    "status",
    "monthly_cost_snapshot",
    "currency",
    "metadata",
  ].join(",");
}

function tableMissing(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("workspace_phone_numbers") ||
    message.includes("does not exist")
  );
}

function hasSmsAndVoice(row: WorkspacePhoneNumberPoolRow) {
  return Boolean(row.capabilities.sms && row.capabilities.voice);
}

export function normalizePhonePoolCountry(value?: string | null) {
  return normalizePhoneRegion(value, DEFAULT_PHONE_REGION);
}

export function normalizePoolPhoneNumber(
  phoneNumber: string,
  countryCode: PhoneRegion,
) {
  return normalizeContactPhoneForRegion(phoneNumber, countryCode) ?? phoneNumber;
}

export async function getWorkspaceAssignedPhoneNumbers(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_phone_numbers")
    .select(selectColumns())
    .eq("workspace_id", workspaceId)
    .eq("provider", TWILIO_PROVIDER)
    .in("status", ["active", "pending"])
    .order("created_at", { ascending: true });

  if (error) {
    if (tableMissing(error)) {
      return [];
    }

    throw new Error(`Unable to load assigned phone numbers: ${error.message}`);
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toPoolRow);
}

export async function getAvailableWorkspacePhoneNumbersFromPool(
  supabase: SupabaseClient,
  countryCodeInput?: string | null,
) {
  const countryCode = normalizePhonePoolCountry(countryCodeInput);
  const { data, error } = await supabase
    .from("workspace_phone_numbers")
    .select(selectColumns())
    .is("workspace_id", null)
    .eq("provider", TWILIO_PROVIDER)
    .eq("country_code", countryCode)
    .eq("status", "available")
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    if (tableMissing(error)) {
      return [];
    }

    throw new Error(
      `Unable to load available phone-number pool: ${error.message}`,
    );
  }

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(toPoolRow)
    .filter(hasSmsAndVoice);
}

async function recordPhoneNumberActivationCharge(input: {
  actorId?: string | null;
  countryCode: PhoneRegion;
  number: WorkspacePhoneNumberPoolRow;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data: existing, error: existingError } = await input.supabase
    .from("usage_events")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("source_type", "workspace_phone_number")
    .eq("source_id", input.number.id)
    .eq("usage_type", "phone_number_activation")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to check phone-number activation charge: ${existingError.message}`,
    );
  }

  if (existing) {
    return false;
  }

  const { error } = await input.supabase.from("usage_events").insert({
    workspace_id: input.workspaceId,
    user_id: input.actorId ?? null,
    source_type: "workspace_phone_number",
    source_id: input.number.id,
    provider: TWILIO_PROVIDER,
    service: "telephony",
    model: null,
    usage_type: "phone_number_activation",
    quantity: "1",
    unit: "number",
    unit_cost_snapshot: String(PHONE_NUMBER_ACTIVATION_CHARGE_USD),
    markup_snapshot: "0",
    currency: "USD",
    cost_snapshot: String(PHONE_NUMBER_ACTIVATION_CHARGE_USD),
    customer_charge_snapshot: String(PHONE_NUMBER_ACTIVATION_CHARGE_USD),
    provider_usage_id: input.number.providerPhoneNumberId,
    metadata: {
      billingTask: "phone_number_activation",
      countryCode: input.countryCode,
      friendlyName: input.number.friendlyName,
      phoneNumber: input.number.phoneNumber,
      vapiPhoneNumberId: input.number.vapiPhoneNumberId,
    },
  });

  if (error) {
    throw new Error(
      `Unable to record phone-number activation charge: ${error.message}`,
    );
  }

  return true;
}

export async function assignWorkspacePhoneNumberFromPool(input: {
  actorId?: string | null;
  countryCode?: string | null;
  phoneNumberId: string;
  recordActivationCharge?: boolean;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const countryCode = normalizePhonePoolCountry(input.countryCode);
  const assignedNumbers = await getWorkspaceAssignedPhoneNumbers(
    input.supabase,
    input.workspaceId,
  );
  const existingCountryNumber = assignedNumbers.find(
    (number) => number.countryCode === countryCode && hasSmsAndVoice(number),
  );

  if (existingCountryNumber) {
    await findOrCreateTwilioSmsChannel(input.supabase, {
      phoneNumber: existingCountryNumber.phoneNumber,
      providerPhoneNumberId: existingCountryNumber.providerPhoneNumberId,
      workspaceId: input.workspaceId,
    });

    return {
      assigned: false,
      activationCharged: false,
      countryCode,
      number: existingCountryNumber,
    } satisfies WorkspacePhoneNumberPoolAssignment;
  }

  const { data: candidateRow, error: candidateError } = await input.supabase
    .from("workspace_phone_numbers")
    .select(selectColumns())
    .eq("id", input.phoneNumberId)
    .is("workspace_id", null)
    .eq("provider", TWILIO_PROVIDER)
    .eq("country_code", countryCode)
    .eq("status", "available")
    .maybeSingle();

  if (candidateError) {
    if (tableMissing(candidateError)) {
      throw new Error(
        "Phone-number tables are not ready yet. Run the workspace phone-number pool migration first.",
      );
    }

    throw new Error(
      `Unable to load selected phone number: ${candidateError.message}`,
    );
  }

  if (!candidateRow) {
    throw new Error(
      "That phone number is no longer available. Choose another number from the pool.",
    );
  }

  const candidate = toPoolRow(candidateRow as unknown as Record<string, unknown>);

  if (!hasSmsAndVoice(candidate)) {
    throw new Error(
      "Choose a phone number that supports both SMS and voice calls.",
    );
  }

  const assignedAt = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    ...candidate.metadata,
    assignedFromPoolAt: assignedAt,
    assignedToWorkspaceId: input.workspaceId,
    assignmentSource: ASSIGNMENT_SOURCE,
  };
  const { data: assigned, error: assignError } = await input.supabase
    .from("workspace_phone_numbers")
    .update({
      assigned_at: assignedAt,
      assignment_source: ASSIGNMENT_SOURCE,
      metadata,
      reserved_at: null,
      status: "active",
      workspace_id: input.workspaceId,
    })
    .eq("id", candidate.id)
    .is("workspace_id", null)
    .eq("status", "available")
    .select(selectColumns())
    .maybeSingle();

  if (assignError) {
    throw new Error(`Unable to assign phone number: ${assignError.message}`);
  }

  if (!assigned) {
    throw new Error(
      "That phone number was claimed while you were choosing it. Pick another available number.",
    );
  }

  const assignedNumber = toPoolRow(
    assigned as unknown as Record<string, unknown>,
  );

  await findOrCreateTwilioSmsChannel(input.supabase, {
    phoneNumber: assignedNumber.phoneNumber,
    providerPhoneNumberId: assignedNumber.providerPhoneNumberId,
    workspaceId: input.workspaceId,
  });

  const activationCharged = input.recordActivationCharge
    ? await recordPhoneNumberActivationCharge({
        actorId: input.actorId,
        countryCode,
        number: assignedNumber,
        supabase: input.supabase,
        workspaceId: input.workspaceId,
      })
    : false;

  await insertAuditLog(input.supabase, {
    workspaceId: input.workspaceId,
    action: "phone_number_pool.assigned",
    actorId: input.actorId ?? undefined,
    actorType: input.actorId ? "user" : "system",
    after: {
      activationCharged,
      countryCode,
      phoneNumberId: assignedNumber.id,
      provider: TWILIO_PROVIDER,
      providerPhoneNumberId: assignedNumber.providerPhoneNumberId,
    },
    entityId: assignedNumber.id,
    entityType: "workspace_phone_number",
    metadata: {
      assignmentSource: ASSIGNMENT_SOURCE,
      vapiPhoneNumberId: assignedNumber.vapiPhoneNumberId,
    },
  });

  return {
    assigned: true,
    activationCharged,
    countryCode,
    number: assignedNumber,
  } satisfies WorkspacePhoneNumberPoolAssignment;
}

export async function releaseWorkspacePhoneNumberToPool(input: {
  actorId?: string | null;
  phoneNumberId: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { data: candidateRow, error: candidateError } = await input.supabase
    .from("workspace_phone_numbers")
    .select(selectColumns())
    .eq("id", input.phoneNumberId)
    .eq("workspace_id", input.workspaceId)
    .eq("provider", TWILIO_PROVIDER)
    .in("status", ["active", "pending"])
    .maybeSingle();

  if (candidateError) {
    if (tableMissing(candidateError)) {
      throw new Error(
        "Phone-number tables are not ready yet. Run the workspace phone-number pool migration first.",
      );
    }

    throw new Error(
      `Unable to load assigned phone number: ${candidateError.message}`,
    );
  }

  if (!candidateRow) {
    throw new Error("That phone number is not assigned to this workspace.");
  }

  const candidate = toPoolRow(
    candidateRow as unknown as Record<string, unknown>,
  );
  const releasedAt = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    ...candidate.metadata,
    previousAssignmentSource:
      textValue(candidate.metadata.assignmentSource) ?? ASSIGNMENT_SOURCE,
    releasedAt,
    releasedByUserId: input.actorId ?? null,
    releasedFromWorkspaceId: input.workspaceId,
  };

  delete metadata.assignedFromPoolAt;
  delete metadata.assignedToWorkspaceId;
  delete metadata.assignmentSource;

  const { data: releasedRow, error: releaseError } = await input.supabase
    .from("workspace_phone_numbers")
    .update({
      assigned_at: null,
      metadata,
      reserved_at: null,
      status: "available",
      workspace_id: null,
    })
    .eq("id", candidate.id)
    .eq("workspace_id", input.workspaceId)
    .select(selectColumns())
    .maybeSingle();

  if (releaseError) {
    throw new Error(`Unable to disconnect phone number: ${releaseError.message}`);
  }

  if (!releasedRow) {
    throw new Error(
      "That phone number changed while you were disconnecting it. Refresh and try again.",
    );
  }

  const releasedNumber = toPoolRow(
    releasedRow as unknown as Record<string, unknown>,
  );
  const channelExternalId = `twilio:sms:${
    candidate.providerPhoneNumberId ?? candidate.normalizedPhone
  }`;
  const { data: deactivatedChannels, error: channelError } = await input.supabase
    .from("channels")
    .update({ status: "inactive" })
    .eq("workspace_id", input.workspaceId)
    .eq("external_id", channelExternalId)
    .select("id");

  const channelDeactivated = channelError
    ? false
    : (deactivatedChannels ?? []).length > 0;

  await insertAuditLog(input.supabase, {
    workspaceId: input.workspaceId,
    action: "phone_number_pool.released",
    actorId: input.actorId ?? undefined,
    actorType: input.actorId ? "user" : "system",
    after: {
      channelDeactivated,
      phoneNumberId: releasedNumber.id,
      provider: TWILIO_PROVIDER,
      status: releasedNumber.status,
      workspaceId: null,
    },
    before: {
      phoneNumber: candidate.phoneNumber,
      phoneNumberId: candidate.id,
      provider: TWILIO_PROVIDER,
      providerPhoneNumberId: candidate.providerPhoneNumberId,
      status: candidate.status,
      workspaceId: input.workspaceId,
    },
    entityId: releasedNumber.id,
    entityType: "workspace_phone_number",
    metadata: {
      assignmentSource: ASSIGNMENT_SOURCE,
      channelDeactivationError: channelError?.message ?? null,
      channelExternalId,
      vapiPhoneNumberId: candidate.vapiPhoneNumberId,
    },
  });

  return {
    channelDeactivated,
    number: releasedNumber,
  } satisfies WorkspacePhoneNumberPoolRelease;
}

export async function ensureWorkspacePhoneNumberFromPool(input: {
  actorId?: string | null;
  countryCode?: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const countryCode = normalizePhonePoolCountry(input.countryCode);
  const assignedNumbers = await getWorkspaceAssignedPhoneNumbers(
    input.supabase,
    input.workspaceId,
  );
  const existingCountryNumber = assignedNumbers.find(
    (number) => number.countryCode === countryCode && hasSmsAndVoice(number),
  );
  const existingAnyNumber = assignedNumbers.find(hasSmsAndVoice);
  const existing = existingCountryNumber ?? existingAnyNumber;

  if (existing) {
    await findOrCreateTwilioSmsChannel(input.supabase, {
      phoneNumber: existing.phoneNumber,
      providerPhoneNumberId: existing.providerPhoneNumberId,
      workspaceId: input.workspaceId,
    });

    return {
      assigned: false,
      activationCharged: false,
      countryCode,
      number: existing,
    } satisfies WorkspacePhoneNumberPoolAssignment;
  }

  const { data: candidates, error: candidateError } = await input.supabase
    .from("workspace_phone_numbers")
    .select(selectColumns())
    .is("workspace_id", null)
    .eq("provider", TWILIO_PROVIDER)
    .eq("country_code", countryCode)
    .eq("status", "available")
    .order("created_at", { ascending: true })
    .limit(10);

  if (candidateError) {
    if (tableMissing(candidateError)) {
      throw new Error(
        "Phone-number tables are not ready yet. Run the workspace phone-number pool migration first.",
      );
    }

    throw new Error(
      `Unable to load available phone-number pool: ${candidateError.message}`,
    );
  }

  const availableNumbers = (
    (candidates ?? []) as unknown as Record<string, unknown>[]
  )
    .map(toPoolRow)
    .filter(hasSmsAndVoice);

  for (const candidate of availableNumbers) {
    const metadata = {
      ...candidate.metadata,
      assignedFromPoolAt: new Date().toISOString(),
      assignedToWorkspaceId: input.workspaceId,
      assignmentSource: ASSIGNMENT_SOURCE,
    };
    const { data: assigned, error: assignError } = await input.supabase
      .from("workspace_phone_numbers")
      .update({
        assigned_at: new Date().toISOString(),
        assignment_source: ASSIGNMENT_SOURCE,
        metadata,
        reserved_at: null,
        status: "active",
        workspace_id: input.workspaceId,
      })
      .eq("id", candidate.id)
      .is("workspace_id", null)
      .eq("status", "available")
      .select(selectColumns())
      .maybeSingle();

    if (assignError) {
      throw new Error(`Unable to assign phone number: ${assignError.message}`);
    }

    if (!assigned) {
      continue;
    }

    const assignedNumber = toPoolRow(
      assigned as unknown as Record<string, unknown>,
    );

    await findOrCreateTwilioSmsChannel(input.supabase, {
      phoneNumber: assignedNumber.phoneNumber,
      providerPhoneNumberId: assignedNumber.providerPhoneNumberId,
      workspaceId: input.workspaceId,
    });

    const activationCharged = await recordPhoneNumberActivationCharge({
      actorId: input.actorId,
      countryCode,
      number: assignedNumber,
      supabase: input.supabase,
      workspaceId: input.workspaceId,
    });

    await insertAuditLog(input.supabase, {
      workspaceId: input.workspaceId,
      action: "phone_number_pool.assigned",
      actorId: input.actorId ?? undefined,
      actorType: input.actorId ? "user" : "system",
      after: {
        activationCharged,
        countryCode,
        phoneNumberId: assignedNumber.id,
        provider: TWILIO_PROVIDER,
        providerPhoneNumberId: assignedNumber.providerPhoneNumberId,
      },
      entityId: assignedNumber.id,
      entityType: "workspace_phone_number",
      metadata: {
        assignmentSource: ASSIGNMENT_SOURCE,
        vapiPhoneNumberId: assignedNumber.vapiPhoneNumberId,
      },
    });

    return {
      assigned: true,
      activationCharged,
      countryCode,
      number: assignedNumber,
    } satisfies WorkspacePhoneNumberPoolAssignment;
  }

  throw new Error(
    `No available ${countryCode} Twilio number is in the Kyro pool. Add a voice+SMS-capable number in Twilio/Vapi, then insert it as an available workspace_phone_numbers row.`,
  );
}
