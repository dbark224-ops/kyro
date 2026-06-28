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
  contactHoursSchedule: BusinessHoursScheduleSettings;
  emergencyAfterHoursRate: string;
  emergencyAvailabilityMode: string;
  emergencyDays: string;
  emergencyEndTime: string;
  emergencyJobsEnabled: boolean;
  emergencyRateNotes: string;
  emergencyStartTime: string;
  industry: string;
  logoContentBase64: string;
  logoContentType: string;
  logoFilename: string;
  logoSizeBytes: number;
  logoUrl: string;
  logoWidthPx: number;
  operatingCountry: string;
  publicEmail: string;
  publicPhoneNumber: string;
  serviceArea: string;
  servicePostcodes: string;
  serviceSuburbs: string;
  fieldStaffContactIds: string[];
  staffCount: number | null;
  travelRadiusKm: number | null;
  urgentEscalation: UrgentEscalationSettings;
  workplaceContacts: WorkplaceContactSettings[];
  workingHours: string;
  workingHoursSchedule: BusinessHoursScheduleSettings;
};

export const BUSINESS_HOUR_DAYS = [
  { key: "monday", label: "Monday", shortLabel: "Mon" },
  { key: "tuesday", label: "Tuesday", shortLabel: "Tue" },
  { key: "wednesday", label: "Wednesday", shortLabel: "Wed" },
  { key: "thursday", label: "Thursday", shortLabel: "Thu" },
  { key: "friday", label: "Friday", shortLabel: "Fri" },
  { key: "saturday", label: "Saturday", shortLabel: "Sat" },
  { key: "sunday", label: "Sunday", shortLabel: "Sun" },
  { key: "holidays", label: "Holidays", shortLabel: "Holidays" },
] as const;

export type BusinessHourDayKey = (typeof BUSINESS_HOUR_DAYS)[number]["key"];

export type BusinessHoursDaySettings = {
  day: BusinessHourDayKey;
  enabled: boolean;
  endTime: string;
  startTime: string;
};

export type BusinessHoursScheduleSettings = {
  days: BusinessHoursDaySettings[];
  notes: string;
};

export const WORKPLACE_CONTACT_CHANNELS = [
  "sms",
  "email",
  "phone",
  "app_notification",
] as const;

export type WorkplaceContactChannel = (typeof WORKPLACE_CONTACT_CHANNELS)[number];

export type WorkplaceContactSettings = {
  activeDays: string;
  email: string;
  id: string;
  name: string;
  notes: string;
  phoneNumber: string;
  preferredChannel: WorkplaceContactChannel;
  privatePhoneNumber: string;
  receivesEscalations: boolean;
  role: string;
  tradeSpecialty: string;
  vehicleRegistration: string;
  workingHours: string;
};

export const URGENT_ESCALATION_TRIGGER_DEFINITIONS = [
  {
    defaultEnabled: true,
    description: "The customer explicitly says urgent, emergency, ASAP, or same-day critical.",
    key: "explicit_urgency",
    label: "Customer says it is urgent",
  },
  {
    defaultEnabled: true,
    description: "Burst pipes, flooding, roof leaks, water through ceilings, or active damage.",
    key: "active_property_damage",
    label: "Active property damage",
  },
  {
    defaultEnabled: true,
    description: "Gas, electrical danger, fire risk, injury, unsafe structure, or similar safety risk.",
    key: "safety_risk",
    label: "Safety risk",
  },
  {
    defaultEnabled: true,
    description: "A previous or current customer says completed work is failing or causing damage.",
    key: "existing_job_serious_issue",
    label: "Existing job serious issue",
  },
  {
    defaultEnabled: true,
    description: "Refund, complaint, legal, regulator, bad review, or highly unhappy customer language.",
    key: "complaint_or_reputation_risk",
    label: "Complaint or reputation risk",
  },
  {
    defaultEnabled: true,
    description: "The same person tries multiple channels or contacts repeatedly within a short window.",
    key: "repeat_contact_short_window",
    label: "Repeat contact pressure",
  },
  {
    defaultEnabled: true,
    description: "Urgent-looking inquiry outside the normal work/contact window.",
    key: "after_hours_emergency",
    label: "After-hours emergency inquiry",
  },
  {
    defaultEnabled: false,
    description: "Commercial, renovation, insurance, emergency callout, or other likely high-value work.",
    key: "high_value_lead",
    label: "High-value lead",
  },
  {
    defaultEnabled: false,
    description: "No hot water, no heating, no power, access issue, or vulnerable customer impact.",
    key: "essential_service_outage",
    label: "Essential service outage",
  },
  {
    defaultEnabled: false,
    description: "A customer marked as important or VIP contacts the business.",
    key: "vip_customer",
    label: "VIP customer",
  },
  {
    defaultEnabled: false,
    description: "A known customer calls and the call is missed or reaches voicemail overflow.",
    key: "missed_known_customer_call",
    label: "Missed call from known customer",
  },
  {
    defaultEnabled: false,
    description: "The customer asks for the owner, boss, or tradie to call immediately.",
    key: "asks_for_owner_now",
    label: "Customer asks for owner now",
  },
] as const;

export type UrgentEscalationTriggerKey =
  (typeof URGENT_ESCALATION_TRIGGER_DEFINITIONS)[number]["key"];

export const URGENT_ESCALATION_HOURS_MODES = [
  "always",
  "business_hours",
  "after_hours",
  "custom",
] as const;

export type UrgentEscalationHoursMode =
  (typeof URGENT_ESCALATION_HOURS_MODES)[number];

export type UrgentEscalationStepSettings = {
  channel: WorkplaceContactChannel;
  contactId: string;
  delayMinutes: number;
  id: string;
};

export type UrgentEscalationSettings = {
  customDays: string;
  customEndTime: string;
  customStartTime: string;
  enabled: boolean;
  hoursMode: UrgentEscalationHoursMode;
  requireAcknowledgement: boolean;
  steps: UrgentEscalationStepSettings[];
  triggerKeys: UrgentEscalationTriggerKey[];
};

export type WorkspaceGeneralSettingsFallback = Partial<
  Omit<WorkspaceGeneralSettings, "businessProfile">
> & {
  businessProfile?: Partial<WorkspaceBusinessProfileSettings>;
};

function defaultBusinessHoursSchedule(): BusinessHoursScheduleSettings {
  return {
    days: BUSINESS_HOUR_DAYS.map((day) => ({
      day: day.key,
      enabled: ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(
        day.key,
      ),
      endTime: "16:00",
      startTime: "07:00",
    })),
    notes: "",
  };
}

export const DEFAULT_WORKSPACE_BUSINESS_PROFILE_SETTINGS: WorkspaceBusinessProfileSettings =
  {
    brandAccentColor: "#ec3c96",
    brandPrimaryColor: "#36d7f4",
    brandStyle: "",
    businessAddress: "",
    businessName: "",
    contactHours: "",
    contactHoursSchedule: defaultBusinessHoursSchedule(),
    emergencyAfterHoursRate: "",
    emergencyAvailabilityMode: "specified",
    emergencyDays: "Every day",
    emergencyEndTime: "",
    emergencyJobsEnabled: false,
    emergencyRateNotes: "",
    emergencyStartTime: "",
    industry: "",
    logoContentBase64: "",
    logoContentType: "",
    logoFilename: "",
    logoSizeBytes: 0,
    logoUrl: "",
    logoWidthPx: 120,
    operatingCountry: "",
    publicEmail: "",
    publicPhoneNumber: "",
    serviceArea: "",
    servicePostcodes: "",
    serviceSuburbs: "",
    fieldStaffContactIds: [],
    staffCount: null,
    travelRadiusKm: null,
    urgentEscalation: {
      customDays: "Every day",
      customEndTime: "",
      customStartTime: "",
      enabled: true,
      hoursMode: "always",
      requireAcknowledgement: true,
      steps: [
        {
          channel: "sms",
          contactId: "primary",
          delayMinutes: 0,
          id: "default-sms-primary",
        },
        {
          channel: "phone",
          contactId: "primary",
          delayMinutes: 5,
          id: "default-call-primary",
        },
        {
          channel: "phone",
          contactId: "primary",
          delayMinutes: 10,
          id: "default-call-primary-repeat",
        },
        {
          channel: "sms",
          contactId: "fallback",
          delayMinutes: 15,
          id: "default-sms-fallback",
        },
      ],
      triggerKeys: URGENT_ESCALATION_TRIGGER_DEFINITIONS.filter(
        (trigger) => trigger.defaultEnabled,
      ).map((trigger) => trigger.key),
    },
    workplaceContacts: [],
    workingHours: "",
    workingHoursSchedule: defaultBusinessHoursSchedule(),
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

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function stableId(value: unknown, fallback: string) {
  const id = textValue(value);

  return id && /^[a-z0-9_-]{2,80}$/i.test(id) ? id : fallback;
}

function stableIdList(value: unknown): string[] {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();

  return rows
    .map((row) => stableId(row, ""))
    .filter(Boolean)
    .filter((row) => {
      if (seen.has(row)) {
        return false;
      }

      seen.add(row);
      return true;
    })
    .slice(0, 24);
}

function normalizeBusinessHourDayKey(
  value: unknown,
  fallback: BusinessHourDayKey,
): BusinessHourDayKey {
  const key = textValue(value);

  return BUSINESS_HOUR_DAYS.some((day) => day.key === key)
    ? (key as BusinessHourDayKey)
    : fallback;
}

function normalizeTimeValue(value: unknown, fallback: string) {
  const time = textValue(value);

  return time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallback;
}

function normalizeBusinessHoursSchedule(
  value: unknown,
  fallback = defaultBusinessHoursSchedule(),
): BusinessHoursScheduleSettings {
  const settings = objectRecord(value);
  const rows = Array.isArray(settings.days) ? settings.days : [];
  const fallbackDays = new Map(fallback.days.map((day) => [day.day, day]));
  const inputDays = new Map(
    rows.map((row, index) => {
      const record = objectRecord(row);
      const fallbackDay = BUSINESS_HOUR_DAYS[index]?.key ?? "monday";
      const key = normalizeBusinessHourDayKey(record.day, fallbackDay);

      return [key, record] as const;
    }),
  );

  return {
    days: BUSINESS_HOUR_DAYS.map((day) => {
      const input = inputDays.get(day.key) ?? {};
      const fallbackDay = fallbackDays.get(day.key);

      return {
        day: day.key,
        enabled: booleanValue(input.enabled, fallbackDay?.enabled ?? false),
        endTime: normalizeTimeValue(input.endTime, fallbackDay?.endTime ?? "16:00"),
        startTime: normalizeTimeValue(
          input.startTime,
          fallbackDay?.startTime ?? "07:00",
        ),
      };
    }),
    notes: cappedTextValue(settings.notes, fallback.notes, 600),
  };
}

function normalizeWorkplaceContactChannel(
  value: unknown,
  fallback: WorkplaceContactChannel = "sms",
): WorkplaceContactChannel {
  const channel = textValue(value);

  return WORKPLACE_CONTACT_CHANNELS.includes(
    channel as WorkplaceContactChannel,
  )
    ? (channel as WorkplaceContactChannel)
    : fallback;
}

function normalizeWorkplaceContacts(value: unknown): WorkplaceContactSettings[] {
  const rows = Array.isArray(value) ? value : [];

  return rows
    .slice(0, 12)
    .map((row, index) => {
      const record = objectRecord(row);

      return {
        activeDays: cappedTextValue(record.activeDays, "", 300),
        email: cappedTextValue(record.email, "", 240),
        id: stableId(record.id, `contact-${index + 1}`),
        name: cappedTextValue(record.name, "", 120),
        notes: cappedTextValue(record.notes, "", 800),
        phoneNumber: cappedTextValue(record.phoneNumber, "", 80),
        preferredChannel: normalizeWorkplaceContactChannel(
          record.preferredChannel,
        ),
        privatePhoneNumber: cappedTextValue(record.privatePhoneNumber, "", 80),
        receivesEscalations: booleanValue(record.receivesEscalations, true),
        role: cappedTextValue(record.role, "", 120),
        tradeSpecialty: cappedTextValue(record.tradeSpecialty, "", 160),
        vehicleRegistration: cappedTextValue(record.vehicleRegistration, "", 80),
        workingHours: cappedTextValue(record.workingHours, "", 300),
      };
    })
    .filter(
      (contact) =>
        contact.name ||
        contact.phoneNumber ||
        contact.email ||
        contact.role ||
        contact.tradeSpecialty,
    );
}

function normalizeEscalationTriggerKeys(
  value: unknown,
): UrgentEscalationTriggerKey[] {
  const allowed = new Set(
    URGENT_ESCALATION_TRIGGER_DEFINITIONS.map((trigger) => trigger.key),
  );
  const keys = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = keys
    .map((key) => (typeof key === "string" ? key.trim() : ""))
    .filter((key): key is UrgentEscalationTriggerKey =>
      allowed.has(key as UrgentEscalationTriggerKey),
    );

  return Array.from(new Set(normalized));
}

function normalizeEscalationHoursMode(
  value: unknown,
  fallback: UrgentEscalationHoursMode = "always",
): UrgentEscalationHoursMode {
  const mode = textValue(value);

  return URGENT_ESCALATION_HOURS_MODES.includes(
    mode as UrgentEscalationHoursMode,
  )
    ? (mode as UrgentEscalationHoursMode)
    : fallback;
}

function normalizeEscalationSteps(value: unknown): UrgentEscalationStepSettings[] {
  const rows = Array.isArray(value) ? value : [];

  return rows
    .slice(0, 8)
    .map((row, index) => {
      const record = objectRecord(row);
      const delayMinutes = numberValue(record.delayMinutes);

      return {
        channel: normalizeWorkplaceContactChannel(record.channel),
        contactId: cappedTextValue(record.contactId, "primary", 80),
        delayMinutes: Math.max(
          0,
          Math.min(240, Math.round(delayMinutes ?? (index === 0 ? 0 : 5))),
        ),
        id: stableId(record.id, `step-${index + 1}`),
      };
    })
    .filter((step) => step.channel && step.contactId);
}

function normalizeUrgentEscalationSettings(
  value: unknown,
  fallback = DEFAULT_WORKSPACE_BUSINESS_PROFILE_SETTINGS.urgentEscalation,
): UrgentEscalationSettings {
  const settings = objectRecord(value);
  const steps = normalizeEscalationSteps(settings.steps);
  const triggerKeys = normalizeEscalationTriggerKeys(settings.triggerKeys);
  const hasSteps = Object.prototype.hasOwnProperty.call(settings, "steps");
  const hasTriggerKeys = Object.prototype.hasOwnProperty.call(
    settings,
    "triggerKeys",
  );

  return {
    customDays: cappedTextValue(
      settings.customDays,
      fallback.customDays,
      300,
    ),
    customEndTime: cappedTextValue(
      settings.customEndTime,
      fallback.customEndTime,
      40,
    ),
    customStartTime: cappedTextValue(
      settings.customStartTime,
      fallback.customStartTime,
      40,
    ),
    enabled: booleanValue(settings.enabled, fallback.enabled),
    hoursMode: normalizeEscalationHoursMode(settings.hoursMode, fallback.hoursMode),
    requireAcknowledgement: booleanValue(
      settings.requireAcknowledgement,
      fallback.requireAcknowledgement,
    ),
    steps: hasSteps ? steps : fallback.steps,
    triggerKeys: hasTriggerKeys ? triggerKeys : fallback.triggerKeys,
  };
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
    contactHoursSchedule: normalizeBusinessHoursSchedule(
      settings.contactHoursSchedule,
      fallback.contactHoursSchedule ?? defaultSettings.contactHoursSchedule,
    ),
    emergencyAfterHoursRate: cappedTextValue(
      settings.emergencyAfterHoursRate,
      fallback.emergencyAfterHoursRate ??
        defaultSettings.emergencyAfterHoursRate,
      160,
    ),
    emergencyAvailabilityMode: cappedTextValue(
      settings.emergencyAvailabilityMode,
      fallback.emergencyAvailabilityMode ??
        defaultSettings.emergencyAvailabilityMode,
      80,
    ),
    emergencyDays: cappedTextValue(
      settings.emergencyDays,
      fallback.emergencyDays ?? defaultSettings.emergencyDays,
      500,
    ),
    emergencyEndTime: cappedTextValue(
      settings.emergencyEndTime,
      fallback.emergencyEndTime ?? defaultSettings.emergencyEndTime,
      40,
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
    emergencyStartTime: cappedTextValue(
      settings.emergencyStartTime,
      fallback.emergencyStartTime ?? defaultSettings.emergencyStartTime,
      40,
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
    operatingCountry: cappedTextValue(
      settings.operatingCountry,
      fallback.operatingCountry ?? defaultSettings.operatingCountry,
      80,
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
    fieldStaffContactIds: stableIdList(
      settings.fieldStaffContactIds ?? fallback.fieldStaffContactIds,
    ),
    staffCount: nullablePositiveInteger(
      settings.staffCount ?? fallback.staffCount,
    ),
    travelRadiusKm: nullablePositiveInteger(
      settings.travelRadiusKm ?? fallback.travelRadiusKm,
    ),
    urgentEscalation: normalizeUrgentEscalationSettings(
      settings.urgentEscalation,
      fallback.urgentEscalation ?? defaultSettings.urgentEscalation,
    ),
    workplaceContacts: normalizeWorkplaceContacts(
      settings.workplaceContacts ?? fallback.workplaceContacts,
    ),
    workingHours: cappedTextValue(
      settings.workingHours,
      fallback.workingHours ?? defaultSettings.workingHours,
      800,
    ),
    workingHoursSchedule: normalizeBusinessHoursSchedule(
      settings.workingHoursSchedule,
      fallback.workingHoursSchedule ?? defaultSettings.workingHoursSchedule,
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
