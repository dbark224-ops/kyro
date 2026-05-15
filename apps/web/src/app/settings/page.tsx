import { AppFrame } from "../components/app-frame";
import {
  updateCommunicationSettingsAction,
  updateVoiceSettingsAction,
} from "./actions";
import {
  ELEVENLABS_VOICE_PRESETS,
  getVoiceSettings,
  elevenLabsVoicePresetById,
} from "../../lib/assistant/voice-settings";
import {
  OUTBOUND_CHANNELS,
  getCommunicationSettings,
  type EmailSignatureSettings,
} from "../../lib/communication/settings";
import {
  getUsageReport,
  normalizeUsageWindow,
  usageWindows,
  type UsageLedgerRow,
} from "../../lib/usage/queries";
import { getGoogleIntegrationOverview } from "../../lib/integrations/google";
import { getMicrosoftIntegrationOverview } from "../../lib/integrations/microsoft";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import Link from "next/link";
import {
  SettingsShell,
  type SettingsMenuItem,
  type SettingsSection,
} from "./settings-shell";

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

  if (value === "communication" || value === "usage" || value === "voice") {
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
  const maximumFractionDigits =
    Math.abs(value) > 0 && Math.abs(value) < 1 ? 6 : 2;

  return new Intl.NumberFormat("en", {
    currency,
    maximumFractionDigits,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
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
          <strong>Logo file</strong>
          <input
            accept="image/*"
            name={`${namePrefix}LogoFile`}
            type="file"
          />
          <span>
            Upload a small logo, up to 512 KB. This is sent inline with email
            signatures.
          </span>
        </label>

        <label className="setting-card">
          <strong>Logo URL fallback</strong>
          <input
            defaultValue={signature.logoUrl}
            name={`${namePrefix}LogoUrl`}
            placeholder="https://example.com/logo.png"
            type="url"
          />
          <span>
            Optional fallback if no logo file is uploaded.
          </span>
        </label>

        <label className="setting-card">
          <strong>Logo size</strong>
          <input
            defaultValue={signature.logoWidthPx}
            max={240}
            min={32}
            name={`${namePrefix}LogoWidthPx`}
            step={4}
            type="number"
          />
          <span>Width in pixels. Kyro keeps it between 32 and 240.</span>
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

function UsageSettingsLedger({ rows }: Readonly<{ rows: UsageLedgerRow[] }>) {
  if (rows.length === 0) {
    return (
      <p className="empty-copy">
        No usage events have been recorded for this range.
      </p>
    );
  }

  return (
    <div className="usage-ledger compact">
      {rows.slice(0, 8).map((row) => (
        <div className="usage-ledger-row" key={row.id}>
          <div className="usage-ledger-main">
            {row.sourceHref ? (
              <Link href={row.sourceHref} prefetch={false}>
                {row.sourceLabel}
              </Link>
            ) : (
              <strong>{row.sourceLabel}</strong>
            )}
            <span>
              {formatLabel(row.usageType)} - {row.provider} / {row.model}
            </span>
            {row.sourceMeta ? <p>{row.sourceMeta}</p> : null}
          </div>
          <div className="usage-ledger-meta">
            <span>{row.userName}</span>
            <span>
              {formatNumber(row.quantity)} {row.unit}
            </span>
            <strong>{formatMoney(row.customerCharge, row.currency)}</strong>
            <time>{formatDate(row.createdAt)}</time>
          </div>
        </div>
      ))}
    </div>
  );
}

type GoogleIntegrationOverview = Awaited<ReturnType<typeof getGoogleIntegrationOverview>>;
type MicrosoftIntegrationOverview = Awaited<ReturnType<typeof getMicrosoftIntegrationOverview>>;
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
  status,
  title,
}: Readonly<{
  children: React.ReactNode;
  eyebrow: string;
  status: string;
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
          <span className="pill">{status}</span>
          <Link className="secondary-button compact" href="/settings" prefetch={false}>
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
          Choose communication rules, workspace integrations, or billing and metering
          from the settings list to view and edit the full details here.
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

function combinedIntegrationStatusLabel(
  googleStatus: string,
  microsoftStatus: string,
  connectedCount: number,
) {
  if (connectedCount > 0) {
    return connectedCount === 1 ? "1 connected" : `${connectedCount} connected`;
  }

  if (
    googleStatus === "Needs attention" ||
    microsoftStatus === "Needs attention"
  ) {
    return "Needs attention";
  }

  if (
    googleStatus === "Ready to connect" ||
    microsoftStatus === "Ready to connect"
  ) {
    return "Ready to connect";
  }

  if (googleStatus === "Migration pending" || microsoftStatus === "Migration pending") {
    return "Migration pending";
  }

  if (
    googleStatus === "Encryption key needed" ||
    microsoftStatus === "Encryption key needed"
  ) {
    return "Encryption key needed";
  }

  return "Keys needed";
}

function GoogleIntegrationSettings({
  overview,
}: Readonly<{ overview: GoogleIntegrationOverview }>) {
  const canConnect =
    overview.configured && overview.encryptionReady && overview.migrationReady;

  return (
    <>
      <div className="integration-summary-grid">
        <article className="setting-card">
          <strong>Gmail outbound</strong>
          <span>
            Approved and user-triggered email replies can send through the connected
            Gmail account.
          </span>
        </article>
        <article className="setting-card">
          <strong>Google Drive documents</strong>
          <span>
            Drive access for quote and invoice documents Kyro creates or the user explicitly
            opens with Kyro.
          </span>
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

      {overview.error ? <p className="form-alert error">{overview.error}</p> : null}
      {!overview.migrationReady ? (
        <p className="form-alert">
          Integration tables are not in the database yet. Run{" "}
          <code>npm.cmd run db:migrate</code> before connecting Google.
        </p>
      ) : null}
      {!overview.configured ? (
        <p className="form-alert">
          Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and{" "}
          <code>NEXT_PUBLIC_APP_URL</code> before starting OAuth.
        </p>
      ) : null}
      {!overview.encryptionReady ? (
        <p className="form-alert">
          Add <code>INTEGRATION_TOKEN_ENCRYPTION_KEY</code> so refresh tokens are encrypted
          before storage.
        </p>
      ) : null}

      {overview.connections.length > 0 ? (
        <div className="usage-ledger compact">
          {overview.connections.map((connection) => (
            <div className="usage-ledger-row" key={connection.id}>
              <div className="usage-ledger-main">
                <strong>
                  {connection.accountEmail ?? connection.accountName ?? "Google account"}
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
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">No Google account is connected yet.</p>
      )}

      <div className="settings-footer">
        <span>Connect once, then Kyro can use Gmail and Drive through policies.</span>
        {canConnect ? (
          <Link
            className="primary-button compact link-button"
            href="/integrations/google/start"
          >
            Connect Google
          </Link>
        ) : (
          <span className="pill warning">Setup required</span>
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

  return (
    <>
      <div className="integration-summary-grid">
        <article className="setting-card">
          <strong>Outlook outbound</strong>
          <span>
            Approved and user-triggered email replies can send through the connected
            Outlook or Microsoft 365 mailbox.
          </span>
        </article>
        <article className="setting-card">
          <strong>Microsoft Graph</strong>
          <span>
            Uses Microsoft OAuth and Graph Mail.Send, matching the same audit and
            permission model as Gmail.
          </span>
        </article>
      </div>

      {overview.redirectUri ? (
        <div className="detail-list compact-detail-list">
          <div>
            <span>Redirect URI</span>
            <strong>{overview.redirectUri}</strong>
            <small>Use this exact URL in the Microsoft Entra app registration.</small>
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

      {overview.error ? <p className="form-alert error">{overview.error}</p> : null}
      {!overview.migrationReady ? (
        <p className="form-alert">
          Integration tables are not in the database yet. Run{" "}
          <code>npm.cmd run db:migrate</code> before connecting Microsoft.
        </p>
      ) : null}
      {!overview.configured ? (
        <p className="form-alert">
          Add <code>MICROSOFT_CLIENT_ID</code>, <code>MICROSOFT_CLIENT_SECRET</code>,{" "}
          <code>MICROSOFT_TENANT_ID</code>, and <code>NEXT_PUBLIC_APP_URL</code> before
          starting OAuth.
        </p>
      ) : null}
      {!overview.encryptionReady ? (
        <p className="form-alert">
          Add <code>INTEGRATION_TOKEN_ENCRYPTION_KEY</code> so refresh tokens are encrypted
          before storage.
        </p>
      ) : null}

      {overview.connections.length > 0 ? (
        <div className="usage-ledger compact">
          {overview.connections.map((connection) => (
            <div className="usage-ledger-row" key={connection.id}>
              <div className="usage-ledger-main">
                <strong>
                  {connection.accountEmail ?? connection.accountName ?? "Outlook account"}
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
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">No Outlook account is connected yet.</p>
      )}

      <div className="settings-footer">
        <span>Connect once, then Kyro can send Outlook email through the same policies.</span>
        {canConnect ? (
          <Link
            className="primary-button compact link-button"
            href="/integrations/microsoft/start"
          >
            Connect Outlook
          </Link>
        ) : (
          <span className="pill warning">Setup required</span>
        )}
      </div>
    </>
  );
}

type ProviderConnection = {
  accountEmail: string | null;
  accountName: string | null;
  lastConnectedAt: string | null;
  status: string;
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

function providerChoiceStatus({
  anyConnected,
  connected,
  status,
}: {
  anyConnected: boolean;
  connected: boolean;
  status: string;
}) {
  if (connected) {
    return "Connected";
  }

  if (anyConnected && status === "Keys needed") {
    return "Optional setup";
  }

  return status;
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
  microsoftOverview,
  microsoftStatus,
}: Readonly<{
  googleOverview: GoogleIntegrationOverview;
  googleStatus: string;
  microsoftOverview: MicrosoftIntegrationOverview;
  microsoftStatus: string;
}>) {
  const googleConnection = latestConnectedConnection(googleOverview.connections);
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

  return (
    <div className="integration-provider-stack">
      <section className="integration-choice-panel">
        <div>
          <p className="eyebrow">Email provider</p>
          <h3>
            {currentProviderName
              ? `${currentProviderName} is connected`
              : "Connect Gmail or Outlook"}
          </h3>
          <p>
            Kyro only needs one outbound email provider. Connect Gmail or Outlook;
            if both are connected during testing, Kyro uses the most recently
            connected account until we add a default sender setting.
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
          <strong>Outbound permission</strong>
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
          <span>
            Email sends through the connected Gmail or Outlook account. Other
            channels stay internal until their providers are connected.
          </span>
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
          <div>
            <strong>Email signatures</strong>
            <span>Default signature plus optional assistant signature.</span>
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
              <span>Use a different signature for untouched AI-sent emails</span>
            </label>
            <label className="compact-checkbox-row">
              <input name="duplicateManualSignature" type="checkbox" />
              <span>Copy the default signature into the assistant signature when saving</span>
            </label>
          </fieldset>

          <EmailSignatureEditor
            description="Used only when an AI generated reply is sent without the user changing the subject or body."
            namePrefix="aiGeneratedSignature"
            signature={communicationSettings.aiGeneratedSignature}
            title="AI assistant signature"
          />

          <div className="settings-footer compact-settings-footer">
            <span>Save to refresh the signature previews and apply them to future Gmail sends.</span>
            <button className="primary-button compact" type="submit">
              Save and preview signatures
            </button>
          </div>
        </div>
      </details>

      <div className="settings-footer">
        <span>Connected email providers can send real email; SMS and phone are internal records.</span>
        <button className="primary-button compact" type="submit">
          Save settings
        </button>
      </div>
    </form>
  );
}

function VoiceSettingsDetail({
  voiceSettings,
}: Readonly<{
  voiceSettings: Awaited<ReturnType<typeof getVoiceSettings>>;
}>) {
  const selectedPreset = elevenLabsVoicePresetById(
    voiceSettings.elevenLabsVoicePresetId,
  );

  return (
    <form action={updateVoiceSettingsAction} className="settings-form">
      <div className="settings-grid">
        <label className="setting-card">
          <strong>Speech provider</strong>
          <select defaultValue={voiceSettings.provider} name="voiceProvider">
            <option value="elevenlabs">ElevenLabs</option>
            <option value="openai">OpenAI</option>
          </select>
          <span>
            Voice replies use this provider after Kyro has generated the text response.
          </span>
        </label>

        <label className="setting-card">
          <strong>ElevenLabs voice</strong>
          <select
            defaultValue={selectedPreset.id}
            name="elevenLabsVoicePresetId"
          >
            {ELEVENLABS_VOICE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <span>{selectedPreset.accent} voice preset for live voice replies.</span>
        </label>
      </div>

      <div className="settings-grid">
        <label className="setting-card">
          <strong>ElevenLabs model</strong>
          <select
            defaultValue={voiceSettings.elevenLabsModel}
            name="elevenLabsModel"
          >
            <option value="eleven_flash_v2_5">eleven_flash_v2_5</option>
            <option value="eleven_turbo_v2_5">eleven_turbo_v2_5</option>
            <option value="eleven_multilingual_v2">eleven_multilingual_v2</option>
          </select>
          <span>Flash is the fastest option for push-to-talk testing.</span>
        </label>

        <label className="setting-card">
          <strong>Audio format</strong>
          <select
            defaultValue={voiceSettings.elevenLabsOutputFormat}
            name="elevenLabsOutputFormat"
          >
            <option value="mp3_44100_128">MP3 44.1 kHz</option>
            <option value="mp3_44100_192">MP3 44.1 kHz high</option>
            <option value="mp3_22050_32">MP3 22.05 kHz small</option>
          </select>
          <span>MP3 avoids the WAV playback-speed weirdness we hit earlier.</span>
        </label>
      </div>

      <details className="settings-accordion">
        <summary>
          <div>
            <strong>Voice tuning</strong>
            <span>Stability, similarity, style, and speaker boost.</span>
          </div>
          <span className="pill">Advanced</span>
        </summary>

        <div className="settings-accordion-body">
          <div className="settings-grid">
            <label className="setting-card">
              <strong>Stability</strong>
              <input
                defaultValue={voiceSettings.elevenLabsStability}
                max={1}
                min={0}
                name="elevenLabsStability"
                step={0.05}
                type="number"
              />
              <span>Lower can sound more expressive; higher is steadier.</span>
            </label>
            <label className="setting-card">
              <strong>Similarity boost</strong>
              <input
                defaultValue={voiceSettings.elevenLabsSimilarityBoost}
                max={1}
                min={0}
                name="elevenLabsSimilarityBoost"
                step={0.05}
                type="number"
              />
              <span>How closely ElevenLabs should preserve the selected voice.</span>
            </label>
            <label className="setting-card">
              <strong>Style</strong>
              <input
                defaultValue={voiceSettings.elevenLabsStyle}
                max={1}
                min={0}
                name="elevenLabsStyle"
                step={0.05}
                type="number"
              />
              <span>Extra expressiveness. Keep low for a practical assistant.</span>
            </label>
            <label className="compact-checkbox-row setting-card">
              <input
                defaultChecked={voiceSettings.elevenLabsUseSpeakerBoost}
                name="elevenLabsUseSpeakerBoost"
                type="checkbox"
              />
              <span>Use speaker boost</span>
            </label>
          </div>
        </div>
      </details>

      <div className="settings-footer">
        <span>
          Current ElevenLabs default: {selectedPreset.label}. OpenAI still uses its
          own voice env setting.
        </span>
        <button className="primary-button compact" type="submit">
          Save voice settings
        </button>
      </div>
    </form>
  );
}

function UsageSettingsDetail({
  activeWindow,
  usageReport,
}: Readonly<{
  activeWindow: string;
  usageReport: Awaited<ReturnType<typeof getUsageReport>>;
}>) {
  return (
    <>
      <section
        className="metric-grid settings-usage-metrics"
        aria-label="Usage metrics"
      >
        <article className="metric-card cyan">
          <p>Provider cost</p>
          <strong>
            {formatMoney(
              usageReport.totals.providerCost,
              usageReport.totals.currency,
            )}
          </strong>
          <span>{usageReport.totals.events} ledger events</span>
        </article>
        <article className="metric-card purple">
          <p>Customer charge</p>
          <strong>
            {formatMoney(
              usageReport.totals.customerCharge,
              usageReport.totals.currency,
            )}
          </strong>
          <span>
            {formatNumber(usageReport.totals.quantity)} metered units
          </span>
        </article>
        <article className="metric-card pink">
          <p>Gross margin</p>
          <strong>
            {formatMoney(
              usageReport.totals.grossMargin,
              usageReport.totals.currency,
            )}
          </strong>
          <span>Before payment processing</span>
        </article>
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
              <h2>Provider and model</h2>
            </div>
          </div>
          {usageReport.providerBreakdown.length > 0 ? (
            <div className="usage-table">
              <div className="usage-row heading" aria-hidden="true">
                <span>Provider / model</span>
                <span>Events</span>
                <span>Cost</span>
                <span>Charge</span>
              </div>
              {usageReport.providerBreakdown.map((row) => (
                <div className="usage-row" key={row.key}>
                  <div>
                    <strong>
                      {row.model === "n/a"
                        ? row.provider
                        : `${row.provider} / ${row.model}`}
                    </strong>
                    <span>{formatLabel(row.service)}</span>
                  </div>
                  <span>{row.events}</span>
                  <span>{formatMoney(row.providerCost, row.currency)}</span>
                  <span>{formatMoney(row.customerCharge, row.currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-copy">No metered usage in this date range yet.</p>
          )}
        </article>

        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Ledger</p>
              <h2>Recent usage events</h2>
            </div>
          </div>
          <UsageSettingsLedger rows={usageReport.ledger} />
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
  const [
    communicationSettings,
    usageReport,
    googleOverview,
    microsoftOverview,
    voiceSettings,
  ] = await Promise.all([
      getCommunicationSettings(supabase, workspace.id),
      getUsageReport(supabase, workspace.id, activeWindow),
      getGoogleIntegrationOverview(supabase, workspace.id),
      getMicrosoftIntegrationOverview(supabase, workspace.id),
      getVoiceSettings(supabase, workspace.id),
    ]);
  const selectedSection = normalizeSettingsSection(query?.section);
  const googleStatus = integrationStatusLabel(googleOverview);
  const microsoftStatus = integrationStatusLabel(microsoftOverview);
  const gmailConnected = googleOverview.connections.some(
    (connection) => connection.status === "connected"
  );
  const outlookConnected = microsoftOverview.connections.some(
    (connection) => connection.status === "connected"
  );
  const connectedEmailProviderCount =
    Number(gmailConnected) + Number(outlookConnected);
  const integrationsStatus = combinedIntegrationStatusLabel(
    googleStatus,
    microsoftStatus,
    connectedEmailProviderCount,
  );
  const outboundStatus = communicationSettings.approvalRequired
    ? "Approval required"
    : "Direct send";
  const voicePreset = elevenLabsVoicePresetById(
    voiceSettings.elevenLabsVoicePresetId,
  );
  const settingsItems: SettingsMenuItem[] = [
    {
      detail: `${communicationSettings.allowedChannels.length} channels`,
      eyebrow: "Outbound",
      href: settingsSectionHref("communication", activeWindow),
      section: "communication",
      status: outboundStatus,
      title: "Communication settings",
    },
    {
      detail:
        voiceSettings.provider === "elevenlabs"
          ? voicePreset.label
          : "OpenAI text-to-speech",
      eyebrow: "Voice",
      href: settingsSectionHref("voice", activeWindow),
      section: "voice",
      status: formatLabel(voiceSettings.provider),
      title: "Voice assistant",
    },
    {
      detail: "Gmail, Drive, Outlook and Microsoft 365",
      eyebrow: "Integrations",
      href: settingsSectionHref("integrations", activeWindow),
      section: "integrations",
      status: integrationsStatus,
      title: "Connected accounts",
    },
    {
      detail: `${usageReport.totals.events} ledger events - ${formatMoney(
        usageReport.totals.providerCost,
        usageReport.totals.currency,
      )} provider cost`,
      eyebrow: "Usage",
      href: settingsSectionHref("usage", activeWindow),
      section: "usage",
      status: formatDate(usageReport.generatedAt),
      title: "Billing and metering",
    },
  ];

  return (
    <AppFrame active="Settings">
      <header className="topbar">
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
        communication={
          <SettingsDetailShell
            eyebrow="Outbound"
            status={
              gmailConnected || outlookConnected
                ? "Email active"
                : "Needs email provider"
            }
            title="Communication settings"
          >
            <CommunicationSettingsDetail
              communicationSettings={communicationSettings}
            />
          </SettingsDetailShell>
        }
        empty={<EmptySettingsDetail />}
        initialSection={selectedSection}
        integrations={
          <SettingsDetailShell
            eyebrow="Integrations"
            status={integrationsStatus}
            title="Connected accounts"
          >
            <WorkspaceIntegrationsSettings
              googleOverview={googleOverview}
              googleStatus={googleStatus}
              microsoftOverview={microsoftOverview}
              microsoftStatus={microsoftStatus}
            />
          </SettingsDetailShell>
        }
        items={settingsItems}
        usage={
          <SettingsDetailShell
            eyebrow="Usage"
            status={`Generated ${formatDate(usageReport.generatedAt)}`}
            title="Billing and metering"
          >
            <UsageSettingsDetail
              activeWindow={activeWindow}
              usageReport={usageReport}
            />
          </SettingsDetailShell>
        }
        voice={
          <SettingsDetailShell
            eyebrow="Voice"
            status={
              voiceSettings.provider === "elevenlabs"
                ? "ElevenLabs"
                : "OpenAI"
            }
            title="Voice assistant"
          >
            <VoiceSettingsDetail voiceSettings={voiceSettings} />
          </SettingsDetailShell>
        }
      />
    </AppFrame>
  );
}
