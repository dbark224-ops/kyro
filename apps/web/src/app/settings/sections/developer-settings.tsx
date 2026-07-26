import Link from "next/link";
import {
  OPENAI_VOICE_OPTIONS,
  OUTBOUND_VOICE_PRONUNCIATION_POLICIES,
  type VoiceSettings,
} from "../../../lib/assistant/voice-settings";
import {
  SettingsSubmitButton,
} from "../settings-submit-button";
import {
  formatDate,
  formatLabel,
  invoiceDisplayCurrencySettings,
  isVoicemailOverflowPhoneNumber,
  SettingCardHeading,
} from "../shared";
import {
  formatDisplayMoney,
} from "../../../lib/billing/display-currency";
import {
  type KyroBillingEngineOverview,
} from "../../../lib/billing/kyro-billing-engine";
import {
  type WorkspaceGeneralSettings,
} from "../../../lib/workspace/general-settings";
import {
  type WorkspacePhoneNumberPoolRow,
} from "../../../lib/voice/phone-number-pool";
import {
  updateDashboardTutorialTestModeAction,
  updateVoiceSettingsAction,
  updateWorkspaceUsageMarkupRateAction,
} from "../actions";
/**
 * The developer tools section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function policyLabel(value: string) {
  return value === "strict"
    ? "Strict"
    : value === "balanced"
      ? "Balanced"
      : value === "flexible"
        ? "Flexible"
        : "Off";
}

export function DeveloperSettingsDetail({
  assignedPhoneNumbers,
  billingEngineOverview,
  dashboardTutorialForceShow,
  generalSettings,
  voiceSettings,
}: Readonly<{
  assignedPhoneNumbers: WorkspacePhoneNumberPoolRow[];
  billingEngineOverview: KyroBillingEngineOverview;
  dashboardTutorialForceShow: boolean;
  generalSettings: WorkspaceGeneralSettings;
  voiceSettings: VoiceSettings;
}>) {
  const voiceNumbers = assignedPhoneNumbers.filter(
    (number) => number.status === "active" && number.capabilities.voice,
  );
  const voicemailNumber =
    voiceNumbers.find(isVoicemailOverflowPhoneNumber) ??
    assignedPhoneNumbers.find(isVoicemailOverflowPhoneNumber) ??
    null;
  const voicemailReadiness = [
    {
      ready: voiceSettings.phoneAgentEnabled,
      title: "Phone infrastructure",
      value: voiceSettings.phoneAgentEnabled ? "Enabled" : "Disabled",
    },
    {
      ready: voiceSettings.phoneAgentVoicemailOverflowEnabled,
      title: "Voicemail overflow",
      value: voiceSettings.phoneAgentVoicemailOverflowEnabled
        ? "Enabled"
        : "Disabled",
    },
    {
      ready: Boolean(voicemailNumber?.phoneNumber),
      title: "Forwarding number",
      value: voicemailNumber?.phoneNumber ?? "Missing",
    },
    {
      ready: Boolean(voicemailNumber?.vapiPhoneNumberId),
      title: "Linked voice number",
      value: voicemailNumber?.vapiPhoneNumberId ?? "Missing",
    },
    {
      ready: Boolean(voiceSettings.vapiVoicemailAssistantId),
      title: "Voicemail assistant",
      value: voiceSettings.vapiVoicemailAssistantId ?? "Missing",
    },
    {
      ready: Boolean(voiceSettings.vapiInboundAssistantId),
      title: "Inbound fallback",
      value: voiceSettings.vapiInboundAssistantId ?? "Missing",
    },
  ];
  const readinessOk = voicemailReadiness.every((check) => check.ready);

  return (
    <div className="settings-form">
      <article className="panel embedded-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Developer tools</p>
            <h2>Internal surfaces</h2>
          </div>
          <span className="pill">Developer only</span>
        </div>
        <p className="empty-copy">
          These screens are operational and diagnostic tools. They stay hidden
          from normal workspaces so user-facing settings stay simple.
        </p>
        <div className="detail-list">
          <div>
            <span>Mock inbound</span>
            <strong>
              <Link href="/settings?section=developer&panel=mock-inquiries">
                Open mock inquiries
              </Link>
            </strong>
          </div>
          <div>
            <span>Outbound</span>
            <strong>
              <Link href="/developer/outbox">Outbox operations</Link>
            </strong>
          </div>
          <div>
            <span>Health</span>
            <strong>
              <Link href="/developer/system-health">System health</Link>
            </strong>
          </div>
          <div>
            <span>System checks</span>
            <strong>
              <Link href="/developer/system-health">Check readiness</Link>
            </strong>
          </div>
          <div>
            <span>Assistant</span>
            <strong>
              <Link href="/developer/assistant-tools">Tool registry</Link>
            </strong>
          </div>
        </div>
        <div className="developer-reset-card">
          <div>
            <strong>Dashboard tutorial</strong>
            <p>
              Keep this on while previewing the first-run walkthrough. Normal
              workspaces still only see the tutorial once unless they launch it
              manually from the top bar.
            </p>
          </div>
          <form
            action={updateDashboardTutorialTestModeAction}
            className="developer-reset-form"
          >
            <label className="developer-toggle-label">
              <input
                defaultChecked={dashboardTutorialForceShow}
                name="dashboardTutorialForceShow"
                type="checkbox"
              />
              <span>Always show tutorial</span>
            </label>
            <SettingsSubmitButton
              className="secondary-button compact"
              pendingLabel="Saving..."
            >
              Save
            </SettingsSubmitButton>
          </form>
        </div>
      </article>

      <article className="panel embedded-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Pricing control</p>
            <h2>Workspace usage margin</h2>
          </div>
          <span className="pill">Developer only</span>
        </div>
        <p className="empty-copy">
          Sets the margin used when future provider usage is converted from cost
          price to customer charge for this workspace.
        </p>
        <form
          action={updateWorkspaceUsageMarkupRateAction}
          className="developer-reset-form"
        >
          <label className="setting-card compact-setting-card">
            <SettingCardHeading info="A value of 25 means Kyro charges provider cost plus 25%. Existing usage rows and issued invoices are not recalculated.">
              Usage margin (%)
            </SettingCardHeading>
            <input
              defaultValue={String(
                Math.round(generalSettings.usageMarkupRate * 10000) / 100,
              )}
              max="1000"
              min="0"
              name="usageMarkupPercent"
              step="0.01"
              type="number"
            />
          </label>
          <SettingsSubmitButton
            className="secondary-button compact"
            pendingLabel="Saving..."
          >
            Save margin
          </SettingsSubmitButton>
        </form>
      </article>

      <form action={updateVoiceSettingsAction} className="settings-form">
        <input name="redirectSection" type="hidden" value="developer" />
        <input name="settingsPanel" type="hidden" value="provider-ids" />
        <input
          name="elevenLabsVoicePresetId"
          type="hidden"
          value={voiceSettings.elevenLabsVoicePresetId}
        />
        <input
          name="phoneAgentDemeanor"
          type="hidden"
          value={voiceSettings.phoneAgentDemeanor}
        />
        <input
          name="phoneAgentVerbosity"
          type="hidden"
          value={voiceSettings.phoneAgentVerbosity}
        />
        <input
          name="phoneAgentHumourLevel"
          type="hidden"
          value={voiceSettings.phoneAgentHumourLevel}
        />
        <input
          name="phoneAgentEscalationMode"
          type="hidden"
          value={voiceSettings.phoneAgentEscalationMode}
        />
        <input
          name="phoneAgentUserNumbers"
          type="hidden"
          value={voiceSettings.phoneAgentUserNumbers.join("\n")}
        />
        {voiceSettings.phoneAgentUserNumberDetails.map((row) => (
          <span key={`${row.phoneNumber}-${row.name ?? ""}-${row.role ?? ""}`}>
            <input
              name="phoneAgentTeamPhone"
              type="hidden"
              value={row.phoneNumber}
            />
            <input
              name="phoneAgentTeamName"
              type="hidden"
              value={row.name ?? ""}
            />
            <input
              name="phoneAgentTeamRole"
              type="hidden"
              value={row.role ?? ""}
            />
          </span>
        ))}
        {voiceSettings.phoneAgentEnabled ? (
          <input name="phoneAgentEnabled" type="hidden" value="on" />
        ) : null}
        {voiceSettings.phoneAgentInboundEnabled ? (
          <input name="phoneAgentInboundEnabled" type="hidden" value="on" />
        ) : null}
        {voiceSettings.phoneAgentVoicemailOverflowEnabled ? (
          <input
            name="phoneAgentVoicemailOverflowEnabled"
            type="hidden"
            value="on"
          />
        ) : null}
        {voiceSettings.phoneAgentOutboundEnabled ? (
          <input name="phoneAgentOutboundEnabled" type="hidden" value="on" />
        ) : null}

        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Legacy voice controls</p>
              <h2>OpenAI voice internals</h2>
            </div>
            <span className="pill">Hidden from users</span>
          </div>
          <div className="settings-grid">
            <label className="setting-card">
              <SettingCardHeading info="Legacy browser voice and generated-playback voice. Hidden while the voice assistant is the user-facing voice runtime.">
                OpenAI assistant voice
              </SettingCardHeading>
              <select
                defaultValue={voiceSettings.openAiVoice}
                name="openAiVoice"
              >
                {OPENAI_VOICE_OPTIONS.map((voice) => (
                  <option key={voice} value={voice}>
                    {formatLabel(voice)}
                  </option>
                ))}
              </select>
            </label>

            <label className="setting-card">
              <SettingCardHeading info="Pronunciation policy for customer-facing voice replies. The shared pronunciation list is used by the voice assistant too.">
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
            <SettingsSubmitButton>
              Save developer voice settings
            </SettingsSubmitButton>
          </div>
        </article>

        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Kyro billing</p>
              <h2>Invoice engine</h2>
            </div>
            <span
              className={
                billingEngineOverview.pastDueInvoiceCount > 0
                  ? "settings-status-pill warning"
                  : "settings-status-pill ready"
              }
            >
              {billingEngineOverview.pastDueInvoiceCount > 0
                ? "Action needed"
                : "Inspectable"}
            </span>
          </div>
          <p className="empty-copy">
            Dev-only readout for Kyro-owned billing periods, invoice totals, and
            failed-payment retry state. Stripe only receives the final invoice
            amount when charging is enabled.
          </p>
          <div className="detail-list compact-detail-list">
            <div>
              <span>Open invoices</span>
              <strong>{billingEngineOverview.openInvoiceCount}</strong>
            </div>
            <div>
              <span>Past due</span>
              <strong>{billingEngineOverview.pastDueInvoiceCount}</strong>
            </div>
            <div>
              <span>Latest invoice</span>
              <strong>
                {billingEngineOverview.latestInvoice?.invoiceNumber ?? "None"}
              </strong>
            </div>
          </div>
          {billingEngineOverview.invoices.length > 0 ? (
            <div className="developer-billing-grid">
              <div className="usage-table kyro-invoice-table">
                <div
                  className="usage-row usage-row-three heading"
                  aria-hidden="true"
                >
                  <span>Invoice</span>
                  <span>Status</span>
                  <span>Total</span>
                </div>
                {billingEngineOverview.invoices.map((invoice) => (
                  <div className="usage-row usage-row-three" key={invoice.id}>
                    <div>
                      <strong>{invoice.invoiceNumber}</strong>
                      <span>
                        {invoice.dueAt
                          ? `Due ${formatDate(invoice.dueAt)}`
                          : "No due date"}
                      </span>
                    </div>
                    <span>{formatLabel(invoice.status)}</span>
                    <span>
                      {formatDisplayMoney(
                        invoice.totalAmount,
                        invoice.currency,
                        invoiceDisplayCurrencySettings(invoice.currency),
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className="usage-table kyro-invoice-table">
                <div
                  className="usage-row usage-row-three heading"
                  aria-hidden="true"
                >
                  <span>Period</span>
                  <span>Status</span>
                  <span>Total</span>
                </div>
                {billingEngineOverview.periods.map((period) => (
                  <div className="usage-row usage-row-three" key={period.id}>
                    <div>
                      <strong>{formatDate(period.periodStart)}</strong>
                      <span>to {formatDate(period.periodEnd)}</span>
                    </div>
                    <span>{formatLabel(period.status)}</span>
                    <span>
                      {formatDisplayMoney(
                        period.totalAmount,
                        period.currency,
                        invoiceDisplayCurrencySettings(period.currency),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-copy">
              No Kyro billing periods have been generated yet.
            </p>
          )}
        </article>

        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Voicemail overflow</p>
              <h2>Routing readiness</h2>
            </div>
            <span
              className={
                readinessOk
                  ? "settings-status-pill ready"
                  : "settings-status-pill warning"
              }
            >
              {readinessOk ? "Ready" : "Needs attention"}
            </span>
          </div>
          <p className="empty-copy">
            Internal readiness panel for confirming missed-call forwarding is
            aimed at a Kyro number that resolves to the voicemail overflow
            assistant.
          </p>
          <div className="developer-readiness-grid">
            {voicemailReadiness.map((check) => (
              <div className="developer-readiness-row" key={check.title}>
                <span
                  className={
                    check.ready
                      ? "settings-status-pill ready"
                      : "settings-status-pill warning"
                  }
                >
                  {check.ready ? "OK" : "Check"}
                </span>
                <div>
                  <strong>{check.title}</strong>
                  <small>{check.value}</small>
                </div>
              </div>
            ))}
          </div>
          <p className="empty-copy">
            Assistant-selection proof is stored on each voice call under
            voice_calls.metadata.assistantSelection after the assistant-request
            and webhook events return.
          </p>
        </article>

        <article className="panel embedded-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Provider IDs</p>
              <h2>Phone assistant routing</h2>
            </div>
            <span className="pill">Developer only</span>
          </div>
          <p className="empty-copy">
            These IDs wire Kyro&apos;s configured phone number and voice
            assistants to the external voice runtime. Keep them hidden from
            normal users.
          </p>
          <div className="settings-grid">
            <label className="setting-card">
              <SettingCardHeading info="Provider phone number ID for the workspace voice/SMS number. Kyro can also read the configured environment value.">
                Phone number ID
              </SettingCardHeading>
              <input
                defaultValue={voiceSettings.vapiPhoneNumberId ?? ""}
                name="vapiPhoneNumberId"
                placeholder="pn_..."
              />
            </label>
            <label className="setting-card">
              <SettingCardHeading info="Assistant used by the browser and mobile voice tab for internal Kyro conversations.">
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
          <div className="settings-footer align-end">
            <SettingsSubmitButton>Save provider IDs</SettingsSubmitButton>
          </div>
        </article>
      </form>
    </div>
  );
}
