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
  businessProfile: WorkspaceBusinessProfileSettings;
  defaultPhoneRegion: PhoneRegion;
  displayCurrency: DisplayCurrency;
  exchangeRateProvider: DisplayCurrencyProvider;
  exchangeRateUpdatedAt: string | null;
  timeZone: string;
};

export type WorkspaceBusinessProfileSettings = {
  brandAccentColor: string;
  brandPrimaryColor: string;
  brandStyle: string;
  businessAddress: string;
  businessName: string;
  contactHours: string;
  emergencyJobsEnabled: boolean;
  emergencyRateNotes: string;
  industry: string;
  logoContentBase64: string;
  logoContentType: string;
  logoFilename: string;
  logoSizeBytes: number;
  logoUrl: string;
  logoWidthPx: number;
  publicEmail: string;
  publicPhoneNumber: string;
  serviceArea: string;
  servicePostcodes: string;
  serviceSuburbs: string;
  staffCount: number | null;
  travelRadiusKm: number | null;
  workingHours: string;
};

export type WorkspaceGeneralSettingsFallback = Partial<
  Omit<WorkspaceGeneralSettings, "businessProfile">
> & {
  businessProfile?: Partial<WorkspaceBusinessProfileSettings>;
};

export const DEFAULT_WORKSPACE_BUSINESS_PROFILE_SETTINGS: WorkspaceBusinessProfileSettings =
  {
    brandAccentColor: "#ec3c96",
    brandPrimaryColor: "#36d7f4",
    brandStyle: "",
    businessAddress: "",
    businessName: "",
    contactHours: "",
    emergencyJobsEnabled: false,
    emergencyRateNotes: "",
    industry: "",
    logoContentBase64: "",
    logoContentType: "",
    logoFilename: "",
    logoSizeBytes: 0,
    logoUrl: "",
    logoWidthPx: 120,
    publicEmail: "",
    publicPhoneNumber: "",
    serviceArea: "",
    servicePostcodes: "",
    serviceSuburbs: "",
    staffCount: null,
    travelRadiusKm: null,
    workingHours: "",
  };

export const DEFAULT_WORKSPACE_GENERAL_SETTINGS: WorkspaceGeneralSettings = {
  ...DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  businessProfile: DEFAULT_WORKSPACE_BUSINESS_PROFILE_SETTINGS,
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

function cappedTextValue(value: unknown, fallback = "", maxLength = 1200) {
  const text = textValue(value);

  return (text ?? fallback).slice(0, maxLength);
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

function nullablePositiveInteger(value: unknown) {
  const parsed = numberValue(value);

  if (parsed === null || parsed < 0) {
    return null;
  }

  return Math.round(parsed);
}

function normalizeHexColor(value: unknown, fallback: string) {
  const color = textValue(value);

  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function clampLogoWidth(value: unknown, fallback: number) {
  const parsed = numberValue(value) ?? fallback;

  return Math.max(32, Math.min(320, Math.round(parsed)));
}

export function normalizeWorkspaceBusinessProfileSettings(
  value: unknown,
  fallback: Partial<WorkspaceBusinessProfileSettings> = {},
): WorkspaceBusinessProfileSettings {
  const settings = objectRecord(value);
  const defaultSettings = DEFAULT_WORKSPACE_BUSINESS_PROFILE_SETTINGS;

  return {
    brandAccentColor: normalizeHexColor(
      settings.brandAccentColor,
      fallback.brandAccentColor ?? defaultSettings.brandAccentColor,
    ),
    brandPrimaryColor: normalizeHexColor(
      settings.brandPrimaryColor,
      fallback.brandPrimaryColor ?? defaultSettings.brandPrimaryColor,
    ),
    brandStyle: cappedTextValue(
      settings.brandStyle,
      fallback.brandStyle ?? defaultSettings.brandStyle,
      1200,
    ),
    businessAddress: cappedTextValue(
      settings.businessAddress,
      fallback.businessAddress ?? defaultSettings.businessAddress,
      1000,
    ),
    businessName: cappedTextValue(
      settings.businessName,
      fallback.businessName ?? defaultSettings.businessName,
      160,
    ),
    contactHours: cappedTextValue(
      settings.contactHours,
      fallback.contactHours ?? defaultSettings.contactHours,
      600,
    ),
    emergencyJobsEnabled:
      typeof settings.emergencyJobsEnabled === "boolean"
        ? settings.emergencyJobsEnabled
        : fallback.emergencyJobsEnabled ?? defaultSettings.emergencyJobsEnabled,
    emergencyRateNotes: cappedTextValue(
      settings.emergencyRateNotes,
      fallback.emergencyRateNotes ?? defaultSettings.emergencyRateNotes,
      1000,
    ),
    industry: cappedTextValue(
      settings.industry,
      fallback.industry ?? defaultSettings.industry,
      160,
    ),
    logoContentBase64: cappedTextValue(
      settings.logoContentBase64,
      fallback.logoContentBase64 ?? defaultSettings.logoContentBase64,
      900000,
    ),
    logoContentType: cappedTextValue(
      settings.logoContentType,
      fallback.logoContentType ?? defaultSettings.logoContentType,
      120,
    ),
    logoFilename: cappedTextValue(
      settings.logoFilename,
      fallback.logoFilename ?? defaultSettings.logoFilename,
      220,
    ),
    logoSizeBytes: Math.max(
      0,
      numberValue(settings.logoSizeBytes ?? fallback.logoSizeBytes) ??
        defaultSettings.logoSizeBytes,
    ),
    logoUrl: cappedTextValue(
      settings.logoUrl,
      fallback.logoUrl ?? defaultSettings.logoUrl,
      800,
    ),
    logoWidthPx: clampLogoWidth(
      settings.logoWidthPx,
      fallback.logoWidthPx ?? defaultSettings.logoWidthPx,
    ),
    publicEmail: cappedTextValue(
      settings.publicEmail,
      fallback.publicEmail ?? defaultSettings.publicEmail,
      240,
    ),
    publicPhoneNumber: cappedTextValue(
      settings.publicPhoneNumber,
      fallback.publicPhoneNumber ?? defaultSettings.publicPhoneNumber,
      80,
    ),
    serviceArea: cappedTextValue(
      settings.serviceArea,
      fallback.serviceArea ?? defaultSettings.serviceArea,
      1600,
    ),
    servicePostcodes: cappedTextValue(
      settings.servicePostcodes,
      fallback.servicePostcodes ?? defaultSettings.servicePostcodes,
      1000,
    ),
    serviceSuburbs: cappedTextValue(
      settings.serviceSuburbs,
      fallback.serviceSuburbs ?? defaultSettings.serviceSuburbs,
      1600,
    ),
    staffCount: nullablePositiveInteger(
      settings.staffCount ?? fallback.staffCount,
    ),
    travelRadiusKm: nullablePositiveInteger(
      settings.travelRadiusKm ?? fallback.travelRadiusKm,
    ),
    workingHours: cappedTextValue(
      settings.workingHours,
      fallback.workingHours ?? defaultSettings.workingHours,
      800,
    ),
  };
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
  fallback: WorkspaceGeneralSettingsFallback = {},
): WorkspaceGeneralSettings {
  const settings = objectRecord(value);
  const fallbackDisplayCurrency =
    fallback.displayCurrency ??
    DEFAULT_WORKSPACE_GENERAL_SETTINGS.displayCurrency;

  return {
    businessProfile: normalizeWorkspaceBusinessProfileSettings(
      settings.businessProfile,
      fallback.businessProfile ??
        DEFAULT_WORKSPACE_GENERAL_SETTINGS.businessProfile,
    ),
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
  const [generalPolicy, inboundPolicy, businessProfile] = await Promise.all([
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
    supabase
      .from("business_profiles")
      .select(
        "business_name,industry,description,service_area,tone_of_voice,default_reply_instructions",
      )
      .eq("workspace_id", workspaceId)
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

  if (businessProfile.error) {
    throw new Error(
      `Unable to load business profile fallback: ${businessProfile.error.message}`,
    );
  }

  const inboundSettings = normalizeInboundEmailSettings(
    inboundPolicy.data?.settings,
  );
  const profileFallback = businessProfile.data
    ? {
        brandStyle:
          businessProfile.data.tone_of_voice ??
          businessProfile.data.default_reply_instructions ??
          "",
        businessName: businessProfile.data.business_name ?? "",
        industry: businessProfile.data.industry ?? "",
        serviceArea:
          businessProfile.data.service_area ??
          businessProfile.data.description ??
          "",
      }
    : undefined;

  return normalizeWorkspaceGeneralSettings(generalPolicy.data?.settings, {
    businessProfile: profileFallback,
    timeZone: inboundSettings.timeZone,
  });
}
