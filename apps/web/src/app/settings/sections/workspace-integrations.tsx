import Link from "next/link";
import {
  CommunicationSettingsDetail,
} from "../sections/communication-settings";
import {
  DefaultInvoiceTemplateForm,
} from "../../payments/default-invoice-template-form";
import {
  EmailSyncHealthPanel,
} from "../sections/email-sync-health";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_GMAIL_READ_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_PROVIDER,
  type GoogleIntegrationOverview,
} from "../../../lib/integrations/google";
import {
  INBOUND_EMAIL_POLL_INTERVALS,
  INBOUND_EMAIL_SYNC_MODES,
  type InboundEmailOperationalSummary,
  type InboundEmailSenderRule,
  type InboundEmailSettings,
} from "../../../lib/integrations/inbound-email-settings";
import {
  InboundEmailAutosaveForm,
} from "../inbound-email-autosave-form";
import {
  InboundEmailOperationsPanel,
} from "../sections/inbound-email-operations";
import {
  InfoBubble,
} from "../info-bubble";
import {
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_PROVIDER,
  type MicrosoftIntegrationOverview,
} from "../../../lib/integrations/microsoft";
import {
  ManualSyncSubmitButton,
} from "../manual-sync-submit-button";
import {
  PHONE_AGENT_INBOUND_INQUIRY_MODES,
  type VoiceSettings,
} from "../../../lib/assistant/voice-settings";
import {
  PhoneNumberPicker,
} from "../phone-number-picker";
import {
  SettingsSubmitButton,
} from "../settings-submit-button";
import {
  StripeResetButton,
} from "../stripe-reset-button";
import {
  autosaveInboundEmailSettingsAction,
  connectStripePaymentsAction,
  disconnectIntegrationAction,
  disconnectWorkspacePhoneSmsAction,
  removeInboundEmailSenderRuleSettingsAction,
  syncInboundEmailNowAction,
  updateInboundInquiryHandlingAction,
  upsertInboundEmailSenderRuleSettingsAction,
} from "../actions";
import {
  connectionName,
  connectionNeedsReconnect,
  type EmailProviderConnection,
  formatDate,
  formatLabel,
  formatTimeOfDay,
  googlePermissionActive,
  type ProviderConnection,
  scopeLabel,
  SettingCardHeading,
} from "../shared";
import {
  formatCurrencyAmount,
} from "../../../lib/billing/display-currency";
import {
  operatingCountryPhoneRegion,
} from "../../../lib/workspace/operating-countries";
import {
  type CommunicationSettings,
} from "../../../lib/communication/settings";
import {
  type IntegrationSettingsPanel,
} from "../settings-navigation";
import {
  type QuoteTemplate,
} from "../../../lib/documents/templates";
import {
  type TwilioTelephonyOverview,
} from "../../../lib/integrations/twilio";
import {
  type WorkspaceGeneralSettings,
} from "../../../lib/workspace/general-settings";
import {
  type WorkspacePhoneNumberPoolRow,
} from "../../../lib/voice/phone-number-pool";
import {
  type WorkspaceStripePaymentOverview,
} from "../../../lib/payments/accounts";
/**
 * The workspace integrations section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function formatMoney(value: number, currency: string) {
  return formatCurrencyAmount(value, currency);
}

export function DisconnectIntegrationButton({
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

export function googlePermissionLabel(scope: string) {
  switch (scope) {
    case GOOGLE_GMAIL_SEND_SCOPE:
      return "Send email replies";
    case GOOGLE_GMAIL_READ_SCOPE:
      return "Read inbox messages";
    case GOOGLE_DRIVE_FILE_SCOPE:
      return "Save Kyro-created files";
    case GOOGLE_CALENDAR_EVENTS_SCOPE:
      return "Create calendar events";
    case "email":
      return "Email address";
    case "profile":
      return "Google profile";
    default:
      return scopeLabel(scope);
  }
}

export function GoogleIntegrationSettings({
  overview,
}: Readonly<{ overview: GoogleIntegrationOverview }>) {
  const canConnect =
    overview.configured && overview.encryptionReady && overview.migrationReady;
  const hasConnectedAccount = overview.connections.some(
    (connection) => connection.status === "connected",
  );

  return (
    <>
      <div className="integration-provider-setup-bar">
        <div>
          <strong>
            {hasConnectedAccount ? "Google connected" : "Connect Google"}
          </strong>
          <span>
            {hasConnectedAccount
              ? "Reconnect if Gmail, Drive, or Calendar permissions need refreshing."
              : "Connect once, then Kyro can use Gmail and Drive through policies."}
          </span>
        </div>
        {canConnect ? (
          <Link
            className="primary-button compact link-button"
            href="/integrations/google/start"
          >
            {hasConnectedAccount ? "Reconnect Google" : "Connect Google"}
          </Link>
        ) : (
          <span className="pill warning">Setup required</span>
        )}
      </div>

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

      <div className="integration-permission-list">
        {overview.scopes.map((scope) => {
          const active = googlePermissionActive(overview, scope);
          const label = googlePermissionLabel(scope);
          const inactiveLabel = hasConnectedAccount
            ? "Needs reconnect"
            : "Not connected";

          return (
            <div
              aria-label={`${label}: ${active ? "active" : inactiveLabel}`}
              className={`integration-permission-pill ${
                active ? "active" : "inactive"
              }`}
              key={scope}
            >
              <span
                className="integration-permission-check"
                aria-hidden="true"
              />
              <span>{label}</span>
              <small>{active ? "Active" : inactiveLabel}</small>
            </div>
          );
        })}
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
    </>
  );
}

export function MicrosoftIntegrationSettings({
  overview,
}: Readonly<{ overview: MicrosoftIntegrationOverview }>) {
  const canConnect =
    overview.configured && overview.encryptionReady && overview.migrationReady;
  const hasConnectedAccount = overview.connections.some(
    (connection) => connection.status === "connected",
  );

  return (
    <>
      <div className="integration-provider-setup-bar">
        <div>
          <strong>
            {hasConnectedAccount ? "Outlook connected" : "Connect Outlook"}
          </strong>
          <span>
            {hasConnectedAccount
              ? "Reconnect if Outlook permissions need refreshing."
              : "Connect once, then Kyro can send and read Outlook email through the same policies."}
          </span>
        </div>
        {canConnect ? (
          <Link
            className="primary-button compact link-button"
            href="/integrations/microsoft/start"
          >
            {hasConnectedAccount ? "Reconnect Outlook" : "Connect Outlook"}
          </Link>
        ) : (
          <span className="pill warning">Setup required</span>
        )}
      </div>

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
    </>
  );
}

export function twilioStatusLabel(overview: TwilioTelephonyOverview) {
  if (!overview.migrationReady) {
    return "Needs attention";
  }

  if (!overview.configured) {
    return "Unavailable";
  }

  if (overview.numbers.some((number) => number.capabilities.sms)) {
    return "Ready";
  }

  return "Number needed";
}

export function TwilioTelephonySettings({
  availableNumbers,
  generalSettings,
  overview,
  voiceSettings,
}: Readonly<{
  availableNumbers: WorkspacePhoneNumberPoolRow[];
  generalSettings: WorkspaceGeneralSettings;
  overview: TwilioTelephonyOverview;
  voiceSettings: VoiceSettings;
}>) {
  const activeSmsNumberCount = overview.numbers.filter(
    (number) => number.capabilities.sms,
  ).length;
  const hasActiveSmsNumber = activeSmsNumberCount > 0;
  const inboundSmsReady =
    overview.configured &&
    hasActiveSmsNumber &&
    Boolean(overview.inboundSmsWebhookUrl) &&
    overview.compliance.tableReady;
  const outboundSmsReady =
    overview.configured && hasActiveSmsNumber && overview.compliance.tableReady;
  const hasActiveVoiceNumber = overview.numbers.some(
    (number) => number.capabilities.voice,
  );
  const voiceRoutingReady = Boolean(
    hasActiveVoiceNumber && voiceSettings.vapiPhoneNumberId,
  );
  const inboundPhoneReady = Boolean(
    voiceSettings.phoneAgentEnabled &&
    voiceSettings.phoneAgentInboundEnabled &&
    voiceRoutingReady &&
    voiceSettings.vapiInboundAssistantId,
  );
  const outboundPhoneReady = Boolean(
    voiceSettings.phoneAgentEnabled &&
    voiceSettings.phoneAgentOutboundEnabled &&
    voiceRoutingReady &&
    voiceSettings.vapiOutboundAssistantId,
  );
  const phoneStatusLabel = (ready: boolean, directionEnabled: boolean) => {
    if (ready) {
      return "Active";
    }

    if (!hasActiveVoiceNumber) {
      return "Number needed";
    }

    if (!voiceSettings.phoneAgentEnabled || !directionEnabled) {
      return "Off";
    }

    return "Needs attention";
  };
  const phoneAssistantStatus = (
    directionEnabled: boolean,
    assistantId: string | null,
  ) => {
    if (!voiceSettings.phoneAgentEnabled || !directionEnabled) {
      return "Off";
    }

    return assistantId ? "Active" : "Check";
  };
  const inboundStatusLabel = inboundSmsReady
    ? "Active"
    : !overview.configured
      ? "Unavailable"
      : !hasActiveSmsNumber
        ? "Number needed"
        : !overview.inboundSmsWebhookUrl
          ? "Needs attention"
          : !overview.compliance.tableReady
            ? "Needs attention"
            : "Needs setup";
  const outboundStatusLabel = outboundSmsReady
    ? "Active"
    : !overview.configured
      ? "Unavailable"
      : !hasActiveSmsNumber
        ? "Number needed"
        : !overview.compliance.tableReady
          ? "Needs attention"
          : "Needs setup";
  const activeVoiceSmsNumber = overview.numbers.find(
    (number) => number.capabilities.sms && number.capabilities.voice,
  );
  const supportingPhoneNumbers = activeVoiceSmsNumber
    ? overview.numbers.filter((number) => number.id !== activeVoiceSmsNumber.id)
    : overview.numbers;
  const phoneRegion =
    operatingCountryPhoneRegion(
      generalSettings.businessProfile.operatingCountry,
    ) ?? generalSettings.defaultPhoneRegion;
  const availableRegionalNumbers = availableNumbers.filter(
    (number) => number.countryCode === phoneRegion,
  );

  return (
    <>
      <section className="setting-card phone-number-enable-card assistant-number-card">
        <SettingCardHeading
          info={
            <>
              This is the public assistant-facing number customers can call or
              message. It receives SMS, sends SMS, receives calls, and makes
              assistant calls when the matching voice number is configured.
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
                  "Public assistant number",
                  activeVoiceSmsNumber.friendlyName,
                  activeVoiceSmsNumber.countryCode,
                  "SMS + voice enabled",
                ]
                  .filter(Boolean)
                  .join(" - ")}
              </span>
            </div>
            <div className="phone-number-active-actions">
              <span className="pill success">Enabled</span>
              <form
                action={disconnectWorkspacePhoneSmsAction}
                className="phone-number-disconnect-form"
              >
                <input
                  name="phoneNumberId"
                  type="hidden"
                  value={activeVoiceSmsNumber.id}
                />
                <button className="text-button danger" type="submit">
                  Disconnect
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="assistant-number-empty-row">
            <div>
              <strong>No public assistant number assigned</strong>
              <span>
                Choose a {phoneRegion} number for customer calls and messages.
              </span>
            </div>
            <PhoneNumberPicker
              numbers={availableRegionalNumbers}
              phoneRegion={phoneRegion}
            />
          </div>
        )}
      </section>

      <div className="integration-summary-grid">
        <article className="setting-card sms-readiness-card">
          <SettingCardHeading
            info={
              <>
                Customer calls to the Kyro number use the configured inbound
                phone assistant and workspace call settings.
              </>
            }
          >
            Inbound calls
          </SettingCardHeading>
          <div
            className={`settings-status-pill ${
              inboundPhoneReady ? "ready" : "warning"
            }`}
          >
            {phoneStatusLabel(
              inboundPhoneReady,
              voiceSettings.phoneAgentInboundEnabled,
            )}
          </div>
          <div className="mini-status-grid">
            <span>
              <strong>{hasActiveVoiceNumber ? "Connected" : "Missing"}</strong>
              Calling number
            </span>
            <span>
              <strong>{voiceRoutingReady ? "Ready" : "Check"}</strong>
              Call routing
            </span>
            <span>
              <strong>
                {phoneAssistantStatus(
                  voiceSettings.phoneAgentInboundEnabled,
                  voiceSettings.vapiInboundAssistantId,
                )}
              </strong>
              Inbound assistant
            </span>
          </div>
        </article>
        <article className="setting-card sms-readiness-card">
          <SettingCardHeading
            info={
              <>
                User-requested customer calls use the configured outbound phone
                assistant and the workspace&apos;s Kyro number.
              </>
            }
          >
            Outbound calls
          </SettingCardHeading>
          <div
            className={`settings-status-pill ${
              outboundPhoneReady ? "ready" : "warning"
            }`}
          >
            {phoneStatusLabel(
              outboundPhoneReady,
              voiceSettings.phoneAgentOutboundEnabled,
            )}
          </div>
          <div className="mini-status-grid">
            <span>
              <strong>{hasActiveVoiceNumber ? "Ready" : "Missing"}</strong>
              Calling number
            </span>
            <span>
              <strong>{voiceRoutingReady ? "Ready" : "Check"}</strong>
              Call routing
            </span>
            <span>
              <strong>
                {phoneAssistantStatus(
                  voiceSettings.phoneAgentOutboundEnabled,
                  voiceSettings.vapiOutboundAssistantId,
                )}
              </strong>
              Outbound assistant
            </span>
          </div>
        </article>
        <article className="setting-card sms-readiness-card">
          <SettingCardHeading
            info={
              <>
                Kyro-owned numbers receive customer SMS and promote useful
                messages into the same CRM pipeline as email.
              </>
            }
          >
            Inbound SMS
          </SettingCardHeading>
          <div
            className={`settings-status-pill ${
              inboundSmsReady ? "ready" : "warning"
            }`}
          >
            {inboundStatusLabel}
          </div>
          <div className="mini-status-grid">
            <span>
              <strong>{hasActiveSmsNumber ? "Connected" : "Missing"}</strong>
              Workspace number
            </span>
            <span>
              <strong>
                {overview.inboundSmsWebhookUrl ? "Ready" : "Check"}
              </strong>
              Inbound routing
            </span>
            <span>
              <strong>
                {overview.compliance.tableReady ? "Active" : "Check"}
              </strong>
              Consent guard
            </span>
          </div>
        </article>
        <article className="setting-card sms-readiness-card">
          <SettingCardHeading
            info={
              <>
                Approved or user-triggered SMS replies send through the
                workspace&apos;s active SMS-capable number.
              </>
            }
          >
            Outbound SMS
          </SettingCardHeading>
          <div
            className={`settings-status-pill ${
              outboundSmsReady ? "ready" : "warning"
            }`}
          >
            {outboundStatusLabel}
          </div>
          <div className="mini-status-grid">
            <span>
              <strong>{hasActiveSmsNumber ? "Ready" : "Missing"}</strong>
              Sending number
            </span>
            <span>
              <strong>
                {overview.configured ? "Connected" : "Unavailable"}
              </strong>
              Messaging service
            </span>
            <span>
              <strong>
                {overview.compliance.tableReady ? "Active" : "Check"}
              </strong>
              Opt-out guard
            </span>
          </div>
        </article>
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Kyro records inbound SMS consent signals, separates trusted
                staff/operator command texts from customer messages, and blocks
                outbound SMS to opted-out or blocked recipients before a message
                is sent.
              </>
            }
          >
            SMS compliance guard
          </SettingCardHeading>
          <div className="mini-status-grid">
            <span>
              <strong>{overview.compliance.trackedRecipients}</strong>
              Tracked recipients
            </span>
            <span>
              <strong>{overview.compliance.optedOutRecipients}</strong>
              Opted out
            </span>
            <span>
              <strong>{overview.compliance.staffInternalRecipients}</strong>
              Staff/operator
            </span>
          </div>
        </article>
      </div>

      {!overview.migrationReady ? (
        <p className="form-alert">
          Phone and SMS storage is not ready yet. Kyro has been notified.
        </p>
      ) : null}
      {!overview.configured ? (
        <p className="form-alert">
          Phone and SMS are temporarily unavailable. Kyro has been notified.
        </p>
      ) : null}
      {!overview.compliance.tableReady ? (
        <p className="form-alert">
          SMS consent controls are temporarily unavailable. Kyro has been
          notified.
        </p>
      ) : null}
      {overview.configured && !overview.inboundSmsWebhookUrl ? (
        <p className="form-alert">
          Inbound SMS routing is temporarily unavailable. Kyro has been
          notified.
        </p>
      ) : null}

      {supportingPhoneNumbers.length > 0 ? (
        <div className="usage-ledger compact">
          {supportingPhoneNumbers.map((number) => (
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
              <div className="phone-number-row-actions">
                <span className="pill">
                  {number.monthlyCostSnapshot > 0
                    ? formatMoney(number.monthlyCostSnapshot, number.currency)
                    : "Workspace number"}
                </span>
                <form
                  action={disconnectWorkspacePhoneSmsAction}
                  className="phone-number-disconnect-form"
                >
                  <input name="phoneNumberId" type="hidden" value={number.id} />
                  <button className="text-button danger" type="submit">
                    Disconnect
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function stripePaymentsStatusLabel(overview: WorkspaceStripePaymentOverview) {
  if (!overview.migrationReady) {
    return "Migration needed";
  }

  if (!overview.configured || !overview.webhookConfigured) {
    return "Keys needed";
  }

  if (overview.account?.status === "active") {
    return "Ready";
  }

  if (overview.account?.provider_account_id) {
    return "Setup needed";
  }

  return "Not connected";
}

export function StripePaymentsSettings({
  defaultInvoiceTemplateKey,
  documentTemplates,
  overview,
}: Readonly<{
  defaultInvoiceTemplateKey: string | null;
  documentTemplates: QuoteTemplate[];
  overview: WorkspaceStripePaymentOverview;
}>) {
  const account = overview.account;
  const ready = account?.status === "active";
  const setupAvailable = overview.migrationReady && overview.configured;
  const resetAvailable = Boolean(account?.provider_account_id && !ready);

  return (
    <>
      <section
        className={`integration-provider-setup-bar stripe-setup-bar ${
          ready ? "ready" : "blocked"
        }`}
      >
        <div>
          <strong>
            {ready
              ? "Stripe payments are active"
              : account?.provider_account_id
                ? "Finish Stripe setup"
                : "Set up Stripe payments"}
          </strong>
          <span>
            {ready
              ? "Kyro can create customer payment links and track payment status."
              : "Payments cannot be used until Stripe setup is complete."}
          </span>
        </div>
        <div className="integration-provider-setup-actions">
          <form action={connectStripePaymentsAction}>
            <SettingsSubmitButton
              disabled={!setupAvailable}
              pendingLabel="Opening..."
            >
              {account?.provider_account_id
                ? "Continue Stripe setup"
                : "Set up Stripe payments"}
            </SettingsSubmitButton>
          </form>
          {resetAvailable ? <StripeResetButton /> : null}
        </div>
      </section>

      <div className="integration-summary-grid">
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Kyro creates Stripe-hosted payment links for customer payments
                and stores the payment status against the workspace.
              </>
            }
          >
            Payment links
          </SettingCardHeading>
        </article>
        <article className="setting-card">
          <SettingCardHeading
            info={
              <>
                Stripe sends signed webhook events back to Kyro so paid, failed,
                and onboarding states stay synced.
              </>
            }
          >
            Status tracking
          </SettingCardHeading>
        </article>
      </div>

      {!overview.migrationReady ? (
        <p className="form-alert">
          Payment tables are not in the database yet. Run the latest Supabase
          migration before connecting Stripe payments.
        </p>
      ) : null}
      {!overview.configured ? (
        <p className="form-alert">
          Add <code>STRIPE_SECRET_KEY</code> before creating payment links.
        </p>
      ) : null}
      {!overview.webhookConfigured ? (
        <p className="form-alert">
          Add <code>STRIPE_WEBHOOK_SECRET</code> so Kyro can verify Stripe
          payment updates.
        </p>
      ) : null}

      <div className="usage-ledger compact">
        <div className="usage-ledger-row">
          <div className="usage-ledger-main">
            <strong>Payment account</strong>
            <span>
              {account?.provider_account_id
                ? [
                    account.provider_account_id,
                    account.country_code,
                    account.default_currency,
                  ]
                    .filter(Boolean)
                    .join(" - ")
                : "No Stripe account connected yet."}
            </span>
          </div>
          <span className="pill">{ready ? "Ready" : "Needs setup"}</span>
        </div>
      </div>

      <section className="setting-card">
        <SettingCardHeading info="Kyro uses this document template when the Payments tab creates an invoice draft.">
          Default invoice template
        </SettingCardHeading>
        <DefaultInvoiceTemplateForm
          className="settings-inline-template-form"
          returnTo="/settings?section=integrations"
          selectedTemplateKey={defaultInvoiceTemplateKey}
          templates={documentTemplates}
        />
        {documentTemplates.length === 0 ? (
          <p className="empty-copy">
            Create an invoice template in Files before setting a default.
          </p>
        ) : null}
      </section>
    </>
  );
}

export function latestConnectedConnection(connections: ProviderConnection[]) {
  return (
    connections.find((connection) => connection.status === "connected") ?? null
  );
}

export function connectionTime(connection: ProviderConnection | null) {
  return connection?.lastConnectedAt
    ? new Date(connection.lastConnectedAt).getTime()
    : 0;
}

export function providerChoiceStatus({
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

export function inboundSyncModeLabel(value: string) {
  return value === "automatic"
    ? "Automatic polling"
    : value === "manual_only"
      ? "Manual only"
      : "Paused";
}

export function senderRuleActionLabel(value: InboundEmailSenderRule["action"]) {
  return value === "always_promote" ? "Always relevant" : "Always ignore";
}

export function senderRuleMatchLabel(value: InboundEmailSenderRule["match"]) {
  return value === "domain" ? "Domain" : "Email address";
}

export function senderRuleSourceLabel(rule: InboundEmailSenderRule) {
  return rule.createdFromEventId ? "Learned from Inbox" : "Manual rule";
}

export function senderRuleCreatedLabel(rule: InboundEmailSenderRule) {
  return rule.createdAt
    ? `Added ${formatDate(rule.createdAt)}`
    : "Added before tracking";
}

export function SenderRulesLauncher({
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

export function SenderRulesSettings({
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
            <SettingsSubmitButton pendingLabel="Adding...">
              Add rule
            </SettingsSubmitButton>
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
                    <SettingsSubmitButton
                      className="secondary-button compact"
                      pendingLabel="Saving..."
                    >
                      Save
                    </SettingsSubmitButton>
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

export function InboundEmailSyncSettings({
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
      <section className="integration-choice-panel inbound-email-sync-intro">
        <div>
          <p className="eyebrow">Inbound email sync</p>
          <h3>Email sync, filtering, and health</h3>
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
        timeZone={settings.timeZone}
      />

      <InboundEmailAutosaveForm
        action={autosaveInboundEmailSettingsAction}
        className="settings-form"
      >
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
            out unless it clearly affects the business. Changes save
            automatically.
          </span>
        </div>
      </InboundEmailAutosaveForm>

      <SenderRulesLauncher rules={settings.senderRules} />
      {showSenderRules ? (
        <SenderRulesSettings rules={settings.senderRules} />
      ) : null}

      <form
        action={syncInboundEmailNowAction}
        className="settings-footer manual-sync-footer"
      >
        <span>
          Manual check uses the same sync path the assistant can call during a
          conversation.
        </span>
        <ManualSyncSubmitButton />
      </form>
    </section>
  );
}

export function ProviderDetails({
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

export type InboundInquiryMode = VoiceSettings["phoneAgentInboundInquiryMode"];

export const INBOUND_INQUIRY_MODE_CONTENT: Record<
  InboundInquiryMode,
  { description: string; label: string }
> = {
  book_from_calendar: {
    description:
      "Check the Kyro calendar and book an available time with the customer.",
    label: "Book from calendar",
  },
  capture_notify: {
    description:
      "Capture the inquiry, add it to the work queue, and notify the primary workplace contact.",
    label: "Capture and notify",
  },
  propose_for_approval: {
    description:
      "Check availability and create a proposed time for the business to approve.",
    label: "Propose for approval",
  },
};

export function InboundInquiryHandlingSettings({
  voiceSettings,
}: Readonly<{ voiceSettings: VoiceSettings }>) {
  const selectedMode =
    INBOUND_INQUIRY_MODE_CONTENT[
      voiceSettings.phoneAgentInboundInquiryMode
    ];

  return (
    <form
      action={updateInboundInquiryHandlingAction}
      className="settings-form"
    >
      <section className="integration-choice-panel">
        <div>
          <p className="eyebrow">Inbound inquiries</p>
          <h3>Choose Kyro&apos;s level of autonomy</h3>
          <p>
            This applies to new customer inquiries across email, SMS, and phone.
            Decide whether Kyro captures the work, proposes the next step, or
            books an available time.
          </p>
        </div>
        <span className="pill">{selectedMode.label}</span>
      </section>

      <fieldset className="phone-inquiry-mode-fieldset">
        <legend>Handling mode</legend>
        <p>
          Kyro still follows outbound permissions, calendar availability, and
          approval boundaries within the selected mode.
        </p>
        <div className="phone-inquiry-mode-grid">
          {PHONE_AGENT_INBOUND_INQUIRY_MODES.map((mode, index) => {
            const content = INBOUND_INQUIRY_MODE_CONTENT[mode];

            return (
              <label className="phone-inquiry-mode-card" key={mode}>
                <input
                  defaultChecked={
                    voiceSettings.phoneAgentInboundInquiryMode === mode
                  }
                  name="phoneAgentInboundInquiryMode"
                  type="radio"
                  value={mode}
                />
                <span className="phone-inquiry-mode-number">{index + 1}</span>
                <span className="phone-inquiry-mode-copy">
                  <strong>{content.label}</strong>
                  <small>{content.description}</small>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="settings-footer compact-settings-footer">
        <span>
          Changes apply to future inquiries without altering existing work.
        </span>
        <SettingsSubmitButton pendingLabel="Saving...">
          Save
        </SettingsSubmitButton>
      </div>
    </form>
  );
}

export function WorkspaceIntegrationsSettings({
  activePanel,
  availablePhoneNumbers,
  communicationSettings,
  defaultInvoiceTemplateKey,
  documentTemplates,
  generalSettings,
  googleOverview,
  googleStatus,
  inboundEmailSettings,
  inboundEmailSummary,
  microsoftOverview,
  microsoftStatus,
  settingsFocus,
  showInboundTrace,
  showSenderRules,
  stripeOverview,
  twilioOverview,
  voiceSettings,
  workspaceName,
}: Readonly<{
  activePanel: IntegrationSettingsPanel;
  availablePhoneNumbers: WorkspacePhoneNumberPoolRow[];
  communicationSettings: CommunicationSettings | null;
  defaultInvoiceTemplateKey: string | null;
  documentTemplates: QuoteTemplate[];
  generalSettings: WorkspaceGeneralSettings | null;
  googleOverview: GoogleIntegrationOverview | null;
  googleStatus: string;
  inboundEmailSettings: InboundEmailSettings | null;
  inboundEmailSummary: InboundEmailOperationalSummary | null;
  microsoftOverview: MicrosoftIntegrationOverview | null;
  microsoftStatus: string;
  settingsFocus?: string | null;
  showInboundTrace: boolean;
  showSenderRules: boolean;
  stripeOverview: WorkspaceStripePaymentOverview | null;
  twilioOverview: TwilioTelephonyOverview | null;
  voiceSettings: VoiceSettings | null;
  workspaceName: string;
}>) {
  const googleConnections = googleOverview?.connections ?? [];
  const microsoftConnections = microsoftOverview?.connections ?? [];
  const googleConnection = latestConnectedConnection(googleConnections);
  const microsoftConnection = latestConnectedConnection(microsoftConnections);
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
    ...googleConnections.map((connection) => ({
      ...connection,
      provider: "google" as const,
      providerLabel: "Google",
      requiredReadScope: GOOGLE_GMAIL_READ_SCOPE,
    })),
    ...microsoftConnections.map((connection) => ({
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
  const communicationStatus = communicationSettings?.approvalRequired
    ? "Approval required"
    : "Auto outbound";
  const twilioStatus = twilioOverview
    ? twilioStatusLabel(twilioOverview)
    : "Open";
  const stripeStatus = stripeOverview
    ? stripePaymentsStatusLabel(stripeOverview)
    : "Open";

  return (
    <div className="integration-provider-stack">
      {activePanel === "inbound-email" &&
      inboundEmailSettings &&
      inboundEmailSummary ? (
        <InboundEmailSyncSettings
          connections={emailConnections}
          operationalSummary={inboundEmailSummary}
          settings={inboundEmailSettings}
          showInboundTrace={showInboundTrace}
          showSenderRules={showSenderRules}
        />
      ) : null}

      {activePanel === "inbound-inquiry-handling" && voiceSettings ? (
        <InboundInquiryHandlingSettings voiceSettings={voiceSettings} />
      ) : null}

      {activePanel === "outbound" && communicationSettings ? (
        <ProviderDetails
          description={`${communicationSettings.allowedChannels.length} channels and email signatures`}
          forceOpen
          isCurrent={false}
          label="Outbound communication"
          provider="Rules"
          status={communicationStatus}
        >
          <CommunicationSettingsDetail
            communicationSettings={communicationSettings}
            defaultPublicPhone={
              generalSettings?.businessProfile.publicPhoneNumber ?? ""
            }
            profile={generalSettings?.businessProfile ?? null}
            settingsFocus={settingsFocus}
            workspaceName={workspaceName}
          />
        </ProviderDetails>
      ) : null}

      {activePanel === "phone-sms" &&
      twilioOverview &&
      generalSettings &&
      voiceSettings ? (
        <ProviderDetails
          description={
            twilioOverview.numbers.length > 0
              ? `${twilioOverview.numbers.length} workspace number${
                  twilioOverview.numbers.length === 1 ? "" : "s"
                }`
              : "SMS and future phone calls"
          }
          forceOpen
          isCurrent={false}
          label="Kyro phone and SMS"
          provider="Kyro"
          status={twilioStatus}
        >
          <TwilioTelephonySettings
            availableNumbers={availablePhoneNumbers}
            generalSettings={generalSettings}
            overview={twilioOverview}
            voiceSettings={voiceSettings}
          />
        </ProviderDetails>
      ) : null}

      {activePanel === "stripe" && stripeOverview ? (
        <ProviderDetails
          description={
            stripeOverview.account?.status === "active"
              ? "Payment links and status tracking"
              : "Customer payment links"
          }
          forceOpen
          isCurrent={false}
          label="Customer payments"
          provider="Stripe"
          status={stripeStatus}
        >
          <StripePaymentsSettings
            defaultInvoiceTemplateKey={defaultInvoiceTemplateKey}
            documentTemplates={documentTemplates}
            overview={stripeOverview}
          />
        </ProviderDetails>
      ) : null}

      {activePanel === "email-accounts" &&
      googleOverview &&
      microsoftOverview ? (
        <>
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
                Outlook; if both are connected, Kyro uses the most recently
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
            forceOpen
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
            forceOpen
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
        </>
      ) : null}
    </div>
  );
}
