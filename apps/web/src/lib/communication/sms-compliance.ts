import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "../crm/identity";
import { getWorkspacePhoneRegion } from "../workspace/general-settings";

export type SmsConsentStatus =
  | "unknown"
  | "opted_in"
  | "opted_out"
  | "blocked"
  | "staff_internal";

export type SmsConsentCommand =
  | {
      keyword: string;
      status: "opted_in" | "opted_out";
    }
  | {
      keyword: null;
      status: null;
    };

type SmsPreferenceRow = {
  consent_status: string;
  opt_out_keyword: string | null;
  opted_out_at: string | null;
  phone_number: string;
};

const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
]);
const OPT_IN_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Consent is keyed on `normalized_phone`, so the read path and the write path
 * must normalize identically. A hardcoded region here would mean a workspace
 * outside that region recording an opt-out under one key and checking it under
 * another -- the recipient says STOP and Kyro keeps texting them.
 */
function normalizeSmsRecipientPhone(value: string, region: PhoneRegion) {
  return normalizeContactPhoneForRegion(value, region) ?? value.trim();
}

function schemaMissing(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("sms_recipient_preferences")
  );
}

export function smsConsentCommand(body: string): SmsConsentCommand {
  const keyword = body.trim().toUpperCase().replace(/[^A-Z]/g, "");

  if (OPT_OUT_KEYWORDS.has(keyword)) {
    return { keyword, status: "opted_out" };
  }

  if (OPT_IN_KEYWORDS.has(keyword)) {
    return { keyword, status: "opted_in" };
  }

  return { keyword: null, status: null };
}

export async function getSmsRecipientPreference(
  supabase: SupabaseClient,
  input: {
    phoneNumber: string;
    region?: PhoneRegion;
    workspaceId: string;
  },
) {
  const region =
    input.region ??
    (await getWorkspacePhoneRegion(supabase, input.workspaceId));
  const normalizedPhone = normalizeSmsRecipientPhone(input.phoneNumber, region);
  const { data, error } = await supabase
    .from("sms_recipient_preferences")
    .select("consent_status,opt_out_keyword,opted_out_at,phone_number")
    .eq("workspace_id", input.workspaceId)
    .eq("normalized_phone", normalizedPhone)
    .maybeSingle();

  if (error) {
    if (schemaMissing(error)) {
      return null;
    }

    throw new Error(`Unable to load SMS consent state: ${error.message}`);
  }

  return (data ?? null) as SmsPreferenceRow | null;
}

export async function assertSmsSendAllowed(
  supabase: SupabaseClient,
  input: {
    phoneNumber: string;
    region?: PhoneRegion;
    workspaceId: string;
  },
) {
  const preference = await getSmsRecipientPreference(supabase, input);
  const status = textValue(preference?.consent_status);

  if (status === "opted_out" || status === "blocked") {
    throw new Error(
      `SMS is blocked for ${preference?.phone_number ?? input.phoneNumber} because the recipient is ${status.replace("_", " ")}.`,
    );
  }

  return preference;
}

export async function recordSmsRecipientPreference(
  supabase: SupabaseClient,
  input: {
    channelNumberId?: string | null;
    consentNote?: string | null;
    contactId?: string | null;
    keyword?: string | null;
    metadata?: Record<string, unknown>;
    phoneNumber: string;
    region?: PhoneRegion;
    source: string;
    status?: SmsConsentStatus | null;
    timestamp?: string;
    touch: "inbound" | "outbound";
    workspaceId: string;
  },
) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const region =
    input.region ??
    (await getWorkspacePhoneRegion(supabase, input.workspaceId));
  const normalizedPhone = normalizeSmsRecipientPhone(input.phoneNumber, region);
  const existing = await getSmsRecipientPreference(supabase, {
    phoneNumber: input.phoneNumber,
    region,
    workspaceId: input.workspaceId,
  });
  const activityPatch = {
    channel_number_id: input.channelNumberId ?? null,
    consent_note: input.consentNote ?? null,
    contact_id: input.contactId ?? null,
    ...(input.touch === "inbound" ? { last_inbound_at: timestamp } : {}),
    ...(input.touch === "outbound" ? { last_outbound_at: timestamp } : {}),
    metadata: input.metadata ?? {},
    normalized_phone: normalizedPhone,
    phone_number: input.phoneNumber,
    source: input.source,
    workspace_id: input.workspaceId,
  };

  if (!input.status && existing) {
    const { error } = await supabase
      .from("sms_recipient_preferences")
      .update(activityPatch)
      .eq("workspace_id", input.workspaceId)
      .eq("normalized_phone", normalizedPhone);

    if (error) {
      if (schemaMissing(error)) {
        return;
      }

      throw new Error(`Unable to record SMS activity: ${error.message}`);
    }

    return;
  }

  const status = input.status ?? "unknown";
  const payload = {
    ...activityPatch,
    consent_status: status,
    opt_out_keyword: input.keyword ?? existing?.opt_out_keyword ?? null,
    opted_in_at: status === "opted_in" ? timestamp : null,
    opted_out_at:
      status === "opted_out" || status === "blocked" ? timestamp : null,
  };
  const { error } = await supabase.from("sms_recipient_preferences").upsert(
    payload,
    {
      onConflict: "workspace_id,normalized_phone",
    },
  );

  if (error) {
    if (schemaMissing(error)) {
      return;
    }

    throw new Error(`Unable to record SMS consent state: ${error.message}`);
  }
}
