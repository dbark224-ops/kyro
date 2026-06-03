import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "../crm/identity";

export const TWILIO_PROVIDER = "twilio";
export const TWILIO_SMS_SERVICE = "programmable_messaging";
export const TWILIO_SMS_WEBHOOK_PATH = "/api/integrations/twilio/sms";
export const TWILIO_STATUS_WEBHOOK_PATH = "/api/integrations/twilio/status";

const DEFAULT_SMS_MARKUP_RATE = 0.25;

type TwilioConfig = {
  accountSid: string;
  appUrl: string | null;
  authToken: string;
  defaultFromNumber: string | null;
  messagingServiceSid: string | null;
};

export type TwilioWorkspacePhoneNumber = {
  id: string;
  phoneNumber: string;
  normalizedPhone: string;
  friendlyName: string | null;
  providerPhoneNumberId: string | null;
  countryCode: string | null;
  region: string | null;
  capabilities: {
    sms?: boolean;
    voice?: boolean;
    mms?: boolean;
  };
  status: string;
  monthlyCostSnapshot: number;
  currency: string;
  purchasedAt: string | null;
};

export type TwilioTelephonyOverview = {
  configured: boolean;
  defaultFromNumber: string | null;
  error: string | null;
  inboundSmsWebhookUrl: string | null;
  migrationReady: boolean;
  numbers: TwilioWorkspacePhoneNumber[];
  statusCallbackUrl: string | null;
  messagingServiceSidConfigured: boolean;
};

export type TwilioSmsSendResult = {
  accountSid: string | null;
  direction: string | null;
  messageId: string;
  numSegments: number | null;
  price: number | null;
  priceUnit: string | null;
  providerRequestId: string | null;
  service: typeof TWILIO_SMS_SERVICE;
  status: string | null;
  to: string;
};

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

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? null;
}

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid || !authToken) {
    return null;
  }

  return {
    accountSid,
    appUrl: appUrl(),
    authToken,
    defaultFromNumber: textValue(process.env.TWILIO_VOICE_NUMBER),
    messagingServiceSid: textValue(process.env.TWILIO_MESSAGING_SERVICE_SID),
  };
}

export function twilioConfigured() {
  return Boolean(getTwilioConfig());
}

function webhookUrl(path: string) {
  const baseUrl = appUrl();

  return baseUrl ? `${baseUrl}${path}` : null;
}

function tableMissing(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "42P01" ||
    Boolean(
      error?.message?.toLowerCase().includes("workspace_phone_numbers"),
    )
  );
}

function normalizePhoneNumber(value: string, defaultRegion: PhoneRegion = "AU") {
  return normalizeContactPhoneForRegion(value, defaultRegion) ?? value.trim();
}

function toCapabilities(value: unknown) {
  const record = objectRecord(value);

  return {
    mms: Boolean(record.mms),
    sms: Boolean(record.sms),
    voice: Boolean(record.voice),
  };
}

function toWorkspacePhoneNumber(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    capabilities: toCapabilities(row.capabilities),
    countryCode: textValue(row.country_code),
    currency: textValue(row.currency) ?? "USD",
    friendlyName: textValue(row.friendly_name),
    monthlyCostSnapshot: numberValue(row.monthly_cost_snapshot) ?? 0,
    normalizedPhone: String(row.normalized_phone),
    phoneNumber: String(row.phone_number),
    providerPhoneNumberId: textValue(row.provider_phone_number_id),
    purchasedAt: textValue(row.purchased_at),
    region: textValue(row.region),
    status: textValue(row.status) ?? "active",
  } satisfies TwilioWorkspacePhoneNumber;
}

export async function getTwilioTelephonyOverview(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<TwilioTelephonyOverview> {
  const config = getTwilioConfig();
  const { data, error } = await supabase
    .from("workspace_phone_numbers")
    .select(
      "id,phone_number,normalized_phone,friendly_name,provider_phone_number_id,country_code,region,capabilities,status,monthly_cost_snapshot,currency,purchased_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", TWILIO_PROVIDER)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      configured: Boolean(config),
      defaultFromNumber: config?.defaultFromNumber ?? null,
      error: tableMissing(error) ? null : error.message,
      inboundSmsWebhookUrl: webhookUrl(TWILIO_SMS_WEBHOOK_PATH),
      migrationReady: !tableMissing(error),
      numbers: [],
      statusCallbackUrl: webhookUrl(TWILIO_STATUS_WEBHOOK_PATH),
      messagingServiceSidConfigured: Boolean(config?.messagingServiceSid),
    };
  }

  return {
    configured: Boolean(config),
    defaultFromNumber: config?.defaultFromNumber ?? null,
    error: null,
    inboundSmsWebhookUrl: webhookUrl(TWILIO_SMS_WEBHOOK_PATH),
    migrationReady: true,
    numbers: ((data ?? []) as Record<string, unknown>[]).map(
      toWorkspacePhoneNumber,
    ),
    statusCallbackUrl: webhookUrl(TWILIO_STATUS_WEBHOOK_PATH),
    messagingServiceSidConfigured: Boolean(config?.messagingServiceSid),
  };
}

export async function getActiveWorkspaceSmsNumber(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_phone_numbers")
    .select(
      "id,phone_number,normalized_phone,friendly_name,provider_phone_number_id,country_code,region,capabilities,status,monthly_cost_snapshot,currency,purchased_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", TWILIO_PROVIDER)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    if (tableMissing(error)) {
      return null;
    }

    throw new Error(`Unable to load workspace SMS number: ${error.message}`);
  }

  const numbers = ((data ?? []) as Record<string, unknown>[]).map(
    toWorkspacePhoneNumber,
  );

  return (
    numbers.find((number) => number.capabilities.sms) ?? numbers[0] ?? null
  );
}

export async function findWorkspaceNumberForInboundSms(
  supabase: SupabaseClient,
  rawToNumber: string,
) {
  const normalized = normalizePhoneNumber(rawToNumber);
  const { data, error } = await supabase
    .from("workspace_phone_numbers")
    .select(
      "id,workspace_id,phone_number,normalized_phone,friendly_name,provider_phone_number_id,country_code,region,capabilities,status,monthly_cost_snapshot,currency,purchased_at",
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

    throw new Error(`Unable to match inbound SMS number: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    ...toWorkspacePhoneNumber(data as Record<string, unknown>),
    workspaceId: String(data.workspace_id),
  };
}

export async function findOrCreateTwilioSmsChannel(
  supabase: SupabaseClient,
  input: {
    phoneNumber: string;
    providerPhoneNumberId?: string | null;
    workspaceId: string;
  },
) {
  const externalId = `twilio:sms:${
    input.providerPhoneNumberId ?? normalizePhoneNumber(input.phoneNumber)
  }`;
  const payload = {
    workspace_id: input.workspaceId,
    type: "sms",
    display_name: `Twilio SMS - ${input.phoneNumber}`,
    external_id: externalId,
    status: "active",
    settings: {
      provider: TWILIO_PROVIDER,
      service: TWILIO_SMS_SERVICE,
      phoneNumber: input.phoneNumber,
      providerPhoneNumberId: input.providerPhoneNumberId ?? null,
      dryRunOnly: false,
      externalSendEnabled: true,
    },
  };
  const { data: existingChannel, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to load Twilio SMS channel: ${existingError.message}`,
    );
  }

  if (existingChannel) {
    const { error } = await supabase
      .from("channels")
      .update(payload)
      .eq("workspace_id", input.workspaceId)
      .eq("id", existingChannel.id);

    if (error) {
      throw new Error(`Unable to update Twilio SMS channel: ${error.message}`);
    }

    return String(existingChannel.id);
  }

  const { data: channel, error } = await supabase
    .from("channels")
    .insert(payload)
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(
      `Unable to create Twilio SMS channel: ${
        error?.message ?? "unknown error"
      }`,
    );
  }

  return String(channel.id);
}

export function telephonyUsageCost(input: {
  direction: "inbound" | "outbound";
  kind: "sms" | "number_rental" | "voice_call";
  providerPrice?: number | null;
  providerCurrency?: string | null;
}) {
  const envCost =
    input.kind === "sms" && input.direction === "outbound"
      ? numberValue(process.env.TWILIO_SMS_OUTBOUND_UNIT_COST_USD)
      : input.kind === "sms" && input.direction === "inbound"
        ? numberValue(process.env.TWILIO_SMS_INBOUND_UNIT_COST_USD)
        : input.kind === "voice_call"
          ? numberValue(process.env.TWILIO_VOICE_UNIT_COST_USD)
          : numberValue(process.env.TWILIO_NUMBER_MONTHLY_COST_USD);
  const providerCost = Math.max(0, input.providerPrice ?? envCost ?? 0);
  const markup = Math.max(
    0,
    numberValue(process.env.TWILIO_MARKUP_RATE) ?? DEFAULT_SMS_MARKUP_RATE,
  );
  const customerCharge = providerCost * (1 + markup);

  return {
    cost: providerCost,
    currency: input.providerCurrency ?? "USD",
    customerCharge,
    markup,
  };
}

export async function sendTwilioSmsMessage(input: {
  body: string;
  from: string | null;
  statusCallbackUrl?: string | null;
  to: string;
}): Promise<TwilioSmsSendResult> {
  const config = getTwilioConfig();

  if (!config) {
    throw new Error(
      "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
    );
  }

  const body = input.body.trim();
  const to = input.to.trim();
  const from = input.from?.trim() ?? config.defaultFromNumber;

  if (!body) {
    throw new Error("Unable to send SMS because the message body is empty.");
  }

  if (!to) {
    throw new Error("Unable to send SMS because the recipient is empty.");
  }

  if (!from && !config.messagingServiceSid) {
    throw new Error(
      "Unable to send SMS because no Twilio sender number or messaging service is configured.",
    );
  }

  const form = new URLSearchParams({
    Body: body,
    To: to,
  });

  if (config.messagingServiceSid) {
    form.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (from) {
    form.set("From", from);
  }

  if (input.statusCallbackUrl) {
    form.set("StatusCallback", input.statusCallbackUrl);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      body: form,
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${config.accountSid}:${config.authToken}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
  );
  const requestId = response.headers.get("twilio-request-id");
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const message =
      textValue(payload.message) ??
      textValue(payload.error_message) ??
      `Twilio SMS send failed with HTTP ${response.status}.`;

    throw new Error(message);
  }

  return {
    accountSid: textValue(payload.account_sid),
    direction: textValue(payload.direction),
    messageId: textValue(payload.sid) ?? "",
    numSegments: numberValue(payload.num_segments),
    price: numberValue(payload.price),
    priceUnit: textValue(payload.price_unit),
    providerRequestId: requestId,
    service: TWILIO_SMS_SERVICE,
    status: textValue(payload.status),
    to,
  };
}

export function twilioWebhookCanonicalUrl(request: Request) {
  const configuredAppUrl = appUrl();
  const requestUrl = new URL(request.url);

  if (configuredAppUrl) {
    return `${configuredAppUrl}${requestUrl.pathname}${requestUrl.search}`;
  }

  return request.url;
}

function withWwwAlias(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname;

  if (host.startsWith("www.")) {
    parsed.hostname = host.slice(4);

    return parsed.toString();
  }

  parsed.hostname = `www.${host}`;

  return parsed.toString();
}

export function twilioWebhookCanonicalUrlCandidates(request: Request) {
  const requestUrl = new URL(request.url);
  const configuredAppUrl = appUrl();
  const candidates = new Set<string>();
  const addCandidate = (url: string | null) => {
    if (!url) {
      return;
    }

    candidates.add(url);

    try {
      candidates.add(withWwwAlias(url));
    } catch {
      // Ignore malformed aliases. The direct URL remains in the candidate set.
    }
  };

  addCandidate(request.url);

  if (configuredAppUrl) {
    addCandidate(
      `${configuredAppUrl}${requestUrl.pathname}${requestUrl.search}`,
    );
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.trim() ??
    requestUrl.protocol.replace(/:$/, "");

  if (forwardedHost) {
    addCandidate(
      `${forwardedProto}://${forwardedHost}${requestUrl.pathname}${requestUrl.search}`,
    );
  }

  return [...candidates];
}

export function validateTwilioWebhookSignature(input: {
  authToken?: string | null;
  params: Record<string, string>;
  signature?: string | null;
  url: string;
}) {
  const authToken = input.authToken?.trim();
  const signature = input.signature?.trim();

  if (!authToken || !signature) {
    return false;
  }

  const payload = Object.keys(input.params)
    .sort()
    .reduce((current, key) => `${current}${key}${input.params[key]}`, input.url);
  const expected = createHmac("sha1", authToken)
    .update(payload)
    .digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function twilioWebhookResponse() {
  return new Response("<Response></Response>", {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}
