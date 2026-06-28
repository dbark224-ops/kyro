import {
  formatCurrencyAmount,
  formatDisplayMoney,
} from "../../lib/billing/display-currency";
import {
  elevenLabsVoicePresetById,
  type VoiceSettings,
} from "../../lib/assistant/voice-settings";
import type { UsageReport } from "../../lib/usage/queries";
import type { WorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import type {
  SettingsMenuItem,
  SettingsNestedItem,
  SettingsSection,
} from "./settings-shell";
import {
  settingsPanelHref,
  settingsSectionHref,
  type IntegrationSettingsPanel,
} from "./settings-navigation";

function formatMoney(value: number, currency: string) {
  return formatCurrencyAmount(value, currency);
}

export function buildSettingsMenuItems({
  activeWindow,
  generalSettings,
  isDeveloperAccount,
  usageReport,
  voiceSettings,
}: Readonly<{
  activeWindow: string;
  generalSettings: WorkspaceGeneralSettings | null;
  isDeveloperAccount: boolean;
  usageReport: UsageReport | null;
  voiceSettings: VoiceSettings | null;
}>): SettingsMenuItem[] {
  return [
    {
      detail: generalSettings
        ? [
            generalSettings.businessProfile.industry || "Business details",
            generalSettings.businessProfile.publicPhoneNumber ||
              "Public phone unset",
          ].join(" - ")
        : "Business, brand, service area, and defaults",
      eyebrow: "Profile",
      href: settingsSectionHref("general", activeWindow),
      section: "general",
      title: "Business profile",
    },
    {
      detail: "Accounts, outbound rules, and inbound sync",
      eyebrow: "Integrations",
      href: settingsSectionHref("integrations", activeWindow),
      section: "integrations",
      title: "Connected accounts",
    },
    {
      detail: voiceSettings
        ? `${elevenLabsVoicePresetById(voiceSettings.elevenLabsVoicePresetId).label} - ${
            voiceSettings.phoneAgentEnabled ? "Phone on" : "Phone off"
          }`
        : "Realtime, playback, and phone voice controls",
      eyebrow: "Voice",
      href: settingsSectionHref("voice", activeWindow),
      section: "voice",
      title: "Voice assistant",
    },
    {
      detail: usageReport
        ? `${usageReport.totals.events} ledger events - ${
            generalSettings
              ? formatDisplayMoney(
                  usageReport.totals.customerCharge,
                  usageReport.totals.currency,
                  generalSettings,
                )
              : formatMoney(
                  usageReport.totals.customerCharge,
                  usageReport.totals.currency,
                )
          } usage charge`
        : "Usage charge, tasks, and ledger export",
      eyebrow: "Usage",
      href: settingsSectionHref("usage", activeWindow),
      section: "usage",
      title: "Usage and billing",
    },
    ...(isDeveloperAccount
      ? [
          {
            detail: "Internal tools, diagnostics, and hidden voice controls",
            eyebrow: "Developer",
            href: settingsSectionHref("developer", activeWindow),
            section: "developer" as const,
            title: "Developer settings",
          },
        ]
      : []),
  ];
}

export function buildSettingsNestedItems({
  activeIntegrationPanel,
  activeWindow,
  selectedPanel,
  selectedSection,
}: Readonly<{
  activeIntegrationPanel: IntegrationSettingsPanel;
  activeWindow: string;
  selectedPanel: string;
  selectedSection: SettingsSection | null;
}>): SettingsNestedItem[] {
  if (selectedSection === "general") {
    return [
      {
        detail: "Name, industry, country, currency, and defaults",
        href: settingsPanelHref("general", "business", activeWindow),
        key: "business",
        selected: selectedPanel === "business",
        title: "Core profile",
      },
      {
        detail: "Public email, phone, website, and address",
        href: settingsPanelHref("general", "public-details", activeWindow),
        key: "public-details",
        selected: selectedPanel === "public-details",
        title: "Public details",
      },
      {
        detail: "Suburbs, postcodes, travel range, and country",
        href: settingsPanelHref("general", "service-area", activeWindow),
        key: "service-area",
        selected: selectedPanel === "service-area",
        title: "Service area",
      },
      {
        detail: "Working hours and standard availability",
        href: settingsPanelHref("general", "availability", activeWindow),
        key: "availability",
        selected: selectedPanel === "availability",
        title: "Availability",
      },
      {
        detail: "Logo, colours, and brand style",
        href: settingsPanelHref("general", "branding-logo", activeWindow),
        key: "branding-logo",
        selected: selectedPanel === "branding-logo",
        title: "Branding and logo",
      },
      {
        detail: "Default business email signature",
        href: settingsPanelHref("general", "email-signature", activeWindow),
        key: "email-signature",
        selected: selectedPanel === "email-signature",
        title: "Email signature",
      },
      {
        detail: "Owners, admin, tradies, and fallback people",
        href: settingsPanelHref("general", "workplace-contacts", activeWindow),
        key: "workplace-contacts",
        selected: selectedPanel === "workplace-contacts",
        title: "Workplace contacts",
      },
      {
        detail: "Triggers, channels, retries, and acknowledgement",
        href: settingsPanelHref("general", "urgent-escalation", activeWindow),
        key: "urgent-escalation",
        selected: selectedPanel === "urgent-escalation",
        title: "Urgent escalation",
      },
      {
        detail: "After-hours rates and urgent job handling",
        href: settingsPanelHref("general", "emergency-work", activeWindow),
        key: "emergency-work",
        selected: selectedPanel === "emergency-work",
        title: "Emergency work",
      },
    ];
  }

  if (selectedSection === "integrations") {
    return [
      {
        detail: "Inbound sync, health, sender rules, and logs",
        href: settingsPanelHref("integrations", "inbound-email", activeWindow),
        key: "inbound-email",
        selected: activeIntegrationPanel === "inbound-email",
        title: "Inbound email sync",
      },
      {
        detail: "Approval rules, reply style, signatures, follow-ups",
        href: settingsPanelHref("integrations", "outbound", activeWindow),
        key: "outbound",
        selected: activeIntegrationPanel === "outbound",
        title: "Outbound communication",
      },
      {
        detail: "Workspace phone number, SMS, and call setup",
        href: settingsPanelHref("integrations", "phone-sms", activeWindow),
        key: "phone-sms",
        selected: activeIntegrationPanel === "phone-sms",
        title: "Phone and SMS",
      },
      {
        detail: "Customer payment links and default invoice template",
        href: settingsPanelHref("integrations", "stripe", activeWindow),
        key: "stripe",
        selected: activeIntegrationPanel === "stripe",
        title: "Stripe payments",
      },
      {
        detail: "Connect Gmail, Google Drive, or Outlook",
        href: settingsPanelHref("integrations", "email-accounts", activeWindow),
        key: "email-accounts",
        selected: activeIntegrationPanel === "email-accounts",
        title: "Email accounts",
      },
    ];
  }

  if (selectedSection === "voice") {
    return [
      {
        detail: "Shared assistant voice and phone style",
        href: settingsPanelHref("voice", "voice-assistant", activeWindow),
        key: "voice-assistant",
        selected: selectedPanel === "voice-assistant",
        title: "Voice assistant",
      },
      {
        detail: "Inbound, outbound, overflow, and team numbers",
        href: settingsPanelHref("voice", "phone-assistant", activeWindow),
        key: "phone-assistant",
        selected: selectedPanel === "phone-assistant",
        title: "Phone assistant",
      },
      {
        detail: "Overflow routing, caller instructions, and test details",
        href: settingsPanelHref("voice", "voicemail-overflow", activeWindow),
        key: "voicemail-overflow",
        selected: selectedPanel === "voicemail-overflow",
        title: "Voicemail overflow",
      },
      {
        detail: "Names, places, acronyms, and spoken hints",
        href: settingsPanelHref("voice", "pronunciation", activeWindow),
        key: "pronunciation",
        selected: selectedPanel === "pronunciation",
        title: "Pronunciation",
      },
    ];
  }

  if (selectedSection === "usage") {
    return [
      {
        detail: "Task breakdown, timeframe, and display currency",
        href: settingsPanelHref("usage", "usage-summary", activeWindow),
        key: "usage-summary",
        selected: selectedPanel === "usage-summary",
        title: "Usage summary",
      },
      {
        detail: "Trial, card setup, and saved payment method",
        href: settingsPanelHref("usage", "payment-method", activeWindow),
        key: "payment-method",
        selected: selectedPanel === "payment-method",
        title: "Payment method",
      },
    ];
  }

  if (selectedSection === "developer") {
    return [
      {
        detail: "Internal tools and operational links",
        href: settingsPanelHref("developer", "developer-tools", activeWindow),
        key: "developer-tools",
        selected: selectedPanel === "developer-tools",
        title: "Developer tools",
      },
      {
        detail: "Legacy voice controls and provider IDs",
        href: settingsPanelHref("developer", "provider-ids", activeWindow),
        key: "provider-ids",
        selected: selectedPanel === "provider-ids",
        title: "Provider internals",
      },
    ];
  }

  return [];
}
