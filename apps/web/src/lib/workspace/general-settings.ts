import {
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  normalizeDisplayCurrency,
  normalizeDisplayCurrencyProvider,
  type DisplayCurrency,
  type DisplayCurrencyProvider,
} from "../billing/display-currency";
import {
  INBOUND_EMAIL_POLICY_TYPE,
  normalizeInboundEmailSettings,
} from "../integrations/inbound-email-settings";
import {
  DEFAULT_PHONE_REGION,
  normalizePhoneRegion,
  type PhoneRegion,
} from "../crm/identity";
import type { SupabaseClient } from "@supabase/supabase-js";

export const WORKSPACE_GENERAL_POLICY_TYPE = "workspace_general";

export type WorkspaceGeneralSettings = {
  defaultPhoneRegion: PhoneRegion;
  displayCurrency: DisplayCurrency;
  exchangeRateProvider: DisplayCurrencyProvider;
  exchangeRateUpdatedAt: string | null;
  timeZone: string;
};

export const DEFAULT_WORKSPACE_GENERAL_SETTINGS: WorkspaceGeneralSettings = {
  ...DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  defaultPhoneRegion: DEFAULT_PHONE_REGION,
  timeZone: defaultTimeZone(),
};

function defaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeTimeZone(
  value: unknown,
  fallback = defaultTimeZone(),
) {
  const timeZone = textValue(value) ?? fallback;

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());

    return timeZone;
  } catch {
    return fallback;
  }
}

export function normalizeWorkspaceGeneralSettings(
  value: unknown,
  fallback: Partial<WorkspaceGeneralSettings> = {},
): WorkspaceGeneralSettings {
  const settings = objectRecord(value);
  const fallbackDisplayCurrency =
    fallback.displayCurrency ??
    DEFAULT_WORKSPACE_GENERAL_SETTINGS.displayCurrency;

  return {
    displayCurrency: normalizeDisplayCurrency(
      settings.displayCurrency,
      fallbackDisplayCurrency,
    ),
    exchangeRateProvider: normalizeDisplayCurrencyProvider(
      settings.exchangeRateProvider ?? fallback.exchangeRateProvider,
    ),
    exchangeRateUpdatedAt:
      textValue(settings.exchangeRateUpdatedAt) ??
      fallback.exchangeRateUpdatedAt ??
      DEFAULT_WORKSPACE_GENERAL_SETTINGS.exchangeRateUpdatedAt,
    defaultPhoneRegion: normalizePhoneRegion(
      textValue(settings.defaultPhoneRegion),
      fallback.defaultPhoneRegion ??
        DEFAULT_WORKSPACE_GENERAL_SETTINGS.defaultPhoneRegion,
    ),
    timeZone: normalizeTimeZone(
      settings.timeZone,
      fallback.timeZone ?? DEFAULT_WORKSPACE_GENERAL_SETTINGS.timeZone,
    ),
  };
}

export async function getWorkspaceGeneralSettings(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const [generalPolicy, inboundPolicy] = await Promise.all([
    supabase
      .from("workspace_policies")
      .select("settings")
      .eq("workspace_id", workspaceId)
      .eq("policy_type", WORKSPACE_GENERAL_POLICY_TYPE)
      .maybeSingle(),
    supabase
      .from("workspace_policies")
      .select("settings")
      .eq("workspace_id", workspaceId)
      .eq("policy_type", INBOUND_EMAIL_POLICY_TYPE)
      .maybeSingle(),
  ]);

  if (generalPolicy.error) {
    throw new Error(
      `Unable to load workspace defaults: ${generalPolicy.error.message}`,
    );
  }

  if (inboundPolicy.error) {
    throw new Error(
      `Unable to load workspace timezone fallback: ${inboundPolicy.error.message}`,
    );
  }

  const inboundSettings = normalizeInboundEmailSettings(
    inboundPolicy.data?.settings,
  );

  return normalizeWorkspaceGeneralSettings(generalPolicy.data?.settings, {
    timeZone: inboundSettings.timeZone,
  });
}
