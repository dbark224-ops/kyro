import {
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  DISPLAY_CURRENCIES,
  type DisplayCurrencySettings,
} from "../../lib/billing/display-currency";
import type {
  CommunicationSettings,
  EmailSignatureSettings,
} from "../../lib/communication/settings";
import {
  hasGoogleScope,
  type GoogleIntegrationOverview,
} from "../../lib/integrations/google";
import type { WorkspacePhoneNumberPoolRow } from "../../lib/voice/phone-number-pool";
import type { WorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import { InfoBubble } from "./info-bubble";
/**
 * The pieces more than one Settings section needs.
 *
 * settings/page.tsx was 6,311 lines holding every section of the Settings
 * screen. These are the helpers and small components used by two or more of
 * them, lifted first so each section can move out without importing back from
 * the page and forming a cycle.
 */

export function isVoicemailOverflowPhoneNumber(number: WorkspacePhoneNumberPoolRow) {
  const purpose =
    number.metadata.voicePurpose ?? number.metadata.purpose ?? null;

  return purpose === "voicemail_overflow";
}

export function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function defaultAiAssistantSignatureText({
  businessName,
  publicPhoneNumber,
}: {
  businessName: string;
  publicPhoneNumber: string;
}) {
  return [
    "Kind Regards, Kyro.",
    `AI Assistant | ${businessName}`,
    publicPhoneNumber,
  ]
    .filter(Boolean)
    .join("\n");
}

export function aiAssistantSignatureForEditor({
  communicationSettings,
  defaultPublicPhone,
  profile,
  workspaceName,
}: {
  communicationSettings: CommunicationSettings;
  defaultPublicPhone: string;
  profile: WorkspaceGeneralSettings["businessProfile"];
  workspaceName: string;
}): EmailSignatureSettings {
  const defaultText = defaultAiAssistantSignatureText({
    businessName: profile.businessName || workspaceName || "Your business",
    publicPhoneNumber: profile.publicPhoneNumber || defaultPublicPhone,
  });
  const aiText = communicationSettings.aiGeneratedSignature.text.trim();
  const manualText = communicationSettings.manualSignature.text.trim();
  const shouldUseDefault =
    !aiText ||
    (!communicationSettings.useSeparateAiSignature && aiText === manualText);

  return shouldUseDefault
    ? {
        ...communicationSettings.aiGeneratedSignature,
        text: defaultText,
      }
    : communicationSettings.aiGeneratedSignature;
}

export function formatDate(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatTimeOfDay(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hour, minute));
}

export function SettingCardHeading({
  children,
  info,
  infoPlacement,
}: Readonly<{
  children: React.ReactNode;
  info: React.ReactNode;
  infoPlacement?: "left" | "right";
}>) {
  return (
    <div className="setting-card-heading">
      <strong>{children}</strong>
      <InfoBubble placement={infoPlacement}>{info}</InfoBubble>
    </div>
  );
}

export function googlePermissionActive(
  overview: GoogleIntegrationOverview,
  scope: string,
) {
  return overview.connections.some(
    (connection) =>
      connection.status === "connected" &&
      hasGoogleScope(connection.scopes, scope),
  );
}

export type ProviderConnection = {
  accountEmail: string | null;
  accountName: string | null;
  lastCheckedAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  scopes: string[];
  status: string;
};

export type EmailProviderConnection = ProviderConnection & {
  provider: "google" | "microsoft";
  providerLabel: string;
  requiredReadScope: string;
};

export function connectionName(
  connection: ProviderConnection | null,
  fallback: string,
) {
  return connection?.accountEmail ?? connection?.accountName ?? fallback;
}

export function hasRequiredReadScope(connection: EmailProviderConnection) {
  if (connection.provider === "google") {
    return connection.scopes.includes(connection.requiredReadScope);
  }

  const requested = connection.requiredReadScope.toLowerCase();

  return connection.scopes.some((scope) => {
    const normalized = scope.toLowerCase();

    return normalized === requested || normalized.endsWith(`/${requested}`);
  });
}

export function missingReadScope(connection: EmailProviderConnection) {
  return hasRequiredReadScope(connection) ? null : connection.requiredReadScope;
}

export function isReconnectError(value: string | null) {
  return Boolean(value?.toLowerCase().includes("reconnect"));
}

export function connectionNeedsReconnect(connection: EmailProviderConnection) {
  return Boolean(
    missingReadScope(connection) || isReconnectError(connection.lastError),
  );
}

export function scopeLabel(value: string) {
  return value
    .replace("https://www.googleapis.com/auth/", "")
    .replace("https://graph.microsoft.com/", "");
}

export function invoiceDisplayCurrencySettings(
  currency: string,
): DisplayCurrencySettings {
  const displayCurrency = DISPLAY_CURRENCIES.includes(
    currency.toUpperCase() as (typeof DISPLAY_CURRENCIES)[number],
  )
    ? (currency.toUpperCase() as (typeof DISPLAY_CURRENCIES)[number])
    : DEFAULT_DISPLAY_CURRENCY_SETTINGS.displayCurrency;

  return {
    ...DEFAULT_DISPLAY_CURRENCY_SETTINGS,
    displayCurrency,
  };
}
