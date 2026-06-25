import type { SettingsSection } from "./settings-shell";

export type IntegrationSettingsPanel =
  | "inbound-email"
  | "outbound"
  | "phone-sms"
  | "stripe"
  | "google"
  | "microsoft";

export function normalizeSettingsSection(
  value: string | undefined,
): SettingsSection | null {
  if (
    value === "communication" ||
    value === "google" ||
    value === "microsoft" ||
    value === "integrations"
  ) {
    return "integrations" satisfies SettingsSection;
  }

  if (value === "general" || value === "usage" || value === "voice") {
    return value satisfies SettingsSection;
  }

  if (value === "developer") {
    return value satisfies SettingsSection;
  }

  return null;
}

export function settingsSectionHref(
  section: SettingsSection,
  activeWindow = "30d",
) {
  const params = new URLSearchParams({ section });

  if (section === "usage" && activeWindow !== "30d") {
    params.set("window", activeWindow);
  }

  return `/settings?${params.toString()}`;
}

export function settingsPanelHref(
  section: SettingsSection,
  panel: string,
  activeWindow = "30d",
  extra?: Record<string, string>,
) {
  const params = new URLSearchParams({ section, panel });

  if (section === "usage" && activeWindow !== "30d") {
    params.set("window", activeWindow);
  }

  Object.entries(extra ?? {}).forEach(([key, value]) => {
    params.set(key, value);
  });

  return `/settings?${params.toString()}`;
}

export function defaultSettingsPanel(section: SettingsSection | null) {
  switch (section) {
    case "general":
      return "business";
    case "integrations":
      return "inbound-email";
    case "usage":
      return "usage-summary";
    case "voice":
      return "voice-assistant";
    case "developer":
      return "developer-tools";
    default:
      return null;
  }
}

export function normalizeIntegrationPanel(
  value: string | null,
): IntegrationSettingsPanel {
  if (
    value === "outbound" ||
    value === "phone-sms" ||
    value === "stripe" ||
    value === "google" ||
    value === "microsoft"
  ) {
    return value;
  }

  return "inbound-email";
}

export function usageWindowHref(window: string) {
  const params = new URLSearchParams({ section: "usage" });

  if (window !== "30d") {
    params.set("window", window);
  }

  return `/settings?${params.toString()}`;
}
