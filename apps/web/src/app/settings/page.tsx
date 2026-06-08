import { AppFrame } from "../components/app-frame";
import {
  disconnectIntegrationAction,
  enableWorkspacePhoneSmsAction,
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
  ELEVENLABS_VOICE_PRESETS,
  OPENAI_VOICE_OPTIONS,
  OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
  PHONE_AGENT_DEMEANORS,
  PHONE_AGENT_ESCALATION_MODES,
  PHONE_AGENT_HUMOUR_LEVELS,
  PHONE_AGENT_VERBOSITIES,
  elevenLabsVoicePresetById,
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
  MAX_FOLLOW_UP_DELAY_DAYS,
  MIN_FOLLOW_UP_DELAY_DAYS,
  OUTBOUND_CHANNELS,
  REPLY_MESSAGE_LENGTH_OPTIONS,
  getCommunicationSettings,
  type CommunicationSettings,
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
  INBOUND_EMAIL_SYNC_MODES,
  getInboundEmailOperationalSummary,
  getInboundEmailSettings,
  type InboundEmailDecisionItem,
  type InboundEmailOperationalSummary,
  type InboundEmailSenderRule,
  type InboundEmailSyncHistoryItem,
} from "../../lib/integrations/inbound-email-settings";
import {
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_PROVIDER,
  getMicrosoftIntegrationOverview,
} from "../../lib/integrations/microsoft";
import {
  getTwilioTelephonyOverview,
  type TwilioTelephonyOverview,
} from "../../lib/integrations/twilio";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import {
  getWorkspaceGeneralSettings,
  type WorkspaceGeneralSettings,
} from "../../lib/workspace/general-settings";
import {
  OPERATING_COUNTRY_OPTIONS,
  operatingCountryForPhoneRegion,
  operatingCountryPhoneRegion,
} from "../../lib/workspace/operating-countries";
import {
  getAvailableWorkspacePhoneNumbersFromPool,
  getWorkspaceAssignedPhoneNumbers,
  type WorkspacePhoneNumberPoolRow,
} from "../../lib/voice/phone-number-pool";
import { createServiceSupabaseClient } from "../../lib/supabase/service";
import { PHONE_REGION_OPTIONS } from "../../lib/crm/identity";
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
    inboundTrace?: string;
    section?: string;
    senderRules?: string;
    window?: string;
  }>;
};

function normalizeSettingsSection(value: string | undefined) {
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

function pluralCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
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
type TwilioIntegrationOverview = TwilioTelephonyOverview;
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

function OutboundWritingStyleEditor({
  communicationSettings,
}: Readonly<{
  communicationSettings: Awaited<ReturnType<typeof getCommunicationSettings>>;
}>) {
  const writing = communicationSettings.replyWriting;

  return (
    <details className="settings-accordion">
      <summary>
        <div className="settings-accordion-title">
          <strong>Outbound writing style</strong>
          <InfoBubble>
            These instructions are injected into AI-generated email and SMS
            reply drafts.
          </InfoBubble>
        </div>
        <span className="pill">Prompt editor</span>
      </summary>

      <div className="settings-accordion-body">
        <div className="settings-grid">
          <label className="setting-card">
            <SettingCardHeading info="The customer-facing feel Kyro should use.">
              Tone
            </SettingCardHeading>
            <input
              defaultValue={writing.tone}
              name="replyTone"
              placeholder="Friendly and direct"
              type="text"
            />
          </label>

          <label className="setting-card">
            <SettingCardHeading info="How much detail should a normal draft include.">
              Message length
            </SettingCardHeading>
            <select
              defaultValue={writing.messageLength}
              name="replyMessageLength"
            >
              {REPLY_MESSAGE_LENGTH_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {formatLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="settings-textarea">
          Wording style
          <textarea
            defaultValue={writing.wordingStyle}
            name="replyWordingStyle"
            placeholder="Plain English, practical, helpful, no corporate fluff..."
          />
        </label>

        <label className="settings-textarea">
          Trade-specific phrasing
          <textarea
            defaultValue={writing.tradePhrasing}
            name="replyTradePhrasing"
            placeholder="Use normal plumbing terms, ask for photos when useful, mention site visits naturally..."
          />
        </label>

        <label className="settings-textarea">
          Sign-off instructions
          <textarea
            defaultValue={writing.signOff}
            name="replySignOff"
            placeholder="Use the saved email signature and avoid duplicate sign-offs..."
          />
        </label>

        <label className="settings-textarea">
          Reusable reply instructions
          <textarea
            defaultValue={writing.reusableInstructions}
            name="replyReusableInstructions"
            placeholder="Always ask for site access details on quote replies. Avoid promising exact arrival times unless the user provided one."
          />
        </label>
      </div>
    </details>
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
        <div
          className="usage-ledger compact"
          id="google-connected-email-accounts"
        >
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
        <div
          className="usage-ledger compact"
          id="microsoft-connected-email-accounts"
        >
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

function twilioStatusLabel(overview: TwilioIntegrationOverview) {
  if (!overview.migrationReady) {
    return "Migration needed";
  }

  if (!overview.configured) {
    return "Keys needed";
  }

  if (overview.numbers.some((number) => number.capabilities.sms)) {
    return "Ready";
  }

  if (overview.defaultFromNumber) {
    return "Outbound ready";
  }

  return "Number needed";
}

function TwilioTelephonySettings({
  availableNumbers,
  generalSettings,
  overview,
}: Readonly<{
  availableNumbers: WorkspacePhoneNumberPoolRow[];
  generalSettings: WorkspaceGeneralSettings;
  overview: TwilioIntegrationOverview;
}>) {
  const smsNumber = overview.numbers.find((number) => number.capabilities.sms);
  const activeVoiceSmsNumber = overview.numbers.find(
    (number) => number.capabilities.sms && number.capabilities.voice,
  );
  const operatingCountry =
    generalSettings.businessProfile.operatingCountry ||
    operatingCountryForPhoneRegion(generalSettings.defaultPhoneRegion) ||
    "your selected country";
  const phoneRegion =
    operatingCountryPhoneRegion(generalSettings.businessProfile.operatingCountry) ??
    generalSettings.defaultPhoneRegion;

  return (
    <>
      <div className="integration-summary-grid">
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Kyro-owned numbers receive customer SMS through Twilio webhooks
                and promote useful messages into the same CRM pipeline as email.
              </>
            }
          >
            Inbound SMS
          </SettingCardHeading>
        </article>
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Approved or user-triggered SMS replies send through Twilio when
                the workspace has an active SMS-capable number or configured
                sender.
              </>
            }
          >
            Outbound SMS
          </SettingCardHeading>
        </article>
      </div>

      {!overview.migrationReady ? (
        <p className="form-alert">
          Phone-number tables are not in the database yet. Run{" "}
          <code>npm.cmd run db:migrate</code> before connecting Twilio numbers.
        </p>
      ) : null}
      {!overview.configured ? (
        <p className="form-alert">
          Add <code>TWILIO_ACCOUNT_SID</code> and{" "}
          <code>TWILIO_AUTH_TOKEN</code> before sending or receiving SMS.
        </p>
      ) : null}
      {overview.configured && !overview.inboundSmsWebhookUrl ? (
        <p className="form-alert">
          Add <code>NEXT_PUBLIC_APP_URL</code> so Twilio can call the inbound
          SMS and status callback webhooks.
        </p>
      ) : null}

      <div className="usage-ledger compact">
        <div className="usage-ledger-row">
          <div className="usage-ledger-main">
            <strong>Inbound SMS webhook</strong>
            <span>{overview.inboundSmsWebhookUrl ?? "App URL needed"}</span>
          </div>
        </div>
        <div className="usage-ledger-row">
          <div className="usage-ledger-main">
            <strong>Delivery status callback</strong>
            <span>{overview.statusCallbackUrl ?? "App URL needed"}</span>
          </div>
        </div>
      </div>

      <section className="setting-card phone-number-enable-card">
        <SettingCardHeading
          info={
            <>
              This assigns one Kyro-owned Twilio number to the workspace. It can
              receive SMS, send SMS, receive calls, and make assistant calls via
              Vapi when the matching Vapi number is configured.
            </>
          }
        >
          Phone and SMS assistant number
        </SettingCardHeading>
        {activeVoiceSmsNumber ? (
          <div className="phone-number-active-panel">
            <div>
              <strong>{activeVoiceSmsNumber.phoneNumber}</strong>
              <span>
                {[
                  activeVoiceSmsNumber.friendlyName,
                  activeVoiceSmsNumber.countryCode,
                  "SMS + voice enabled",
                ]
                  .filter(Boolean)
                  .join(" - ")}
              </span>
            </div>
            <span className="pill">Enabled</span>
          </div>
        ) : (
          <form action={enableWorkspacePhoneSmsAction} className="settings-form">
            <p className="empty-copy">
              Enable inbound and outbound SMS plus inbound and outbound phone
              calls by choosing an available {operatingCountry} number. A
              one-time <strong>US$6</strong> setup charge will be added to the
              usage ledger when the number is assigned.
            </p>
            {availableNumbers.length > 0 ? (
              <div className="phone-number-choice-list">
                {availableNumbers.map((number, index) => (
                  <label className="phone-number-choice" key={number.id}>
                    <input
                      defaultChecked={index === 0}
                      name="phoneNumberId"
                      type="radio"
                      value={number.id}
                    />
                    <span>
                      <strong>{number.phoneNumber}</strong>
                      <small>
                        {[
                          number.friendlyName,
                          number.region,
                          number.countryCode,
                          number.vapiPhoneNumberId ? "Vapi linked" : null,
                        ]
                          .filter(Boolean)
                          .join(" - ")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="form-alert">
                No available {phoneRegion} voice-and-SMS numbers are in the
                Kyro pool yet. Add one to <code>workspace_phone_numbers</code>{" "}
                with <code>status = available</code> and no workspace owner.
              </p>
            )}
            <div className="settings-footer compact-settings-footer">
              <span>
                Once assigned, the number is reserved to this workspace and will
                not be offered to another account.
              </span>
              <button
                className="primary-button compact"
                disabled={availableNumbers.length === 0}
                type="submit"
              >
                Enable phone and SMS
              </button>
            </div>
          </form>
        )}
      </section>

      {overview.numbers.length > 0 ? (
        <div className="usage-ledger compact">
          {overview.numbers.map((number) => (
            <div className="usage-ledger-row" key={number.id}>
              <div className="usage-ledger-main">
                <strong>{number.friendlyName ?? number.phoneNumber}</strong>
                <span>
                  {[
                    number.capabilities.sms ? "SMS" : null,
                    number.capabilities.voice ? "Voice" : null,
                    number.countryCode,
                    formatLabel(number.status),
                  ]
                    .filter(Boolean)
                    .join(" - ")}
                </span>
              </div>
              <span className="pill">
                {number.monthlyCostSnapshot > 0
                  ? formatMoney(number.monthlyCostSnapshot, number.currency)
                  : "Workspace number"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">
          No workspace Twilio number is registered yet. Outbound can use the
          configured sender number for testing, but inbound SMS needs a
          workspace phone-number record so Kyro knows which account owns the
          message.
        </p>
      )}

      <p className="empty-copy">
        Beta setup uses Kyro&apos;s pre-purchased number pool. When phone/SMS is
        enabled, Kyro assigns one available voice-and-SMS number for the
        workspace country. Later, this path can switch to automatic Twilio
        purchase and Vapi setup without changing the workspace number model.
      </p>

      {smsNumber ? (
        <p className="empty-copy">
          Active SMS number: <strong>{smsNumber.phoneNumber}</strong>
        </p>
      ) : overview.defaultFromNumber ? (
        <p className="empty-copy">
          Testing sender: <strong>{overview.defaultFromNumber}</strong>
        </p>
      ) : null}
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

function providerConnectedAccountsAnchor(
  provider: EmailProviderConnection["provider"],
) {
  return provider === "google"
    ? "google-connected-email-accounts"
    : "microsoft-connected-email-accounts";
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
  return (
    connections
      .map((connection) => connection[key])
      .filter((value): value is string => Boolean(value))
      .sort(
        (left, right) => new Date(right).getTime() - new Date(left).getTime(),
      )[0] ?? null
  );
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
    (connection) =>
      connection.lastError && !connectionNeedsReconnect(connection),
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
      detail:
        "Scheduled polling is off. Manual and assistant-triggered checks still work.",
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
  return rule.createdAt
    ? `Added ${formatDate(rule.createdAt)}`
    : "Added before tracking";
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
          <strong>
            {lastCheckedAt ? formatDate(lastCheckedAt) : "Not yet"}
          </strong>
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
            const hasFailure = connection.lastError && !needsReconnect;

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
                {needsReconnect ? (
                  <Link
                    className="pill warning link-pill"
                    href={`#${providerConnectedAccountsAnchor(connection.provider)}`}
                  >
                    Reconnect
                  </Link>
                ) : (
                  <span
                    className={hasFailure ? "pill warning" : "pill success"}
                  >
                    {hasFailure ? "Failed" : "Ready"}
                  </span>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function syncRunSummary(run: InboundEmailSyncHistoryItem) {
  const parts = [
    `${run.fetchedMessages} fetched`,
    `${run.promotedMessages} promoted`,
    `${run.observedMessages} observed`,
  ];

  if (run.duplicates > 0) {
    parts.push(pluralCount(run.duplicates, "duplicate"));
  }

  if (run.needsReconnect > 0) {
    parts.push(`${run.needsReconnect} reconnect`);
  }

  if (run.errors > 0) {
    parts.push(`${run.errors} error${run.errors === 1 ? "" : "s"}`);
  }

  if (run.skippedBySchedule > 0) {
    parts.push(`${run.skippedBySchedule} schedule skip`);
  }

  return parts.join(" - ");
}

function syncRunTone(run: InboundEmailSyncHistoryItem) {
  if (run.errors > 0 || run.needsReconnect > 0) {
    return "warning";
  }

  if (run.promotedMessages > 0) {
    return "promoted";
  }

  return "observed";
}

function inboundDecisionTone(decision: InboundEmailDecisionItem) {
  if (decision.stage === "promoted") {
    return "promoted";
  }

  if (decision.status !== "processed") {
    return "warning";
  }

  return "observed";
}

function inboundDecisionLabel(decision: InboundEmailDecisionItem) {
  if (decision.stage === "promoted") {
    return "Promoted";
  }

  if (decision.category) {
    return formatLabel(decision.category);
  }

  return formatLabel(decision.status);
}

function InboundEmailOperationsPanel({
  showTrace,
  summary,
}: Readonly<{
  showTrace: boolean;
  summary: InboundEmailOperationalSummary;
}>) {
  const recordCount = summary.syncRuns.length + summary.decisions.length;

  return (
    <section className="email-sync-ops-panel">
      <div className="panel-heading compact-panel-heading">
        <div>
          <p className="eyebrow">Inbound trace</p>
          <h3>Sync runs and decisions</h3>
          <p>Review recent polling and email-classification history.</p>
        </div>
        <div className="email-sync-ops-actions">
          <span className="pill">{recordCount} records</span>
          <Link
            className="secondary-button compact"
            href="/settings?section=integrations&inboundTrace=1"
          >
            Open trace log
          </Link>
        </div>
      </div>

      <div className="email-sync-ops-summary">
        <span>{summary.syncRuns.length} sync runs</span>
        <span>{summary.decisions.length} email decisions</span>
      </div>

      {showTrace ? <InboundEmailTraceModal summary={summary} /> : null}
    </section>
  );
}

function InboundEmailTraceModal({
  summary,
}: Readonly<{
  summary: InboundEmailOperationalSummary;
}>) {
  const recordCount = summary.syncRuns.length + summary.decisions.length;

  return (
    <div className="sender-rules-modal-backdrop email-sync-ops-modal-backdrop">
      <section
        aria-labelledby="inbound-trace-title"
        aria-modal="true"
        className="sender-rules-modal email-sync-ops-modal"
        role="dialog"
      >
        <div className="sender-rules-modal-header">
          <div>
            <p className="eyebrow">Inbound trace</p>
            <h3 id="inbound-trace-title">Recent sync runs and decisions</h3>
            <p>
              Read-only operational history for polling runs and provider email
              classification decisions.
            </p>
          </div>
          <div className="sender-rules-modal-actions">
            <span className="pill">{recordCount} records</span>
            <Link
              className="secondary-button compact"
              href="/settings?section=integrations"
            >
              Close
            </Link>
          </div>
        </div>

        <div className="sender-rules-modal-body email-sync-ops-modal-body">
          <div className="email-sync-ops-grid">
            <article className="email-sync-ops-card">
              <div className="email-sync-ops-heading">
                <strong>Sync runs</strong>
                <span>Last {summary.syncRuns.length}</span>
              </div>
              {summary.syncRuns.length > 0 ? (
                <div className="email-sync-ops-list">
                  {summary.syncRuns.map((run) => (
                    <div className="email-sync-ops-row" key={run.id}>
                      <span className={`email-sync-dot ${syncRunTone(run)}`} />
                      <div>
                        <strong>{formatLabel(run.trigger)}</strong>
                        <span>{syncRunSummary(run)}</span>
                      </div>
                      <time dateTime={run.createdAt}>
                        {formatDate(run.createdAt)}
                      </time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">No sync runs recorded yet.</p>
              )}
            </article>

            <article className="email-sync-ops-card">
              <div className="email-sync-ops-heading">
                <strong>Email decisions</strong>
                <span>Last {summary.decisions.length}</span>
              </div>
              {summary.decisions.length > 0 ? (
                <div className="email-sync-ops-list">
                  {summary.decisions.map((decision) => (
                    <div className="email-sync-ops-row" key={decision.id}>
                      <span
                        className={`email-sync-dot ${inboundDecisionTone(
                          decision,
                        )}`}
                      />
                      <div>
                        <strong>{decision.subject}</strong>
                        <span>
                          {inboundDecisionLabel(decision)} -{" "}
                          {decision.providerUsed
                            ? formatLabel(decision.providerUsed)
                            : "No classifier"}
                        </span>
                      </div>
                      <time
                        dateTime={decision.processedAt ?? decision.createdAt}
                      >
                        {formatDate(decision.processedAt ?? decision.createdAt)}
                      </time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">
                  No inbound email decisions recorded yet.
                </p>
              )}
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}

function SenderRulesLauncher({
  rules,
}: Readonly<{
  rules: InboundEmailSenderRule[];
}>) {
  return (
    <section className="sender-rules-launcher">
      <div>
        <p className="eyebrow">Sender learning</p>
        <div className="setting-card-heading">
          <h3>Sender rules</h3>
          <InfoBubble>
            Sender rules override normal email classification. Use them for
            senders Kyro should always treat as business-relevant or always keep
            out of the work queue.
          </InfoBubble>
        </div>
        <p>
          Keep permanent promote and ignore rules out of the main settings flow.
        </p>
      </div>
      <div className="sender-rules-launcher-actions">
        <span className="pill">
          {rules.length} {rules.length === 1 ? "rule" : "rules"}
        </span>
        <Link
          className="secondary-button compact"
          href="/settings?section=integrations&senderRules=1"
        >
          Manage senders
        </Link>
      </div>
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
    <div className="sender-rules-modal-backdrop">
      <section
        aria-labelledby="sender-rules-title"
        aria-modal="true"
        className="sender-rules-modal"
        role="dialog"
      >
        <div className="sender-rules-modal-header">
          <div>
            <p className="eyebrow">Sender learning</p>
            <div className="setting-card-heading">
              <h3 id="sender-rules-title">Sender rules</h3>
              <InfoBubble>
                Sender rules override normal email classification. Use them for
                senders Kyro should always treat as business-relevant or always
                keep out of the work queue.
              </InfoBubble>
            </div>
            <p>
              Add, edit, or remove permanent rules for senders and domains Kyro
              has learned from inbound mail.
            </p>
          </div>
          <div className="sender-rules-modal-actions">
            <span className="pill">
              {sortedRules.length} {sortedRules.length === 1 ? "rule" : "rules"}
            </span>
            <Link
              className="secondary-button compact"
              href="/settings?section=integrations"
            >
              Close
            </Link>
          </div>
        </div>

        <div className="sender-rules-modal-body">
          <form
            action={upsertInboundEmailSenderRuleSettingsAction}
            className="sender-rule-add-form"
          >
            <input name="returnToSenderRules" type="hidden" value="1" />
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
                      {senderRuleSourceLabel(rule)} -{" "}
                      {senderRuleCreatedLabel(rule)}
                    </span>
                  </div>
                  <form
                    action={upsertInboundEmailSenderRuleSettingsAction}
                    className="sender-rule-edit-form"
                  >
                    <input name="returnToSenderRules" type="hidden" value="1" />
                    <input
                      name="senderRuleMatch"
                      type="hidden"
                      value={rule.match}
                    />
                    <input
                      name="senderRuleValue"
                      type="hidden"
                      value={rule.value}
                    />
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
                    <input name="returnToSenderRules" type="hidden" value="1" />
                    <input
                      name="senderRuleMatch"
                      type="hidden"
                      value={rule.match}
                    />
                    <input
                      name="senderRuleValue"
                      type="hidden"
                      value={rule.value}
                    />
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
              No sender rules yet. Use the filtered-out email menu or add one
              here when Kyro should always trust or ignore a sender.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function phoneCapabilitiesLabel(number: WorkspacePhoneNumberPoolRow) {
  const capabilities = [
    number.capabilities.sms ? "SMS" : null,
    number.capabilities.voice ? "Voice" : null,
    number.capabilities.mms ? "MMS" : null,
  ].filter(Boolean);

  return capabilities.length ? capabilities.join(" + ") : "Phone number";
}

function BusinessLogoEditor({
  profile,
}: Readonly<{
  profile: WorkspaceGeneralSettings["businessProfile"];
}>) {
  const previewLogoSrc = profile.logoContentBase64
    ? `data:${profile.logoContentType};base64,${profile.logoContentBase64}`
    : profile.logoUrl;

  return (
    <section className="signature-editor">
      <input
        name="businessProfileLogoContentBase64"
        type="hidden"
        value={profile.logoContentBase64}
      />
      <input
        name="businessProfileLogoContentType"
        type="hidden"
        value={profile.logoContentType}
      />
      <input
        name="businessProfileLogoFilename"
        type="hidden"
        value={profile.logoFilename}
      />
      <input
        name="businessProfileLogoSizeBytes"
        type="hidden"
        value={profile.logoSizeBytes}
      />
      <div>
        <p className="eyebrow">Business logo</p>
        <p>
          Used for business-facing documents, reports, and signatures when a
          logo is available.
        </p>
      </div>

      <div className="settings-grid">
        <label className="setting-card">
          <SettingCardHeading info="Upload a compact logo, up to 512 KB. If no logo is saved, Kyro falls back to the business name.">
            Logo file
          </SettingCardHeading>
          <input
            accept="image/*"
            name="businessProfileLogoFile"
            type="file"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Optional fallback if the logo is hosted somewhere public.">
            Logo URL fallback
          </SettingCardHeading>
          <input
            defaultValue={profile.logoUrl}
            name="businessProfileLogoUrl"
            placeholder="https://example.com/logo.png"
            type="url"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Width in pixels. Kyro keeps it between 32 and 320.">
            Logo size
          </SettingCardHeading>
          <input
            defaultValue={profile.logoWidthPx}
            max={320}
            min={32}
            name="businessProfileLogoWidthPx"
            step={4}
            type="number"
          />
        </label>
      </div>

      <div className="signature-preview-card">
        <strong>Preview</strong>
        <div className="signature-preview">
          {previewLogoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Business logo preview"
              src={previewLogoSrc}
              style={{ width: profile.logoWidthPx }}
            />
          ) : (
            <p className="muted-copy">
              No logo saved. Business name will be used instead.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function GeneralSettingsDetail({
  communicationSettings,
  operationalPhoneNumbers,
  settings,
  userEmail,
  workspaceName,
}: Readonly<{
  communicationSettings: CommunicationSettings;
  operationalPhoneNumbers: WorkspacePhoneNumberPoolRow[];
  settings: WorkspaceGeneralSettings;
  userEmail: string;
  workspaceName: string;
}>) {
  const profile = settings.businessProfile;
  const operatingCountry =
    profile.operatingCountry ||
    operatingCountryForPhoneRegion(settings.defaultPhoneRegion);
  const defaultPublicPhone =
    profile.publicPhoneNumber ||
    operationalPhoneNumbers.find(
      (number) => number.capabilities.sms && number.capabilities.voice,
    )?.phoneNumber ||
    "";

  return (
    <form
      action={updateGeneralSettingsAction}
      className="settings-form"
      encType="multipart/form-data"
    >
      <section className="integration-choice-panel">
        <div>
          <p className="eyebrow">Business profile</p>
          <h3>{profile.businessName || workspaceName}</h3>
          <p>
            Core facts Kyro can use across reports, assistant context,
            documents, customer replies, and future onboarding.
          </p>
        </div>
        <span className="pill">Workspace facts</span>
      </section>

      <div className="settings-grid">
        <label className="setting-card">
          <SettingCardHeading info="Shown internally and used as the default business name in generated documents and reports.">
            Business name
          </SettingCardHeading>
          <input
            defaultValue={profile.businessName || workspaceName}
            name="businessName"
            placeholder="WFA Plumbing"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="The trade or service category Kyro should assume for tone, context, and future workflows.">
            Industry
          </SettingCardHeading>
          <input
            defaultValue={profile.industry}
            name="businessIndustry"
            placeholder="Plumbing, electrical, building, landscaping..."
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Used as the workspace operating country for phone number assignment, local defaults, and future regional workflows.">
            Operating country
          </SettingCardHeading>
          <select
            defaultValue={operatingCountry}
            name="businessOperatingCountry"
            required
          >
            <option value="" disabled>
              Select operating country
            </option>
            {OPERATING_COUNTRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="setting-card">
          <SettingCardHeading info="The public email address shown on reports, documents, and business-facing material.">
            Public email
          </SettingCardHeading>
          <input
            defaultValue={profile.publicEmail || userEmail}
            name="businessPublicEmail"
            placeholder="hello@example.com"
            type="email"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading
            info={
              <>
                This is the displayed public phone number. It can be different
                from the operational Twilio/Vapi number used for inbound and
                outbound automation.
              </>
            }
          >
            Public phone number
          </SettingCardHeading>
          <input
            defaultValue={defaultPublicPhone}
            list="business-public-phone-options"
            name="businessPublicPhoneNumber"
            placeholder="+61 7 4517 4330"
          />
          <datalist id="business-public-phone-options">
            {operationalPhoneNumbers.map((number) => (
              <option
                key={number.id}
                label={`${number.friendlyName ?? "Workspace number"} - ${phoneCapabilitiesLabel(
                  number,
                )} connected`}
                value={number.phoneNumber}
              />
            ))}
          </datalist>
        </label>

        <label className="setting-card settings-textarea">
          <SettingCardHeading info="The business base address. Customer job addresses are still stored separately on contacts and leads.">
            Business address
          </SettingCardHeading>
          <textarea
            defaultValue={profile.businessAddress}
            name="businessAddress"
            placeholder="Street address, suburb, state, postcode"
          />
        </label>

        <label className="setting-card settings-textarea">
          <SettingCardHeading info="Plain-English operating area Kyro can reference when qualifying jobs.">
            Service area
          </SettingCardHeading>
          <textarea
            defaultValue={profile.serviceArea}
            name="businessServiceArea"
            placeholder="Brisbane southside, Logan, Ipswich, northern Gold Coast..."
          />
        </label>

        <label className="setting-card settings-textarea">
          <SettingCardHeading info="Useful for matching and explaining whether a job is likely inside the normal service area.">
            Suburbs serviced
          </SettingCardHeading>
          <textarea
            defaultValue={profile.serviceSuburbs}
            name="businessServiceSuburbs"
            placeholder="Holland Park West, Mount Gravatt, Coorparoo..."
          />
        </label>

        <label className="setting-card settings-textarea">
          <SettingCardHeading info="Optional postcode list. Keep it loose if the business works by suburb instead.">
            Postcodes serviced
          </SettingCardHeading>
          <textarea
            defaultValue={profile.servicePostcodes}
            name="businessServicePostcodes"
            placeholder="4121, 4122, 4101..."
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Approximate normal travel radius for jobs. Leave blank if the business uses suburb/postcode rules instead.">
            Travel radius
          </SettingCardHeading>
          <input
            defaultValue={profile.travelRadiusKm ?? ""}
            min={0}
            name="businessTravelRadiusKm"
            placeholder="30"
            type="number"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="A lightweight staffing number Kyro can use for workload and capability context.">
            Staff count
          </SettingCardHeading>
          <input
            defaultValue={profile.staffCount ?? ""}
            min={0}
            name="businessStaffCount"
            placeholder="3"
            type="number"
          />
        </label>

        <label className="setting-card settings-textarea">
          <SettingCardHeading info="Normal operating hours for work and job scheduling context.">
            Working hours
          </SettingCardHeading>
          <textarea
            defaultValue={profile.workingHours}
            name="businessWorkingHours"
            placeholder="Monday to Friday, 7:00 AM to 4:00 PM"
          />
        </label>

        <label className="setting-card settings-textarea">
          <SettingCardHeading info="Hours customers can expect the business or Kyro to respond.">
            Contact hours
          </SettingCardHeading>
          <textarea
            defaultValue={profile.contactHours}
            name="businessContactHours"
            placeholder="Weekdays 7:00 AM to 5:30 PM; urgent calls after hours"
          />
        </label>
      </div>

      <fieldset className="settings-fieldset compact-checkbox-fieldset">
        <legend>Emergency work</legend>
        <label className="compact-checkbox-row">
          <input
            defaultChecked={profile.emergencyJobsEnabled}
            name="businessEmergencyJobsEnabled"
            type="checkbox"
          />
          <span>Offers 24-hour or urgent emergency jobs</span>
        </label>
        <label className="settings-textarea">
          Emergency rate and handling notes
          <textarea
            defaultValue={profile.emergencyRateNotes}
            name="businessEmergencyRateNotes"
            placeholder="Emergency call-outs are charged at an after-hours rate. Ask for safety details first."
          />
        </label>
      </fieldset>

      <section className="signature-editor">
        <div>
          <p className="eyebrow">Operational phone numbers</p>
          <p>
            These are the numbers already assigned for Twilio/Vapi. The public
            number above can use one of these or any other displayed number.
          </p>
        </div>
        {operationalPhoneNumbers.length ? (
          <div className="detail-list compact-detail-list">
            {operationalPhoneNumbers.map((number) => (
              <div key={number.id}>
                <strong>{number.phoneNumber}</strong>
                <span>
                  {number.friendlyName ?? "Workspace number"} -{" "}
                  {phoneCapabilitiesLabel(number)} - {formatLabel(number.status)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-copy">
            No operational phone number is assigned yet. Configure phone and SMS
            in Connected accounts when the workspace is ready.
          </p>
        )}
      </section>

      <BusinessLogoEditor profile={profile} />

      <div className="settings-grid">
        <label className="setting-card">
          <SettingCardHeading info="Primary brand colour for documents, previews, and future generated assets.">
            Primary colour
          </SettingCardHeading>
          <input
            defaultValue={profile.brandPrimaryColor}
            name="businessBrandPrimaryColor"
            type="color"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Accent colour for highlights and secondary visual marks.">
            Accent colour
          </SettingCardHeading>
          <input
            defaultValue={profile.brandAccentColor}
            name="businessBrandAccentColor"
            type="color"
          />
        </label>

        <label className="setting-card settings-textarea">
          <SettingCardHeading info="Short notes about brand personality, wording style, visual feel, or anything Kyro should respect.">
            Brand style notes
          </SettingCardHeading>
          <textarea
            defaultValue={profile.brandStyle}
            name="businessBrandStyle"
            placeholder="Clean, practical, friendly, no corporate fluff..."
          />
        </label>
      </div>

      <EmailSignatureEditor
        description="Used for manual replies and business-facing email defaults. Advanced AI signature controls still live in Connected accounts."
        namePrefix="manualSignature"
        signature={communicationSettings.manualSignature}
        title="Default email signature"
      />

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
        <label className="setting-card">
          <SettingCardHeading
            info={
              <>
                Used when a customer gives a local phone number without a
                country code. Numbers that already include a country code are
                kept international.
              </>
            }
          >
            Default phone region
          </SettingCardHeading>
          <select
            defaultValue={settings.defaultPhoneRegion}
            name="workspaceDefaultPhoneRegion"
          >
            {PHONE_REGION_OPTIONS.map((region) => (
              <option key={region.value} value={region.value}>
                {region.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-footer">
        <span>
          Business facts are saved into the workspace profile. Timezone powers
          quiet hours and scheduling. Display currency currently uses{" "}
          {displayCurrencySourceLabel(settings)} until the billing provider is
          connected.
        </span>
        <button className="primary-button compact" type="submit">
          Save business profile
        </button>
      </div>
    </form>
  );
}

function InboundEmailSyncSettings({
  connections,
  operationalSummary,
  settings,
  showInboundTrace,
  showSenderRules,
}: Readonly<{
  connections: EmailProviderConnection[];
  operationalSummary: InboundEmailOperationalSummary;
  settings: InboundEmailSettings;
  showInboundTrace: boolean;
  showSenderRules: boolean;
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

      <InboundEmailOperationsPanel
        showTrace={showInboundTrace}
        summary={operationalSummary}
      />

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

      <SenderRulesLauncher rules={settings.senderRules} />
      {showSenderRules ? (
        <SenderRulesSettings rules={settings.senderRules} />
      ) : null}

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
  forceOpen = false,
  isCurrent,
  label,
  provider,
  status,
}: Readonly<{
  children: React.ReactNode;
  description: string;
  forceOpen?: boolean;
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
      open={forceOpen ? true : undefined}
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
  availablePhoneNumbers,
  communicationSettings,
  generalSettings,
  googleOverview,
  googleStatus,
  inboundEmailSettings,
  inboundEmailSummary,
  microsoftOverview,
  microsoftStatus,
  showInboundTrace,
  showSenderRules,
  twilioOverview,
}: Readonly<{
  availablePhoneNumbers: WorkspacePhoneNumberPoolRow[];
  communicationSettings: Awaited<ReturnType<typeof getCommunicationSettings>>;
  generalSettings: WorkspaceGeneralSettings;
  googleOverview: GoogleIntegrationOverview;
  googleStatus: string;
  inboundEmailSettings: InboundEmailSettings;
  inboundEmailSummary: InboundEmailOperationalSummary;
  microsoftOverview: MicrosoftIntegrationOverview;
  microsoftStatus: string;
  showInboundTrace: boolean;
  showSenderRules: boolean;
  twilioOverview: TwilioIntegrationOverview;
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
  const communicationStatus = communicationSettings.approvalRequired
    ? "Approval required"
    : "Auto outbound";
  const twilioStatus = twilioStatusLabel(twilioOverview);

  return (
    <div className="integration-provider-stack">
      <InboundEmailSyncSettings
        connections={emailConnections}
        operationalSummary={inboundEmailSummary}
        settings={inboundEmailSettings}
        showInboundTrace={showInboundTrace}
        showSenderRules={showSenderRules}
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
        description={`${communicationSettings.allowedChannels.length} channels and email signatures`}
        isCurrent={false}
        label="Outbound communication"
        provider="Rules"
        status={communicationStatus}
      >
        <CommunicationSettingsDetail
          communicationSettings={communicationSettings}
        />
      </ProviderDetails>

      <ProviderDetails
        description={
          twilioOverview.numbers.length > 0
            ? `${twilioOverview.numbers.length} workspace number${
                twilioOverview.numbers.length === 1 ? "" : "s"
              }`
            : "SMS and future phone calls"
        }
        isCurrent={false}
        label="Kyro phone and SMS"
        provider="Twilio"
        status={twilioStatus}
      >
        <TwilioTelephonySettings
          availableNumbers={availablePhoneNumbers}
          generalSettings={generalSettings}
          overview={twilioOverview}
        />
      </ProviderDetails>

      <ProviderDetails
        description={
          googleConnection
            ? connectionName(googleConnection, "Google account")
            : "Gmail outbound and Drive document access"
        }
        isCurrent={currentProvider === "google"}
        forceOpen={googleNeedsReconnect}
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
        forceOpen={microsoftNeedsReconnect}
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
        value={communicationSettings.replyWriting.tone}
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

      <OutboundWritingStyleEditor
        communicationSettings={communicationSettings}
      />

      <fieldset className="settings-fieldset">
        <legend>Follow-up reminders</legend>
        <div className="settings-grid">
          <label className="compact-checkbox-row setting-card">
            <input
              defaultChecked={communicationSettings.followUpRemindersEnabled}
              name="followUpRemindersEnabled"
              type="checkbox"
            />
            <span>Automatically create internal follow-up reminders</span>
          </label>

          <label className="setting-card">
            <SettingCardHeading info="Kyro creates the reminder after an outbound reply is recorded. It stays internal until calendar/task integrations are added later.">
              Default delay
            </SettingCardHeading>
            <input
              defaultValue={communicationSettings.followUpDelayDays}
              max={MAX_FOLLOW_UP_DELAY_DAYS}
              min={MIN_FOLLOW_UP_DELAY_DAYS}
              name="followUpDelayDays"
              type="number"
            />
            <span>Days after the outbound reply before follow-up is due.</span>
          </label>
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
          Connected email providers can send real email. SMS can send through
          Twilio when a workspace sender is ready; phone calls route through
          Vapi once the voice assistant IDs are configured.
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
                  This ElevenLabs voice is passed into Vapi for the internal
                  Vapi voice tab and Kyro-initiated outbound calls. Use the same
                  voice when configuring inbound Vapi assistants.
                </>
              }
            >
              Vapi voice
            </SettingCardHeading>
            <select
              defaultValue={voiceSettings.elevenLabsVoicePresetId}
              name="elevenLabsVoicePresetId"
            >
              {ELEVENLABS_VOICE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
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

        <fieldset className="settings-fieldset">
          <legend>Phone assistant</legend>
          <div className="settings-grid">
            <label className="compact-checkbox-row setting-card">
              <input
                defaultChecked={voiceSettings.phoneAgentEnabled}
                name="phoneAgentEnabled"
                type="checkbox"
              />
              <span>Enable Vapi phone assistant infrastructure</span>
            </label>

            <label className="setting-card">
              <SettingCardHeading info="This controls the broad feel of the Vapi assistant prompt for inbound, voicemail overflow, and outbound calls.">
                Call style
              </SettingCardHeading>
              <select
                defaultValue={voiceSettings.phoneAgentDemeanor}
                name="phoneAgentDemeanor"
              >
                {PHONE_AGENT_DEMEANORS.map((demeanor) => (
                  <option key={demeanor} value={demeanor}>
                    {formatLabel(demeanor)}
                  </option>
                ))}
              </select>
            </label>

            <label className="setting-card">
              <SettingCardHeading info="Concise is best for trades call handling; detailed gives the assistant more room to explain.">
                Detail level
              </SettingCardHeading>
              <select
                defaultValue={voiceSettings.phoneAgentVerbosity}
                name="phoneAgentVerbosity"
              >
                {PHONE_AGENT_VERBOSITIES.map((verbosity) => (
                  <option key={verbosity} value={verbosity}>
                    {formatLabel(verbosity)}
                  </option>
                ))}
              </select>
            </label>

            <label className="setting-card">
              <SettingCardHeading info="Light humour keeps calls human without letting the assistant drift into banter when a customer needs help.">
                Warmth
              </SettingCardHeading>
              <select
                defaultValue={voiceSettings.phoneAgentHumourLevel}
                name="phoneAgentHumourLevel"
              >
                {PHONE_AGENT_HUMOUR_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {formatLabel(level)}
                  </option>
                ))}
              </select>
            </label>

            <label className="setting-card">
              <SettingCardHeading info="What Kyro should do when a caller needs the human tradesperson or has an urgent issue.">
                Escalation behaviour
              </SettingCardHeading>
              <select
                defaultValue={voiceSettings.phoneAgentEscalationMode}
                name="phoneAgentEscalationMode"
              >
                {PHONE_AGENT_ESCALATION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {formatLabel(mode)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="channel-toggle-grid voice-purpose-toggle-grid">
            <label className="channel-toggle">
              <input
                defaultChecked={voiceSettings.phoneAgentInboundEnabled}
                name="phoneAgentInboundEnabled"
                type="checkbox"
              />
              <span>Inbound customer calls</span>
            </label>
            <label className="channel-toggle">
              <input
                defaultChecked={
                  voiceSettings.phoneAgentVoicemailOverflowEnabled
                }
                name="phoneAgentVoicemailOverflowEnabled"
                type="checkbox"
              />
              <span>Voicemail overflow</span>
            </label>
            <label className="channel-toggle">
              <input
                defaultChecked={voiceSettings.phoneAgentOutboundEnabled}
                name="phoneAgentOutboundEnabled"
                type="checkbox"
              />
              <span>Outbound calls</span>
            </label>
          </div>

          <label className="settings-textarea">
            User and team phone numbers
            <textarea
              defaultValue={voiceSettings.phoneAgentUserNumbers.join("\n")}
              name="phoneAgentUserNumbers"
              placeholder={"+61 400 000 000\n+1 555 0100"}
            />
          </label>

          <div className="settings-grid">
            <label className="setting-card">
              <SettingCardHeading info="Vapi phone number ID. Kyro can also read VAPI_PHONE_NUMBER_ID from env.">
                Vapi phone number ID
              </SettingCardHeading>
              <input
                defaultValue={voiceSettings.vapiPhoneNumberId ?? ""}
                name="vapiPhoneNumberId"
                placeholder="pn_..."
              />
            </label>
            <label className="setting-card">
              <SettingCardHeading info="Assistant used by the browser/mobile Vapi voice tab for internal Kyro conversations.">
                Internal voice assistant ID
              </SettingCardHeading>
              <input
                defaultValue={voiceSettings.vapiInternalAssistantId ?? ""}
                name="vapiInternalAssistantId"
                placeholder="asst_..."
              />
            </label>
            <label className="setting-card">
              <SettingCardHeading info="Assistant used when customers call the Kyro number directly.">
                Inbound assistant ID
              </SettingCardHeading>
              <input
                defaultValue={voiceSettings.vapiInboundAssistantId ?? ""}
                name="vapiInboundAssistantId"
                placeholder="asst_..."
              />
            </label>
            <label className="setting-card">
              <SettingCardHeading info="Assistant used for missed-call or voicemail overflow forwarding.">
                Voicemail assistant ID
              </SettingCardHeading>
              <input
                defaultValue={voiceSettings.vapiVoicemailAssistantId ?? ""}
                name="vapiVoicemailAssistantId"
                placeholder="asst_..."
              />
            </label>
            <label className="setting-card">
              <SettingCardHeading info="Assistant used when Kyro initiates an outbound customer call.">
                Outbound assistant ID
              </SettingCardHeading>
              <input
                defaultValue={voiceSettings.vapiOutboundAssistantId ?? ""}
                name="vapiOutboundAssistantId"
                placeholder="asst_..."
              />
            </label>
          </div>
        </fieldset>

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
  const previewEntries = visibleEntries.slice(0, 10);
  const collapsedEntries = visibleEntries.slice(10);

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
          <>
            {previewEntries.map((entry) => (
              <PronunciationEntryCard entry={entry} key={entry.id} />
            ))}
            {collapsedEntries.length > 0 ? (
              <details className="pronunciation-entry-expander">
                <summary>
                  <span>Show {collapsedEntries.length} more</span>
                  <span className="pronunciation-collapse-label">Collapse</span>
                </summary>
                <div className="pronunciation-entry-list nested">
                  {collapsedEntries.map((entry) => (
                    <PronunciationEntryCard entry={entry} key={entry.id} />
                  ))}
                </div>
              </details>
            ) : null}
          </>
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

function PronunciationEntryCard({
  entry,
}: Readonly<{
  entry: AssistantPronunciationEntry;
}>) {
  return (
    <article className="pronunciation-entry-card">
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
          <span className="pill subtle">{pronunciationEntryPill(entry)}</span>
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
  );
}

type UsageReportData = Awaited<ReturnType<typeof getUsageReport>>;

function modelUsageDescription(row: UsageBreakdownRow) {
  const model = row.model.toLowerCase();
  const service = row.service.toLowerCase();

  if (service === "realtime" || model.includes("realtime")) {
    return "Used for Kyro's live voice assistant: low-latency spoken conversations, audio/text tokens, cached context, and voice tool calls.";
  }

  if (
    service === "speech_to_text" ||
    model.includes("transcribe") ||
    model.includes("whisper")
  ) {
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
              <div
                className="usage-row usage-row-three heading"
                aria-hidden="true"
              >
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
              <div
                className="usage-row usage-row-three heading"
                aria-hidden="true"
              >
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
  const [query, { supabase, user, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const activeWindow = normalizeUsageWindow(query?.window);
  const selectedSection = normalizeSettingsSection(query?.section);
  const showInboundTrace =
    selectedSection === "integrations" && query?.inboundTrace === "1";
  const showSenderRules =
    selectedSection === "integrations" && query?.senderRules === "1";
  const [
    communicationSettings,
    availablePhoneNumbers,
    generalSettings,
    integrationOverviews,
    pronunciationEntries,
    assignedPhoneNumbers,
    usageReport,
    voiceSettings,
  ] = await Promise.all([
    selectedSection === "general" || selectedSection === "integrations"
      ? getCommunicationSettings(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "integrations"
      ? getWorkspaceGeneralSettings(supabase, workspace.id)
          .then((settings) =>
            getAvailableWorkspacePhoneNumbersFromPool(
              createServiceSupabaseClient(),
              operatingCountryPhoneRegion(
                settings.businessProfile.operatingCountry,
              ) ?? settings.defaultPhoneRegion,
            ),
          )
          .catch(() => [])
      : Promise.resolve([]),
    selectedSection === "general" ||
    selectedSection === "integrations" ||
    selectedSection === "usage"
      ? getWorkspaceGeneralSettings(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "integrations"
      ? Promise.all([
          getGoogleIntegrationOverview(supabase, workspace.id),
          getMicrosoftIntegrationOverview(supabase, workspace.id),
          getInboundEmailSettings(supabase, workspace.id),
          getInboundEmailOperationalSummary(supabase, workspace.id),
          getTwilioTelephonyOverview(supabase, workspace.id),
        ])
      : Promise.resolve(null),
    selectedSection === "voice"
      ? getPronunciationEntries(supabase, workspace.id)
      : Promise.resolve([]),
    selectedSection === "general"
      ? getWorkspaceAssignedPhoneNumbers(supabase, workspace.id)
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
  const inboundEmailSummary = integrationOverviews?.[3] ?? null;
  const twilioOverview = integrationOverviews?.[4] ?? null;
  const googleStatus = googleOverview
    ? integrationStatusLabel(googleOverview)
    : "Open";
  const microsoftStatus = microsoftOverview
    ? integrationStatusLabel(microsoftOverview)
    : "Open";
  const settingsItems: SettingsMenuItem[] = [
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
  ];
  const selectedDetail =
    selectedSection === "general" &&
    generalSettings &&
    communicationSettings ? (
      <SettingsDetailShell eyebrow="Profile" title="Business profile">
        <GeneralSettingsDetail
          communicationSettings={communicationSettings}
          operationalPhoneNumbers={assignedPhoneNumbers}
          settings={generalSettings}
          userEmail={user.email ?? ""}
          workspaceName={workspace.name}
        />
      </SettingsDetailShell>
    ) : selectedSection === "integrations" &&
      communicationSettings &&
      generalSettings &&
      googleOverview &&
      microsoftOverview &&
      inboundEmailSettings &&
      inboundEmailSummary &&
      twilioOverview ? (
      <SettingsDetailShell eyebrow="Integrations" title="Connected accounts">
        <WorkspaceIntegrationsSettings
          communicationSettings={communicationSettings}
          googleOverview={googleOverview}
          googleStatus={googleStatus}
          inboundEmailSettings={inboundEmailSettings}
          inboundEmailSummary={inboundEmailSummary}
          microsoftOverview={microsoftOverview}
          microsoftStatus={microsoftStatus}
          showInboundTrace={showInboundTrace}
          showSenderRules={showSenderRules}
          availablePhoneNumbers={availablePhoneNumbers}
          generalSettings={generalSettings}
          twilioOverview={twilioOverview}
        />
      </SettingsDetailShell>
    ) : selectedSection === "usage" && usageReport && generalSettings ? (
      <SettingsDetailShell eyebrow="Usage" title="Usage and billing">
        <UsageSettingsDetail
          activeWindow={activeWindow}
          displayCurrencySettings={generalSettings}
          usageReport={usageReport}
        />
      </SettingsDetailShell>
    ) : selectedSection === "voice" && voiceSettings ? (
      <SettingsDetailShell eyebrow="Voice" title="Voice assistant">
        <VoiceSettingsDetail
          pronunciationEntries={pronunciationEntries}
          voiceSettings={voiceSettings}
        />
      </SettingsDetailShell>
    ) : null;

  return (
    <AppFrame active="Settings">
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
