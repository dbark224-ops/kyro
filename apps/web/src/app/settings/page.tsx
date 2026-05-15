import { AppFrame } from "../components/app-frame";
import { updateCommunicationSettingsAction } from "./actions";
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
  if (value === "communication" || value === "google" || value === "usage") {
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
          Choose communication rules, Google Workspace, or billing and metering from
          the settings list to view and edit the full details here.
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
}: GoogleIntegrationOverview) {
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
      <div className="settings-grid">
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
            Email sends through connected Gmail. Other channels stay internal until
            their providers are connected.
          </span>
        </label>

        <label className="setting-card">
          <strong>Default send style</strong>
          <select
            defaultValue={communicationSettings.defaultTone}
            name="defaultTone"
          >
            <option value="friendly_direct">Friendly and direct</option>
            <option value="professional_concise">
              Professional and concise
            </option>
            <option value="warm_helpful">Warm and helpful</option>
            <option value="short_trade">Short tradie style</option>
          </select>
          <span>This becomes the default style cue for outbound drafts.</span>
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

          <fieldset className="settings-fieldset">
            <legend>Assistant email signature</legend>
            <label className="channel-toggle signature-toggle">
              <input
                defaultChecked={communicationSettings.useSeparateAiSignature}
                name="useSeparateAiSignature"
                type="checkbox"
              />
              <span>Use a different signature for untouched AI-sent emails</span>
            </label>
            <label className="channel-toggle signature-toggle">
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
        <span>Gmail can send real email when Google is connected; SMS and phone are internal records.</span>
        <button className="primary-button compact" type="submit">
          Save settings
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
  const [communicationSettings, usageReport, googleOverview] = await Promise.all([
    getCommunicationSettings(supabase, workspace.id),
    getUsageReport(supabase, workspace.id, activeWindow),
    getGoogleIntegrationOverview(supabase, workspace.id),
  ]);
  const selectedSection = normalizeSettingsSection(query?.section);
  const googleStatus = integrationStatusLabel(googleOverview);
  const gmailConnected = googleOverview.connections.some(
    (connection) => connection.status === "connected"
  );
  const outboundStatus = communicationSettings.approvalRequired
    ? "Approval required"
    : "Direct send";
  const settingsItems: SettingsMenuItem[] = [
    {
      detail: `${communicationSettings.allowedChannels.length} channels - ${formatLabel(
        communicationSettings.defaultTone,
      )}`,
      eyebrow: "Outbound",
      href: settingsSectionHref("communication", activeWindow),
      section: "communication",
      status: outboundStatus,
      title: "Communication settings",
    },
    {
      detail: "Gmail outbound and Drive document access",
      eyebrow: "Integrations",
      href: settingsSectionHref("google", activeWindow),
      section: "google",
      status: googleStatus,
      title: "Google Workspace",
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
            status={gmailConnected ? "Gmail active" : "Needs Google"}
            title="Communication settings"
          >
            <CommunicationSettingsDetail
              communicationSettings={communicationSettings}
            />
          </SettingsDetailShell>
        }
        empty={<EmptySettingsDetail />}
        google={
          <SettingsDetailShell
            eyebrow="Integrations"
            status={googleStatus}
            title="Google Workspace"
          >
            <GoogleIntegrationSettings overview={googleOverview} />
          </SettingsDetailShell>
        }
        initialSection={selectedSection}
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
      />
    </AppFrame>
  );
}
