import { AppFrame } from "../components/app-frame";
import {
  disconnectIntegrationAction,
  createPronunciationEntryAction,
  ignorePronunciationEntryAction,
  removeInboundEmailSenderRuleSettingsAction,
  syncInboundEmailNowAction,
  updateCommunicationSettingsAction,
  updateGeneralSettingsAction,
  updateInboundEmailSettingsAction,
  updatePronunciationEntryAction,
  updateVoiceSettingsAction,
  upsertInboundEmailSenderRuleSettingsAction,
} from "./actions";
import {
  OPENAI_VOICE_OPTIONS,
  OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
  getVoiceSettings,
} from "../../lib/assistant/voice-settings";
import {
  PRONUNCIATION_CATEGORIES,
  defaultPronunciationHint,
  formatPronunciationAliases,
  getPronunciationEntries,
  type AssistantPronunciationEntry,
} from "../../lib/assistant/pronunciation";
import {
  OUTBOUND_CHANNELS,
  getCommunicationSettings,
  type EmailSignatureSettings,
} from "../../lib/communication/settings";
import {
  DISPLAY_CURRENCIES,
  displayCurrencySourceLabel,
  formatCurrencyAmount,
  formatDisplayMoney,
  type DisplayCurrencySettings,
} from "../../lib/billing/display-currency";
import {
  getUsageReport,
  normalizeUsageWindow,
  usageWindows,
  type UsageBreakdownRow,
} from "../../lib/usage/queries";
import {
  GOOGLE_PROVIDER,
  GOOGLE_GMAIL_READ_SCOPE,
  getGoogleIntegrationOverview,
} from "../../lib/integrations/google";
import {
  INBOUND_EMAIL_POLL_INTERVALS,
  INBOUND_EMAIL_QUIET_HOURS_MODES,
  INBOUND_EMAIL_SYNC_MODES,
  getInboundEmailSettings,
  type InboundEmailSenderRule,
} from "../../lib/integrations/inbound-email-settings";
import {
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_PROVIDER,
  getMicrosoftIntegrationOverview,
} from "../../lib/integrations/microsoft";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import {
  getWorkspaceGeneralSettings,
  type WorkspaceGeneralSettings,
} from "../../lib/workspace/general-settings";
import Link from "next/link";
import {
  SettingsShell,
  type SettingsMenuItem,
  type SettingsSection,
} from "./settings-shell";
import { InfoBubble } from "./info-bubble";
import { ManualSyncSubmitButton } from "./manual-sync-submit-button";
import { PronunciationPreviewPlayer } from "./pronunciation-preview-player";
import { UsageLedgerModal } from "./usage-ledger-modal";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
    section?: string;
    window?: string;
  }>;
};

function normalizeSettingsSection(value: string | undefined) {
  if (value === "google" || value === "microsoft" || value === "integrations") {
    return "integrations" satisfies SettingsSection;
  }

  if (
    value === "communication" ||
    value === "general" ||
    value === "usage" ||
    value === "voice"
  ) {
    return value satisfies SettingsSection;
  }

  return null;
}

function settingsSectionHref(section: SettingsSection, activeWindow = "30d") {
  const params = new URLSearchParams({ section });

  if (section === "usage" && activeWindow !== "30d") {
    params.set("window", activeWindow);
  }

  return `/settings?${params.toString()}`;
}

function usageWindowHref(window: string) {
  const params = new URLSearchParams({ section: "usage" });

  if (window !== "30d") {
    params.set("window", window);
  }

  return `/settings?${params.toString()}`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatMoney(value: number, currency: string) {
  return formatCurrencyAmount(value, currency);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatTimeOfDay(value: string) {
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

function policyLabel(value: string) {
  return value === "strict"
    ? "Strict"
    : value === "balanced"
      ? "Balanced"
      : value === "flexible"
        ? "Flexible"
        : "Off";
}

function pronunciationUsageLabel(entry: AssistantPronunciationEntry) {
  const usage =
    entry.usageCount === 1 ? "Used once" : `Used ${entry.usageCount} times`;

  return entry.lastSeenAt
    ? `${usage} - last ${formatDate(entry.lastSeenAt)}`
    : usage;
}

function pronunciationEntrySourceLabel(entry: AssistantPronunciationEntry) {
  return entry.source === "manual"
    ? "Manual entry"
    : entry.source === "assistant"
      ? "Assistant updated"
      : "Auto-added";
}

function pronunciationEntryPill(entry: AssistantPronunciationEntry) {
  return entry.source === "manual" || entry.source === "assistant"
    ? "Custom pronunciation"
    : "Auto pronunciation";
}

function pronunciationHintValue(entry: AssistantPronunciationEntry) {
  return entry.pronunciationHint ?? defaultPronunciationHint(entry.phrase);
}

function SettingCardHeading({
  children,
  info,
}: Readonly<{
  children: React.ReactNode;
  info: React.ReactNode;
}>) {
  return (
    <div className="setting-card-heading">
      <strong>{children}</strong>
      <InfoBubble>{info}</InfoBubble>
    </div>
  );
}

function EmailSignatureEditor({
  description,
  namePrefix,
  signature,
  title,
}: Readonly<{
  description: string;
  namePrefix: "manualSignature" | "aiGeneratedSignature";
  signature: EmailSignatureSettings;
  title: string;
}>) {
  const previewLogoSrc = signature.logoContentBase64
    ? `data:${signature.logoContentType};base64,${signature.logoContentBase64}`
    : signature.logoUrl;

  return (
    <section className="signature-editor">
      <input
        name={`${namePrefix}LogoContentBase64`}
        type="hidden"
        value={signature.logoContentBase64}
      />
      <input
        name={`${namePrefix}LogoContentType`}
        type="hidden"
        value={signature.logoContentType}
      />
      <input
        name={`${namePrefix}LogoFilename`}
        type="hidden"
        value={signature.logoFilename}
      />
      <input
        name={`${namePrefix}LogoSizeBytes`}
        type="hidden"
        value={signature.logoSizeBytes}
      />
      <div>
        <p className="eyebrow">{title}</p>
        <p>{description}</p>
      </div>

      <label className="settings-textarea">
        Signature text
        <textarea
          defaultValue={signature.text}
          name={`${namePrefix}Text`}
          placeholder={"Cheers, Dave\nKyro Plumbing\n0400 000 000"}
        />
      </label>

      <div className="settings-grid">
        <label className="setting-card">
          <SettingCardHeading
            info={
              <>
                Upload a small logo, up to 512 KB. This is sent inline with
                email signatures.
              </>
            }
          >
            Logo file
          </SettingCardHeading>
          <input accept="image/*" name={`${namePrefix}LogoFile`} type="file" />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Optional fallback if no logo file is uploaded.">
            Logo URL fallback
          </SettingCardHeading>
          <input
            defaultValue={signature.logoUrl}
            name={`${namePrefix}LogoUrl`}
            placeholder="https://example.com/logo.png"
            type="url"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Width in pixels. Kyro keeps it between 32 and 240.">
            Logo size
          </SettingCardHeading>
          <input
            defaultValue={signature.logoWidthPx}
            max={240}
            min={32}
            name={`${namePrefix}LogoWidthPx`}
            step={4}
            type="number"
          />
        </label>
      </div>

      <div className="signature-preview-card">
        <strong>Preview</strong>
        <div className="signature-preview">
          {signature.text ? (
            <p>
              {signature.text.split(/\r?\n/).map((line, index) => (
                <span key={`${line}-${index}`}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
          ) : (
            <p className="muted-copy">No signature text yet.</p>
          )}
          {previewLogoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Signature logo preview"
              src={previewLogoSrc}
              style={{ width: signature.logoWidthPx }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

type GoogleIntegrationOverview = Awaited<
  ReturnType<typeof getGoogleIntegrationOverview>
>;
type MicrosoftIntegrationOverview = Awaited<
  ReturnType<typeof getMicrosoftIntegrationOverview>
>;
type InboundEmailSettings = Awaited<ReturnType<typeof getInboundEmailSettings>>;
type IntegrationOverview = {
  configured: boolean;
  connections: Array<{ lastError: string | null; status: string }>;
  encryptionReady: boolean;
  error: string | null;
  migrationReady: boolean;
};

function SettingsDetailShell({
  children,
  eyebrow,
  title,
}: Readonly<{
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}>) {
  return (
    <section className="panel settings-detail-panel">
      <header className="assistant-preview-header settings-detail-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div className="row-actions">
          <Link
            className="secondary-button compact"
            href="/settings"
            prefetch={false}
          >
            Close
          </Link>
        </div>
      </header>
      <div className="settings-detail-body">{children}</div>
    </section>
  );
}

function EmptySettingsDetail() {
  return (
    <section className="panel settings-detail-panel settings-placeholder">
      <div>
        <p className="eyebrow">Settings</p>
        <h2>Select a settings area</h2>
        <p>
          Choose communication rules, workspace integrations, or billing and
          metering from the settings list to view and edit the full details
          here.
        </p>
      </div>
    </section>
  );
}

function integrationStatusLabel({
  configured,
  connections,
  encryptionReady,
  error,
  migrationReady,
}: IntegrationOverview) {
  if (!migrationReady) {
    return "Migration pending";
  }

  if (!configured) {
    return "Keys needed";
  }

  if (!encryptionReady) {
    return "Encryption key needed";
  }

  if (error) {
    return "Needs attention";
  }

  if (connections.some((connection) => connection.lastError)) {
    return "Needs attention";
  }

  if (connections.some((connection) => connection.status === "connected")) {
    return "Connected";
  }

  return "Ready to connect";
}

function DisconnectIntegrationButton({
  connectionId,
  disabled,
  provider,
}: Readonly<{
  connectionId: string;
  disabled: boolean;
  provider: string;
}>) {
  if (disabled) {
    return null;
  }

  return (
    <form
      action={disconnectIntegrationAction}
      className="integration-disconnect-form"
    >
      <input name="connectionId" type="hidden" value={connectionId} />
      <input name="provider" type="hidden" value={provider} />
      <button className="text-button danger" type="submit">
        Disconnect
      </button>
    </form>
  );
}

function GoogleIntegrationSettings({
  overview,
}: Readonly<{ overview: GoogleIntegrationOverview }>) {
  const canConnect =
    overview.configured && overview.encryptionReady && overview.migrationReady;
  const hasConnectedAccount = overview.connections.some(
    (connection) => connection.status === "connected",
  );

  return (
    <>
      <div className="integration-summary-grid">
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Approved and user-triggered email replies can send through the
                connected Gmail account.
              </>
            }
          >
            Gmail outbound
          </SettingCardHeading>
        </article>
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Drive access for quote and invoice documents Kyro creates or the
                user explicitly opens with Kyro.
              </>
            }
          >
            Google Drive documents
          </SettingCardHeading>
        </article>
      </div>

      {overview.redirectUri ? (
        <div className="detail-list compact-detail-list">
          <div>
            <span>Redirect URI</span>
            <strong>{overview.redirectUri}</strong>
            <small>Use this exact URL in the Google Cloud OAuth client.</small>
          </div>
        </div>
      ) : null}

      <div className="module-list integration-scope-list">
        {overview.scopes.map((scope) => (
          <span key={scope}>
            {scope.replace("https://www.googleapis.com/auth/", "")}
          </span>
        ))}
      </div>

      {overview.error ? (
        <p className="form-alert error">{overview.error}</p>
      ) : null}
      {!overview.migrationReady ? (
        <p className="form-alert">
          Integration tables are not in the database yet. Run{" "}
          <code>npm.cmd run db:migrate</code> before connecting Google.
        </p>
      ) : null}
      {!overview.configured ? (
        <p className="form-alert">
          Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>,
          and <code>NEXT_PUBLIC_APP_URL</code> before starting OAuth.
        </p>
      ) : null}
      {!overview.encryptionReady ? (
        <p className="form-alert">
          Add <code>INTEGRATION_TOKEN_ENCRYPTION_KEY</code> so refresh tokens
          are encrypted before storage.
        </p>
      ) : null}

      {overview.connections.length > 0 ? (
        <div className="usage-ledger compact">
          {overview.connections.map((connection) => (
            <div className="usage-ledger-row" key={connection.id}>
              <div className="usage-ledger-main">
                <strong>
                  {connection.accountEmail ??
                    connection.accountName ??
                    "Google account"}
                </strong>
                <span>{formatLabel(connection.status)}</span>
                {connection.lastError ? <p>{connection.lastError}</p> : null}
              </div>
              <div className="usage-ledger-meta">
                <span>{connection.scopes.length} scopes</span>
                <time>
                  {connection.lastConnectedAt
                    ? formatDate(connection.lastConnectedAt)
                    : "Not connected"}
                </time>
                <DisconnectIntegrationButton
                  connectionId={connection.id}
                  disabled={connection.status !== "connected"}
                  provider={GOOGLE_PROVIDER}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">No Google account is connected yet.</p>
      )}

      <div className="settings-footer">
        <span>
          Connect once, then Kyro can use Gmail and Drive through policies.
        </span>
        {canConnect && !hasConnectedAccount ? (
          <Link
            className="primary-button compact link-button"
            href="/integrations/google/start"
          >
            Connect Google
          </Link>
        ) : (
          !hasConnectedAccount && (
            <span className="pill warning">Setup required</span>
          )
        )}
      </div>
    </>
  );
}

function MicrosoftIntegrationSettings({
  overview,
}: Readonly<{ overview: MicrosoftIntegrationOverview }>) {
  const canConnect =
    overview.configured && overview.encryptionReady && overview.migrationReady;
  const hasConnectedAccount = overview.connections.some(
    (connection) => connection.status === "connected",
  );

  return (
    <>
      <div className="integration-summary-grid">
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Approved and user-triggered email replies can send through the
                connected Outlook or Microsoft 365 mailbox.
              </>
            }
          >
            Outlook outbound
          </SettingCardHeading>
        </article>
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Uses Microsoft OAuth and Graph Mail.Send, matching the same
                audit and permission model as Gmail.
              </>
            }
          >
            Microsoft Graph
          </SettingCardHeading>
        </article>
      </div>

      {overview.redirectUri ? (
        <div className="detail-list compact-detail-list">
          <div>
            <span>Redirect URI</span>
            <strong>{overview.redirectUri}</strong>
            <small>
              Use this exact URL in the Microsoft Entra app registration.
            </small>
          </div>
        </div>
      ) : null}

      <div className="module-list integration-scope-list">
        {overview.scopes.map((scope) => (
          <span key={scope}>
            {scope.replace("https://graph.microsoft.com/", "")}
          </span>
        ))}
      </div>

      {overview.error ? (
        <p className="form-alert error">{overview.error}</p>
      ) : null}
      {!overview.migrationReady ? (
        <p className="form-alert">
          Integration tables are not in the database yet. Run{" "}
          <code>npm.cmd run db:migrate</code> before connecting Microsoft.
        </p>
      ) : null}
      {!overview.configured ? (
        <p className="form-alert">
          Add <code>MICROSOFT_CLIENT_ID</code>,{" "}
          <code>MICROSOFT_CLIENT_SECRET</code>, <code>MICROSOFT_TENANT_ID</code>
          , and <code>NEXT_PUBLIC_APP_URL</code> before starting OAuth.
        </p>
      ) : null}
      {!overview.encryptionReady ? (
        <p className="form-alert">
          Add <code>INTEGRATION_TOKEN_ENCRYPTION_KEY</code> so refresh tokens
          are encrypted before storage.
        </p>
      ) : null}

      {overview.connections.length > 0 ? (
        <div className="usage-ledger compact">
          {overview.connections.map((connection) => (
            <div className="usage-ledger-row" key={connection.id}>
              <div className="usage-ledger-main">
                <strong>
                  {connection.accountEmail ??
                    connection.accountName ??
                    "Outlook account"}
                </strong>
                <span>{formatLabel(connection.status)}</span>
                {connection.lastError ? <p>{connection.lastError}</p> : null}
              </div>
              <div className="usage-ledger-meta">
                <span>{connection.scopes.length} scopes</span>
                <time>
                  {connection.lastConnectedAt
                    ? formatDate(connection.lastConnectedAt)
                    : "Not connected"}
                </time>
                <DisconnectIntegrationButton
                  connectionId={connection.id}
                  disabled={connection.status !== "connected"}
                  provider={MICROSOFT_PROVIDER}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">No Outlook account is connected yet.</p>
      )}

      <div className="settings-footer">
        <span>
          Connect once, then Kyro can send Outlook email through the same
          policies.
        </span>
        {canConnect && !hasConnectedAccount ? (
          <Link
            className="primary-button compact link-button"
            href="/integrations/microsoft/start"
          >
            Connect Outlook
          </Link>
        ) : (
          !hasConnectedAccount && (
            <span className="pill warning">Setup required</span>
          )
        )}
      </div>
    </>
  );
}

type ProviderConnection = {
  accountEmail: string | null;
  accountName: string | null;
  lastCheckedAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  scopes: string[];
  status: string;
};

type EmailProviderConnection = ProviderConnection & {
  provider: "google" | "microsoft";
  providerLabel: string;
  requiredReadScope: string;
};

function latestConnectedConnection(connections: ProviderConnection[]) {
  return (
    connections.find((connection) => connection.status === "connected") ?? null
  );
}

function connectionName(
  connection: ProviderConnection | null,
  fallback: string,
) {
  return connection?.accountEmail ?? connection?.accountName ?? fallback;
}

function connectionTime(connection: ProviderConnection | null) {
  return connection?.lastConnectedAt
    ? new Date(connection.lastConnectedAt).getTime()
    : 0;
}

function latestTimestamp(
  connections: ProviderConnection[],
  key: "lastCheckedAt" | "lastSyncAt",
) {
  return connections
    .map((connection) => connection[key])
    .filter((value): value is string => Boolean(value))
    .sort(
      (left, right) => new Date(right).getTime() - new Date(left).getTime(),
    )[0] ?? null;
}

function hasRequiredReadScope(connection: EmailProviderConnection) {
  if (connection.provider === "google") {
    return connection.scopes.includes(connection.requiredReadScope);
  }

  const requested = connection.requiredReadScope.toLowerCase();

  return connection.scopes.some((scope) => {
    const normalized = scope.toLowerCase();

    return normalized === requested || normalized.endsWith(`/${requested}`);
  });
}

function missingReadScope(connection: EmailProviderConnection) {
  return hasRequiredReadScope(connection) ? null : connection.requiredReadScope;
}

function isReconnectError(value: string | null) {
  return Boolean(value?.toLowerCase().includes("reconnect"));
}

function connectionNeedsReconnect(connection: EmailProviderConnection) {
  return Boolean(
    missingReadScope(connection) || isReconnectError(connection.lastError),
  );
}

function minutesUntilNextSync(
  lastSyncAt: string | null,
  intervalMinutes: number,
) {
  if (!lastSyncAt) {
    return 0;
  }

  const lastSyncTime = new Date(lastSyncAt).getTime();

  if (!Number.isFinite(lastSyncTime)) {
    return 0;
  }

  return Math.ceil(
    (lastSyncTime + intervalMinutes * 60_000 - Date.now()) / 60_000,
  );
}

function timePartsForZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone,
  }).formatToParts(date);

  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
  };
}

function minuteOfDay(value: string) {
  const [hour, minute] = value.split(":").map(Number);

  return hour * 60 + minute;
}

function quietHoursActiveNow(settings: InboundEmailSettings) {
  if (!settings.quietHoursEnabled || settings.quietHoursMode !== "paused") {
    return false;
  }

  const now = timePartsForZone(new Date(), settings.timeZone);
  const nowMinute = now.hour * 60 + now.minute;
  const start = minuteOfDay(settings.quietHoursStart);
  const end = minuteOfDay(settings.quietHoursEnd);

  if (start === end) {
    return false;
  }

  if (start < end) {
    return nowMinute >= start && nowMinute < end;
  }

  return nowMinute >= start || nowMinute < end;
}

function nextSyncLabel({
  connections,
  settings,
}: {
  connections: EmailProviderConnection[];
  settings: InboundEmailSettings;
}) {
  const connected = connections.filter(
    (connection) => connection.status === "connected",
  );
  const readReady = connected.filter((connection) =>
    hasRequiredReadScope(connection),
  );

  if (connected.length === 0) {
    return "Connect Gmail or Outlook first";
  }

  if (readReady.length === 0) {
    return "After reconnect grants inbox read access";
  }

  if (settings.syncMode === "paused") {
    return "Paused";
  }

  if (settings.syncMode === "manual_only") {
    return "Manual checks only";
  }

  if (quietHoursActiveNow(settings)) {
    return `After quiet hours end (${formatTimeOfDay(settings.quietHoursEnd)})`;
  }

  const lastSyncAt = latestTimestamp(readReady, "lastSyncAt");
  const minutes = minutesUntilNextSync(
    lastSyncAt,
    settings.pollIntervalMinutes,
  );

  if (minutes <= 0) {
    return "Due on the next scheduled run";
  }

  return `In about ${minutes} min`;
}

function syncHealthStatus({
  connections,
  settings,
}: {
  connections: EmailProviderConnection[];
  settings: InboundEmailSettings;
}) {
  const connected = connections.filter(
    (connection) => connection.status === "connected",
  );
  const reconnectNeeded = connected.filter(connectionNeedsReconnect);
  const failures = connected.filter(
    (connection) => connection.lastError && !connectionNeedsReconnect(connection),
  );

  if (connected.length === 0) {
    return {
      detail: "Connect Gmail or Outlook before Kyro can read inbound mail.",
      tone: "warning" as const,
      title: "No inbox connected",
    };
  }

  if (reconnectNeeded.length > 0) {
    return {
      detail: `${reconnectNeeded.length} account${reconnectNeeded.length === 1 ? "" : "s"} need fresh OAuth permission for inbox read access.`,
      tone: "warning" as const,
      title: "Reconnect needed",
    };
  }

  if (failures.length > 0) {
    return {
      detail: failures[0].lastError ?? "The last sync attempt failed.",
      tone: "error" as const,
      title: "Sync failed",
    };
  }

  if (settings.syncMode === "paused") {
    return {
      detail: "Automatic and manual email sync are paused by policy.",
      tone: "warning" as const,
      title: "Sync paused",
    };
  }

  if (settings.syncMode === "manual_only") {
    return {
      detail: "Scheduled polling is off. Manual and assistant-triggered checks still work.",
      tone: "neutral" as const,
      title: "Manual only",
    };
  }

  return {
    detail: `Scheduled polling can run every ${settings.pollIntervalMinutes} minutes during active hours.`,
    tone: "success" as const,
    title: "Automatic polling ready",
  };
}

function providerChoiceStatus({
  anyConnected,
  connected,
  needsReconnect = false,
  status,
}: {
  anyConnected: boolean;
  connected: boolean;
  needsReconnect?: boolean;
  status: string;
}) {
  if (needsReconnect) {
    return "Reconnect needed";
  }

  if (connected) {
    return "Connected";
  }

  if (anyConnected && status === "Keys needed") {
    return "Optional setup";
  }

  return status;
}

function inboundSyncModeLabel(value: string) {
  return value === "automatic"
    ? "Automatic polling"
    : value === "manual_only"
      ? "Manual only"
      : "Paused";
}

function inboundQuietHoursModeLabel(value: string) {
  return value === "same_interval"
    ? "Same as daytime"
    : "Pause until quiet hours end";
}

function senderRuleActionLabel(value: InboundEmailSenderRule["action"]) {
  return value === "always_promote" ? "Always relevant" : "Always ignore";
}

function senderRuleMatchLabel(value: InboundEmailSenderRule["match"]) {
  return value === "domain" ? "Domain" : "Email address";
}

function senderRuleSourceLabel(rule: InboundEmailSenderRule) {
  return rule.createdFromEventId ? "Learned from Inbox" : "Manual rule";
}

function senderRuleCreatedLabel(rule: InboundEmailSenderRule) {
  return rule.createdAt ? `Added ${formatDate(rule.createdAt)}` : "Added before tracking";
}

function scopeLabel(value: string) {
  return value
    .replace("https://www.googleapis.com/auth/", "")
    .replace("https://graph.microsoft.com/", "");
}

function EmailSyncHealthPanel({
  connections,
  settings,
}: Readonly<{
  connections: EmailProviderConnection[];
  settings: InboundEmailSettings;
}>) {
  const connected = connections.filter(
    (connection) => connection.status === "connected",
  );
  const health = syncHealthStatus({ connections, settings });
  const lastSyncAt = latestTimestamp(connected, "lastSyncAt");
  const lastCheckedAt = latestTimestamp(connected, "lastCheckedAt");

  return (
    <section className={`email-sync-health ${health.tone}`}>
      <div className="email-sync-health-header">
        <div>
          <p className="eyebrow">Sync health</p>
          <h3>{health.title}</h3>
          <p>{health.detail}</p>
        </div>
        <span
          className={`pill ${
            health.tone === "success"
              ? "success"
              : health.tone === "warning"
                ? "warning"
                : ""
          }`}
        >
          {inboundSyncModeLabel(settings.syncMode)}
        </span>
      </div>

      <div className="email-sync-status-grid">
        <article>
          <span>Last successful sync</span>
          <strong>{lastSyncAt ? formatDate(lastSyncAt) : "Never"}</strong>
        </article>
        <article>
          <span>Last check attempt</span>
          <strong>{lastCheckedAt ? formatDate(lastCheckedAt) : "Not yet"}</strong>
        </article>
        <article>
          <span>Next scheduled sync</span>
          <strong>{nextSyncLabel({ connections, settings })}</strong>
        </article>
      </div>

      {connected.length > 0 ? (
        <div className="email-sync-account-list">
          {connected.map((connection) => {
            const missingScope = missingReadScope(connection);
            const needsReconnect = connectionNeedsReconnect(connection);
            const hasFailure =
              connection.lastError && !needsReconnect;

            return (
              <article
                className="email-sync-account-row"
                key={`${connection.provider}-${connection.accountEmail ?? connection.accountName ?? connection.requiredReadScope}`}
              >
                <div>
                  <strong>
                    {connectionName(connection, connection.providerLabel)}
                  </strong>
                  <span>
                    {connection.providerLabel} -{" "}
                    {missingScope
                      ? `Missing ${scopeLabel(missingScope)}`
                      : needsReconnect
                        ? "Reconnect account"
                      : hasFailure
                        ? "Last sync failed"
                        : "Inbox read access ready"}
                  </span>
                  {hasFailure ? <p>{connection.lastError}</p> : null}
                </div>
                <span
                  className={
                    needsReconnect || hasFailure
                      ? "pill warning"
                      : "pill success"
                  }
                >
                  {needsReconnect ? "Reconnect" : hasFailure ? "Failed" : "Ready"}
                </span>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function SenderRulesSettings({
  rules,
}: Readonly<{
  rules: InboundEmailSenderRule[];
}>) {
  const sortedRules = [...rules].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;

    return rightTime - leftTime;
  });

  return (
    <section className="sender-rules-panel">
      <div className="panel-heading compact-panel-heading">
        <div>
          <p className="eyebrow">Sender learning</p>
          <div className="setting-card-heading">
            <h3>Sender rules</h3>
            <InfoBubble>
              Sender rules override normal email classification. Use them for
              senders Kyro should always treat as business-relevant or always
              keep out of the work queue.
            </InfoBubble>
          </div>
        </div>
        <span className="pill">
          {sortedRules.length} {sortedRules.length === 1 ? "rule" : "rules"}
        </span>
      </div>

      <form
        action={upsertInboundEmailSenderRuleSettingsAction}
        className="sender-rule-add-form"
      >
        <label>
          <span>Sender</span>
          <input
            name="senderRuleValue"
            placeholder="client@example.com or example.com"
            required
          />
        </label>
        <label>
          <span>Match</span>
          <select defaultValue="email" name="senderRuleMatch">
            <option value="email">Email address</option>
            <option value="domain">Domain</option>
          </select>
        </label>
        <label>
          <span>Action</span>
          <select defaultValue="always_promote" name="senderRuleAction">
            <option value="always_promote">Always relevant</option>
            <option value="always_ignore">Always ignore</option>
          </select>
        </label>
        <button className="primary-button compact" type="submit">
          Add rule
        </button>
      </form>

      {sortedRules.length > 0 ? (
        <div className="sender-rule-list">
          {sortedRules.map((rule) => (
            <article
              className={`sender-rule-row ${
                rule.action === "always_promote" ? "promote" : "ignore"
              }`}
              key={`${rule.match}:${rule.value}`}
            >
              <div className="sender-rule-main">
                <strong>{rule.value}</strong>
                <span>
                  {senderRuleMatchLabel(rule.match)} -{" "}
                  {senderRuleSourceLabel(rule)} - {senderRuleCreatedLabel(rule)}
                </span>
              </div>
              <form
                action={upsertInboundEmailSenderRuleSettingsAction}
                className="sender-rule-edit-form"
              >
                <input name="senderRuleMatch" type="hidden" value={rule.match} />
                <input name="senderRuleValue" type="hidden" value={rule.value} />
                <select defaultValue={rule.action} name="senderRuleAction">
                  <option value="always_promote">Always relevant</option>
                  <option value="always_ignore">Always ignore</option>
                </select>
                <button className="secondary-button compact" type="submit">
                  Save
                </button>
              </form>
              <form
                action={removeInboundEmailSenderRuleSettingsAction}
                className="sender-rule-remove-form"
              >
                <input name="senderRuleMatch" type="hidden" value={rule.match} />
                <input name="senderRuleValue" type="hidden" value={rule.value} />
                <button className="text-button danger" type="submit">
                  Remove
                </button>
              </form>
              <span className="sender-rule-action-pill">
                {senderRuleActionLabel(rule.action)}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-copy">
          No sender rules yet. Use the filtered-out email menu or add one here
          when Kyro should always trust or ignore a sender.
        </p>
      )}
    </section>
  );
}

function GeneralSettingsDetail({
  settings,
}: Readonly<{
  settings: WorkspaceGeneralSettings;
}>) {
  return (
    <form action={updateGeneralSettingsAction} className="settings-form">
      <section className="integration-choice-panel">
        <div>
          <p className="eyebrow">Workspace defaults</p>
          <h3>System-wide settings</h3>
          <p>
            Shared defaults live here instead of being buried inside individual
            features. We can add business hours, locale, and regional defaults
            here as Kyro grows.
          </p>
        </div>
        <span className="pill">General</span>
      </section>

      <div className="settings-grid">
        <label className="setting-card">
          <SettingCardHeading
            info={
              <>
                Used wherever Kyro needs local time, including quiet-hours email
                polling. Use an IANA timezone such as Australia/Brisbane,
                America/Denver, or UTC.
              </>
            }
          >
            Workspace timezone
          </SettingCardHeading>
          <input
            defaultValue={settings.timeZone}
            name="workspaceTimeZone"
            placeholder="Australia/Brisbane"
          />
        </label>
        <label className="setting-card">
          <SettingCardHeading
            info={
              <>
                Controls how Kyro displays internal money values such as usage
                charges and billing exports. Stored ledger values stay in USD
                for clean accounting; this is the display currency users see in
                the app.
              </>
            }
          >
            Display currency
          </SettingCardHeading>
          <select
            defaultValue={settings.displayCurrency}
            name="workspaceDisplayCurrency"
          >
            {DISPLAY_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-footer">
        <span>
          Timezone powers quiet hours and scheduling. Display currency currently
          uses {displayCurrencySourceLabel(settings)} until the billing provider
          is connected.
        </span>
        <button className="primary-button compact" type="submit">
          Save workspace defaults
        </button>
      </div>
    </form>
  );
}

function InboundEmailSyncSettings({
  connections,
  settings,
}: Readonly<{
  connections: EmailProviderConnection[];
  settings: InboundEmailSettings;
}>) {
  const syncStatus =
    settings.syncMode === "automatic"
      ? `Every ${settings.pollIntervalMinutes} min`
      : inboundSyncModeLabel(settings.syncMode);

  return (
    <section className="integration-provider-stack">
      <section className="integration-choice-panel">
        <div>
          <p className="eyebrow">Inbound email</p>
          <h3>Email awareness and action filtering</h3>
          <p>
            Kyro can read connected Gmail or Outlook inboxes, keep lightweight
            awareness of skipped mail, and only promote business-actionable
            emails into CRM conversations.
          </p>
        </div>
        <span className="pill">{syncStatus}</span>
      </section>

      <EmailSyncHealthPanel connections={connections} settings={settings} />

      <form action={updateInboundEmailSettingsAction} className="settings-form">
        <div className="settings-grid">
          <label className="setting-card">
            <SettingCardHeading
              info={
                <>
                  Automatic is the default. Manual only keeps the button and
                  assistant-triggered checks available without scheduled
                  polling.
                </>
              }
            >
              Sync mode
            </SettingCardHeading>
            <select defaultValue={settings.syncMode} name="inboundSyncMode">
              {INBOUND_EMAIL_SYNC_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {inboundSyncModeLabel(mode)}
                </option>
              ))}
            </select>
          </label>

          <label className="setting-card">
            <SettingCardHeading info="Five minutes is near-live without adding webhook infrastructure.">
              Daytime poll frequency
            </SettingCardHeading>
            <select
              defaultValue={settings.pollIntervalMinutes}
              name="inboundPollIntervalMinutes"
            >
              {INBOUND_EMAIL_POLL_INTERVALS.map((interval) => (
                <option key={interval} value={interval}>
                  Every {interval} minutes
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="settings-fieldset quiet-hours-panel">
          <legend>Quiet hours</legend>
          <div className="quiet-hours-summary">
            <label className="quiet-hours-toggle">
              <input
                defaultChecked={settings.quietHoursEnabled}
                name="inboundQuietHoursEnabled"
                type="checkbox"
              />
              <span>
                <strong>Reduce overnight polling cost</strong>
                <small>
                  Pause scheduled inbox checks while the business is asleep.
                  Manual checks and assistant-triggered checks still work.
                </small>
              </span>
            </label>
            <span className="pill">
              {formatTimeOfDay(settings.quietHoursStart)} -{" "}
              {formatTimeOfDay(settings.quietHoursEnd)}
            </span>
          </div>
          <div className="quiet-hours-controls">
            <label className="setting-card">
              <SettingCardHeading info="Local quiet-hours start.">
                Start
              </SettingCardHeading>
              <input
                defaultValue={settings.quietHoursStart}
                name="inboundQuietHoursStart"
                type="time"
              />
            </label>
            <label className="setting-card">
              <SettingCardHeading info="Local quiet-hours end.">
                End
              </SettingCardHeading>
              <input
                defaultValue={settings.quietHoursEnd}
                name="inboundQuietHoursEnd"
                type="time"
              />
            </label>
            <label className="setting-card">
              <SettingCardHeading
                info={
                  <>
                    Default: pause scheduled checks during quiet hours, then
                    resume on the first scheduled poll after quiet hours end.
                    Emergency businesses can keep normal polling overnight.
                  </>
                }
              >
                Quiet-hours behavior
              </SettingCardHeading>
              <select
                defaultValue={settings.quietHoursMode}
                name="inboundQuietHoursMode"
              >
                {INBOUND_EMAIL_QUIET_HOURS_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {inboundQuietHoursModeLabel(mode)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <details className="settings-accordion">
          <summary>
            <div className="settings-accordion-title">
              <strong>Filtering and sync limits</strong>
              <InfoBubble>
                Keep this simple for users, but editable for edge cases.
              </InfoBubble>
            </div>
            <span className="pill">Advanced</span>
          </summary>

          <div className="settings-accordion-body">
            <div className="settings-grid">
              <label className="setting-card">
                <SettingCardHeading
                  info={
                    <>
                      How many days back Kyro can ask Gmail or Outlook to search
                      on each sync. It catches missed mail after downtime or
                      reconnects; duplicates are skipped.
                    </>
                  }
                >
                  Missed-mail lookback
                </SettingCardHeading>
                <input
                  defaultValue={settings.lookbackDays}
                  max={30}
                  min={1}
                  name="inboundLookbackDays"
                  type="number"
                />
              </label>
              <label className="setting-card">
                <SettingCardHeading
                  info={
                    <>
                      The maximum inbox messages Kyro asks each connected email
                      provider for in one sync run. This keeps provider/API and
                      classifier work bounded.
                    </>
                  }
                >
                  Fetch cap per sync
                </SettingCardHeading>
                <input
                  defaultValue={settings.maxMessagesPerSync}
                  max={50}
                  min={5}
                  name="inboundMaxMessagesPerSync"
                  type="number"
                />
              </label>
              <label className="compact-checkbox-row setting-card">
                <input
                  defaultChecked={settings.includeAwarenessEvents}
                  name="inboundIncludeAwarenessEvents"
                  type="checkbox"
                />
                <span>Store skipped-mail summaries</span>
                <InfoBubble>
                  Kyro always records a minimal provider event so it will not
                  reprocess the same email. This adds a small human-readable
                  summary for skipped emails without creating CRM conversations.
                </InfoBubble>
              </label>
            </div>

            <label className="settings-textarea">
              Action rules for CRM promotion
              <textarea
                defaultValue={settings.actionInstructions}
                name="inboundActionInstructions"
                rows={5}
              />
            </label>
          </div>
        </details>

        <div className="settings-footer">
          <span>
            Action rules decide what becomes CRM. Personal or noisy mail stays
            out unless it clearly affects the business.
          </span>
          <button className="primary-button compact" type="submit">
            Save inbound rules
          </button>
        </div>
      </form>

      <SenderRulesSettings rules={settings.senderRules} />

      <form action={syncInboundEmailNowAction} className="settings-footer">
        <span>
          Manual check uses the same sync path the assistant can call during a
          conversation.
        </span>
        <ManualSyncSubmitButton />
      </form>
    </section>
  );
}

function ProviderDetails({
  children,
  description,
  isCurrent,
  label,
  provider,
  status,
}: Readonly<{
  children: React.ReactNode;
  description: string;
  isCurrent: boolean;
  label: string;
  provider: string;
  status: string;
}>) {
  return (
    <details
      className={
        isCurrent
          ? "integration-provider-section current"
          : "integration-provider-section"
      }
    >
      <summary className="integration-provider-summary">
        <div className="integration-provider-main">
          <p className="eyebrow">{provider}</p>
          <h3>{label}</h3>
          <span>{description}</span>
        </div>
        <div className="integration-provider-status">
          {isCurrent ? <span>Current sender</span> : null}
          <span className="pill">{status}</span>
        </div>
      </summary>
      <div className="integration-provider-body">{children}</div>
    </details>
  );
}

function WorkspaceIntegrationsSettings({
  googleOverview,
  googleStatus,
  inboundEmailSettings,
  microsoftOverview,
  microsoftStatus,
}: Readonly<{
  googleOverview: GoogleIntegrationOverview;
  googleStatus: string;
  inboundEmailSettings: InboundEmailSettings;
  microsoftOverview: MicrosoftIntegrationOverview;
  microsoftStatus: string;
}>) {
  const googleConnection = latestConnectedConnection(
    googleOverview.connections,
  );
  const microsoftConnection = latestConnectedConnection(
    microsoftOverview.connections,
  );
  const googleConnected = Boolean(googleConnection);
  const microsoftConnected = Boolean(microsoftConnection);
  const anyConnected = googleConnected || microsoftConnected;
  const currentProvider =
    connectionTime(microsoftConnection) > connectionTime(googleConnection)
      ? "microsoft"
      : googleConnected
        ? "google"
        : microsoftConnected
          ? "microsoft"
          : null;
  const currentProviderName =
    currentProvider === "microsoft"
      ? connectionName(microsoftConnection, "Outlook")
      : currentProvider === "google"
        ? connectionName(googleConnection, "Google Workspace")
        : null;
  const emailConnections: EmailProviderConnection[] = [
    ...googleOverview.connections.map((connection) => ({
      ...connection,
      provider: "google" as const,
      providerLabel: "Google",
      requiredReadScope: GOOGLE_GMAIL_READ_SCOPE,
    })),
    ...microsoftOverview.connections.map((connection) => ({
      ...connection,
      provider: "microsoft" as const,
      providerLabel: "Microsoft",
      requiredReadScope: MICROSOFT_MAIL_READ_SCOPE,
    })),
  ];
  const googleNeedsReconnect = emailConnections.some(
    (connection) =>
      connection.provider === "google" &&
      connection.status === "connected" &&
      connectionNeedsReconnect(connection),
  );
  const microsoftNeedsReconnect = emailConnections.some(
    (connection) =>
      connection.provider === "microsoft" &&
      connection.status === "connected" &&
      connectionNeedsReconnect(connection),
  );

  return (
    <div className="integration-provider-stack">
      <InboundEmailSyncSettings
        connections={emailConnections}
        settings={inboundEmailSettings}
      />

      <section className="integration-choice-panel">
        <div>
          <p className="eyebrow">Email provider</p>
          <h3>
            {currentProviderName
              ? `${currentProviderName} is connected`
              : "Connect Gmail or Outlook"}
          </h3>
          <p>
            Kyro only needs one outbound email provider. Connect Gmail or
            Outlook; if both are connected during testing, Kyro uses the most
            recently connected account until we add a default sender setting.
          </p>
        </div>
        <span className="pill">
          {anyConnected ? "Ready to send" : "Setup required"}
        </span>
      </section>

      <ProviderDetails
        description={
          googleConnection
            ? connectionName(googleConnection, "Google account")
            : "Gmail outbound and Drive document access"
        }
        isCurrent={currentProvider === "google"}
        label="Google Workspace"
        provider="Google"
        status={providerChoiceStatus({
          anyConnected,
          connected: googleConnected,
          needsReconnect: googleNeedsReconnect,
          status: googleStatus,
        })}
      >
        <GoogleIntegrationSettings overview={googleOverview} />
      </ProviderDetails>

      <ProviderDetails
        description={
          microsoftConnection
            ? connectionName(microsoftConnection, "Outlook account")
            : anyConnected
              ? "Optional if you want to switch from Gmail to Outlook"
              : "Outlook and Microsoft 365 email sending"
        }
        isCurrent={currentProvider === "microsoft"}
        label="Microsoft Outlook"
        provider="Microsoft"
        status={providerChoiceStatus({
          anyConnected,
          connected: microsoftConnected,
          needsReconnect: microsoftNeedsReconnect,
          status: microsoftStatus,
        })}
      >
        <MicrosoftIntegrationSettings overview={microsoftOverview} />
      </ProviderDetails>
    </div>
  );
}

function CommunicationSettingsDetail({
  communicationSettings,
}: Readonly<{
  communicationSettings: Awaited<ReturnType<typeof getCommunicationSettings>>;
}>) {
  return (
    <form
      action={updateCommunicationSettingsAction}
      className="settings-form"
      encType="multipart/form-data"
    >
      <input
        name="defaultTone"
        type="hidden"
        value={communicationSettings.defaultTone}
      />

      <div className="settings-grid single">
        <label className="setting-card">
          <SettingCardHeading
            info={
              <>
                Email sends through the connected Gmail or Outlook account.
                Other channels stay internal until their providers are
                connected.
              </>
            }
          >
            Outbound permission
          </SettingCardHeading>
          <select
            defaultValue={
              communicationSettings.approvalRequired
                ? "approval_required"
                : "auto_dry_run"
            }
            name="approvalMode"
          >
            <option value="approval_required">
              Approval required before outbound
            </option>
            <option value="auto_dry_run">
              Allow outbound without extra approval
            </option>
          </select>
        </label>
      </div>

      <fieldset className="settings-fieldset">
        <legend>Allowed outbound channels</legend>
        <div className="channel-toggle-grid">
          {OUTBOUND_CHANNELS.map((channel) => (
            <label className="channel-toggle" key={channel}>
              <input
                defaultChecked={communicationSettings.allowedChannels.includes(
                  channel,
                )}
                name="allowedChannels"
                type="checkbox"
                value={channel}
              />
              <span>{formatLabel(channel)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <details className="settings-accordion">
        <summary>
          <div className="settings-accordion-title">
            <strong>Email signatures</strong>
            <InfoBubble>
              Default signature plus optional assistant signature.
            </InfoBubble>
          </div>
          <span className="pill">Advanced</span>
        </summary>

        <div className="settings-accordion-body">
          <EmailSignatureEditor
            description="Used when the user writes the email manually or edits an AI draft before sending."
            namePrefix="manualSignature"
            signature={communicationSettings.manualSignature}
            title="Default email signature"
          />

          <fieldset className="settings-fieldset compact-checkbox-fieldset">
            <legend>Assistant email signature</legend>
            <label className="compact-checkbox-row">
              <input
                defaultChecked={communicationSettings.useSeparateAiSignature}
                name="useSeparateAiSignature"
                type="checkbox"
              />
              <span>
                Use a different signature for untouched AI-sent emails
              </span>
            </label>
            <label className="compact-checkbox-row">
              <input name="duplicateManualSignature" type="checkbox" />
              <span>
                Copy the default signature into the assistant signature when
                saving
              </span>
            </label>
          </fieldset>

          <EmailSignatureEditor
            description="Used only when an AI generated reply is sent without the user changing the subject or body."
            namePrefix="aiGeneratedSignature"
            signature={communicationSettings.aiGeneratedSignature}
            title="AI assistant signature"
          />

          <div className="settings-footer compact-settings-footer">
            <span>
              Save to refresh the signature previews and apply them to future
              Gmail sends.
            </span>
            <button className="primary-button compact" type="submit">
              Save and preview signatures
            </button>
          </div>
        </div>
      </details>

      <div className="settings-footer">
        <span>
          Connected email providers can send real email; SMS and phone are
          internal records.
        </span>
        <button className="primary-button compact" type="submit">
          Save settings
        </button>
      </div>
    </form>
  );
}

function VoiceSettingsDetail({
  pronunciationEntries,
  voiceSettings,
}: Readonly<{
  pronunciationEntries: AssistantPronunciationEntry[];
  voiceSettings: Awaited<ReturnType<typeof getVoiceSettings>>;
}>) {
  return (
    <>
      <form action={updateVoiceSettingsAction} className="settings-form">
        <div className="settings-grid">
          <label className="setting-card">
            <SettingCardHeading
              info={
                <>
                  This OpenAI voice is used for realtime voice and generated
                  voice playback so Kyro sounds consistent across the app.
                </>
              }
            >
              Assistant voice
            </SettingCardHeading>
            <select defaultValue={voiceSettings.openAiVoice} name="openAiVoice">
              {OPENAI_VOICE_OPTIONS.map((voice) => (
                <option key={voice} value={voice}>
                  {formatLabel(voice)}
                </option>
              ))}
            </select>
          </label>

          <label className="setting-card">
            <SettingCardHeading
              info={
                <>
                  Balanced lets Kyro proceed with high-confidence inferred
                  pronunciations, but asks before risky customer-facing voice.
                </>
              }
            >
              Outbound voice pronunciation
            </SettingCardHeading>
            <select
              defaultValue={voiceSettings.outboundVoicePronunciationPolicy}
              name="outboundVoicePronunciationPolicy"
            >
              {OUTBOUND_VOICE_PRONUNCIATION_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {policyLabel(policy)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-footer align-end">
          <button className="primary-button compact" type="submit">
            Save voice settings
          </button>
        </div>
      </form>

      <PronunciationVocabularySettings entries={pronunciationEntries} />
    </>
  );
}

function PronunciationVocabularySettings({
  entries,
}: Readonly<{
  entries: AssistantPronunciationEntry[];
}>) {
  const visibleEntries = entries.filter((entry) => entry.status !== "ignored");

  return (
    <section className="pronunciation-settings-stack">
      <div className="panel-heading compact-panel-heading">
        <div>
          <p className="eyebrow">Vocabulary</p>
          <div className="setting-card-heading">
            <h3>Pronunciation list</h3>
            <InfoBubble>
              <strong>Phrase</strong> is the word Kyro should handle carefully.{" "}
              <strong>Say it like</strong> is the phonetic guidance used for
              speech. <strong>Aliases</strong> are related spellings, nicknames,
              or speech-to-text mishearings used for matching and context; they
              do not replace what Kyro says aloud. Kyro can auto-add entries
              with a best-effort pronunciation and run a quick LLM pass to
              suggest aliases.
            </InfoBubble>
          </div>
        </div>
        <span className="pill">
          {visibleEntries.length}{" "}
          {visibleEntries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <form
        action={createPronunciationEntryAction}
        className="pronunciation-entry-inline-form pronunciation-entry-form-new"
      >
        <input name="status" type="hidden" value="approved" />
        <label className="pronunciation-row-field">
          <span>Phrase</span>
          <input name="phrase" placeholder="Woolloongabba" required />
        </label>
        <label className="pronunciation-row-field pronunciation-hint-field">
          <span>Say it like</span>
          <input name="pronunciationHint" placeholder="wuh-lun-gabba" />
        </label>
        <label className="pronunciation-row-field">
          <span>Category</span>
          <select defaultValue="other" name="category">
            {PRONUNCIATION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {formatLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label className="pronunciation-row-field pronunciation-aliases-field">
          <span>Aliases</span>
          <input name="aliases" placeholder="comma-separated, optional" />
        </label>
        <button className="primary-button compact" type="submit">
          Add pronunciation
        </button>
      </form>

      <div className="pronunciation-entry-list">
        {visibleEntries.length > 0 ? (
          visibleEntries.map((entry) => (
            <article className="pronunciation-entry-card" key={entry.id}>
              <div className="pronunciation-entry-row">
                <form
                  action={updatePronunciationEntryAction}
                  className="pronunciation-entry-inline-form"
                >
                  <input name="entryId" type="hidden" value={entry.id} />
                  <label className="pronunciation-row-field">
                    <span>Phrase</span>
                    <input defaultValue={entry.phrase} name="phrase" required />
                  </label>
                  <label className="pronunciation-row-field pronunciation-hint-field">
                    <span>Say it like</span>
                    <input
                      defaultValue={pronunciationHintValue(entry)}
                      name="pronunciationHint"
                    />
                  </label>
                  <label className="pronunciation-row-field pronunciation-category-field">
                    <span>Category</span>
                    <select defaultValue={entry.category} name="category">
                      {PRONUNCIATION_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {formatLabel(category)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pronunciation-row-field pronunciation-aliases-field">
                    <span>Aliases</span>
                    <input
                      defaultValue={formatPronunciationAliases(entry.aliases)}
                      name="aliases"
                    />
                  </label>
                  <div className="pronunciation-row-meta">
                    <small>
                      {pronunciationEntrySourceLabel(entry)} -{" "}
                      {pronunciationUsageLabel(entry)}
                    </small>
                  </div>
                  <span className="pill subtle">
                    {pronunciationEntryPill(entry)}
                  </span>
                  <PronunciationPreviewPlayer
                    entryId={entry.id}
                    fallbackSrc={`/api/assistant/pronunciation/preview?entryId=${entry.id}`}
                  />
                  <button className="secondary-button compact" type="submit">
                    Save
                  </button>
                </form>

                <form
                  action={ignorePronunciationEntryAction}
                  className="pronunciation-entry-remove-form"
                >
                  <input name="entryId" type="hidden" value={entry.id} />
                  <input name="phrase" type="hidden" value={entry.phrase} />
                  <input
                    name="pronunciationHint"
                    type="hidden"
                    value={pronunciationHintValue(entry)}
                  />
                  <input name="category" type="hidden" value={entry.category} />
                  <input
                    name="aliases"
                    type="hidden"
                    value={formatPronunciationAliases(entry.aliases)}
                  />
                  <button
                    aria-label={`Remove ${entry.phrase}`}
                    className="pronunciation-icon-button danger"
                    title="Remove pronunciation"
                    type="submit"
                  >
                    <span aria-hidden="true">X</span>
                  </button>
                </form>
              </div>
            </article>
          ))
        ) : (
          <p className="empty-copy">
            No pronunciation entries yet. Add common names, suburbs, acronyms,
            or business terms Kyro should say carefully.
          </p>
        )}
      </div>
    </section>
  );
}

type UsageReportData = Awaited<ReturnType<typeof getUsageReport>>;

function modelUsageDescription(row: UsageBreakdownRow) {
  const model = row.model.toLowerCase();
  const service = row.service.toLowerCase();

  if (service === "realtime" || model.includes("realtime")) {
    return "Used for Kyro's live voice assistant: low-latency spoken conversations, audio/text tokens, cached context, and voice tool calls.";
  }

  if (service === "speech_to_text" || model.includes("transcribe") || model.includes("whisper")) {
    return "Used when Kyro turns recorded or uploaded audio into text before it can answer or take action.";
  }

  if (service === "text_to_speech" || model.includes("tts")) {
    return "Used for generated voice playback and pronunciation previews when Kyro reads text aloud outside the live realtime session.";
  }

  if (service === "web_search") {
    return "Used when Kyro searches the internet to answer with current information. Search calls can also add model-token cost when result content is used.";
  }

  if (model.includes("gpt-4.1-mini")) {
    return "Kyro's lightweight OpenAI text model for assistant replies, settings help, email drafting, document/template edits, classification, and tool-aware work.";
  }

  if (model === "n/a") {
    return "This is a provider or delivery event rather than a model-generated AI response.";
  }

  return "Used for AI work routed through this provider/model. The task breakdown above shows what business activity created the charge.";
}

function UsageInternalCostPills({
  displayCurrencySettings,
  usageReport,
}: Readonly<{
  displayCurrencySettings: DisplayCurrencySettings | null;
  usageReport: UsageReportData | null;
}>) {
  if (!usageReport || !displayCurrencySettings) {
    return null;
  }

  return (
    <div
      aria-label="Internal usage cost controls"
      className="usage-internal-cost-pills"
    >
      <span title="Internal provider/API cost before Kyro markup.">
        <b>Provider</b>
        {formatDisplayMoney(
          usageReport.totals.providerCost,
          usageReport.totals.currency,
          displayCurrencySettings,
        )}
      </span>
      <span title="Internal margin before payment processing, support, and infrastructure costs.">
        <b>Margin</b>
        {formatDisplayMoney(
          usageReport.totals.grossMargin,
          usageReport.totals.currency,
          displayCurrencySettings,
        )}
      </span>
    </div>
  );
}

function UsageSettingsDetail({
  activeWindow,
  displayCurrencySettings,
  usageReport,
}: Readonly<{
  activeWindow: string;
  displayCurrencySettings: DisplayCurrencySettings;
  usageReport: UsageReportData;
}>) {
  return (
    <>
      <section className="usage-summary-strip" aria-label="Usage metrics">
        <div className="usage-charge-summary">
          <span>Usage charge</span>
          <strong>
            {formatDisplayMoney(
              usageReport.totals.customerCharge,
              usageReport.totals.currency,
              displayCurrencySettings,
            )}
          </strong>
        </div>
        <UsageLedgerModal
          displayCurrencySettings={displayCurrencySettings}
          rows={usageReport.ledger}
        />
      </section>

      <nav className="filter-bar" aria-label="Usage date range">
        {usageWindows.map((window) => (
          <Link
            className={
              activeWindow === window.value
                ? "filter-pill active"
                : "filter-pill"
            }
            href={usageWindowHref(window.value)}
            key={window.value}
            prefetch={false}
          >
            {window.label}
          </Link>
        ))}
      </nav>

      <div className="usage-grid compact">
        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Breakdown</p>
              <h2>Usage by task</h2>
            </div>
          </div>
          {usageReport.taskBreakdown.length > 0 ? (
            <div className="usage-table">
              <div className="usage-row usage-row-three heading" aria-hidden="true">
                <span>Task</span>
                <span>Events</span>
                <span>Usage charge</span>
              </div>
              {usageReport.taskBreakdown.map((row) => (
                <div className="usage-row usage-row-three" key={row.key}>
                  <div className="usage-breakdown-copy">
                    <strong>{row.label}</strong>
                    <span>{row.description}</span>
                  </div>
                  <span>{row.events}</span>
                  <span>
                    {formatDisplayMoney(
                      row.customerCharge,
                      row.currency,
                      displayCurrencySettings,
                    )}
                  </span>
                </div>
              ))}
              <div className="usage-row usage-row-three usage-total-row">
                <div className="usage-breakdown-copy">
                  <strong>Total</strong>
                  <span>All metered task usage in this range.</span>
                </div>
                <span>{usageReport.totals.events}</span>
                <span>
                  {formatDisplayMoney(
                    usageReport.totals.customerCharge,
                    usageReport.totals.currency,
                    displayCurrencySettings,
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="empty-copy">
              No metered usage in this date range yet.
            </p>
          )}
        </article>

        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Technical breakdown</p>
              <h2>Provider and model</h2>
            </div>
          </div>
          {usageReport.providerBreakdown.length > 0 ? (
            <div className="usage-table">
              <div className="usage-row usage-row-three heading" aria-hidden="true">
                <span>Provider / model</span>
                <span>Events</span>
                <span>Usage charge</span>
              </div>
              {usageReport.providerBreakdown.map((row) => (
                <div className="usage-row usage-row-three" key={row.key}>
                  <div>
                    <span className="usage-breakdown-info-title">
                      <strong>
                        {row.model === "n/a"
                          ? row.provider
                          : `${row.provider} / ${row.model}`}
                      </strong>
                      <InfoBubble
                        label={`What ${row.model === "n/a" ? row.provider : row.model} is used for`}
                      >
                        {modelUsageDescription(row)}
                      </InfoBubble>
                    </span>
                    <span>{formatLabel(row.service)}</span>
                  </div>
                  <span>{row.events}</span>
                  <span>
                    {formatDisplayMoney(
                      row.customerCharge,
                      row.currency,
                      displayCurrencySettings,
                    )}
                  </span>
                </div>
              ))}
              <div className="usage-row usage-row-three usage-total-row">
                <div className="usage-breakdown-copy">
                  <strong>Total</strong>
                  <span>All provider and model usage in this range.</span>
                </div>
                <span>{usageReport.totals.events}</span>
                <span>
                  {formatDisplayMoney(
                    usageReport.totals.customerCharge,
                    usageReport.totals.currency,
                    displayCurrencySettings,
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="empty-copy">
              No metered usage in this date range yet.
            </p>
          )}
        </article>

      </div>
    </>
  );
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const activeWindow = normalizeUsageWindow(query?.window);
  const selectedSection = normalizeSettingsSection(query?.section);
  const [
    communicationSettings,
    generalSettings,
    integrationOverviews,
    pronunciationEntries,
    usageReport,
    voiceSettings,
  ] = await Promise.all([
    selectedSection === "communication"
      ? getCommunicationSettings(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "general" || selectedSection === "usage"
      ? getWorkspaceGeneralSettings(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "integrations"
      ? Promise.all([
          getGoogleIntegrationOverview(supabase, workspace.id),
          getMicrosoftIntegrationOverview(supabase, workspace.id),
          getInboundEmailSettings(supabase, workspace.id),
        ])
      : Promise.resolve(null),
    selectedSection === "voice"
      ? getPronunciationEntries(supabase, workspace.id)
      : Promise.resolve([]),
    selectedSection === "usage"
      ? getUsageReport(supabase, workspace.id, activeWindow)
      : Promise.resolve(null),
    selectedSection === "voice"
      ? getVoiceSettings(supabase, workspace.id)
      : Promise.resolve(null),
  ]);
  const googleOverview = integrationOverviews?.[0] ?? null;
  const microsoftOverview = integrationOverviews?.[1] ?? null;
  const inboundEmailSettings = integrationOverviews?.[2] ?? null;
  const googleStatus = googleOverview
    ? integrationStatusLabel(googleOverview)
    : "Open";
  const microsoftStatus = microsoftOverview
    ? integrationStatusLabel(microsoftOverview)
    : "Open";
  const settingsItems: SettingsMenuItem[] = [
    {
      detail: generalSettings
        ? `${generalSettings.timeZone} - ${generalSettings.displayCurrency}`
        : "Timezone, currency, and workspace defaults",
      eyebrow: "General",
      href: settingsSectionHref("general", activeWindow),
      section: "general",
      title: "System defaults",
    },
    {
      detail: communicationSettings
        ? `${communicationSettings.allowedChannels.length} channels`
        : "Approval rules, channels, and signatures",
      eyebrow: "Outbound",
      href: settingsSectionHref("communication", activeWindow),
      section: "communication",
      title: "Communication settings",
    },
    {
      detail: voiceSettings
        ? `${formatLabel(voiceSettings.openAiVoice)} voice`
        : "Realtime and playback voice controls",
      eyebrow: "Voice",
      href: settingsSectionHref("voice", activeWindow),
      section: "voice",
      title: "Voice assistant",
    },
    {
      detail: "Gmail, Drive, Outlook and Microsoft 365",
      eyebrow: "Integrations",
      href: settingsSectionHref("integrations", activeWindow),
      section: "integrations",
      title: "Connected accounts",
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
  ];
  const selectedDetail =
    selectedSection === "general" && generalSettings ? (
      <SettingsDetailShell
        eyebrow="General"
        title="System defaults"
      >
        <GeneralSettingsDetail settings={generalSettings} />
      </SettingsDetailShell>
    ) : selectedSection === "communication" && communicationSettings ? (
      <SettingsDetailShell
        eyebrow="Outbound"
        title="Communication settings"
      >
        <CommunicationSettingsDetail
          communicationSettings={communicationSettings}
        />
      </SettingsDetailShell>
    ) : selectedSection === "integrations" &&
      googleOverview &&
      microsoftOverview &&
      inboundEmailSettings ? (
      <SettingsDetailShell
        eyebrow="Integrations"
        title="Connected accounts"
      >
        <WorkspaceIntegrationsSettings
          googleOverview={googleOverview}
          googleStatus={googleStatus}
          inboundEmailSettings={inboundEmailSettings}
          microsoftOverview={microsoftOverview}
          microsoftStatus={microsoftStatus}
        />
      </SettingsDetailShell>
    ) : selectedSection === "usage" && usageReport && generalSettings ? (
      <SettingsDetailShell
        eyebrow="Usage"
        title="Usage and billing"
      >
        <UsageSettingsDetail
          activeWindow={activeWindow}
          displayCurrencySettings={generalSettings}
          usageReport={usageReport}
        />
      </SettingsDetailShell>
    ) : selectedSection === "voice" && voiceSettings ? (
      <SettingsDetailShell
        eyebrow="Voice"
        title="Voice assistant"
      >
        <VoiceSettingsDetail
          pronunciationEntries={pronunciationEntries}
          voiceSettings={voiceSettings}
        />
      </SettingsDetailShell>
    ) : null;

  return (
    <AppFrame
      active="Settings"
      topControls={
        selectedSection === "usage" ? (
          <UsageInternalCostPills
            displayCurrencySettings={generalSettings}
            usageReport={usageReport}
          />
        ) : null
      }
    >
      <header className="topbar settings-topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Settings</h1>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}

      <SettingsShell
        detail={selectedDetail}
        empty={<EmptySettingsDetail />}
        items={settingsItems}
        selectedSection={selectedSection}
      />
    </AppFrame>
  );
}
