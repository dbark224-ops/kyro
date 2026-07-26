import {
  AutoSubmitControl,
} from "../auto-submit-control";
import {
  DEFAULT_WORKSPACE_GENERAL_SETTINGS,
  type WorkspaceGeneralSettings,
} from "../../../lib/workspace/general-settings";
import {
  EmailSignatureEditor,
} from "../email-signature-editor";
import {
  InfoBubble,
} from "../info-bubble";
import {
  SettingsSubmitButton,
} from "../settings-submit-button";
import {
  aiAssistantSignatureForEditor,
  formatLabel,
  SettingCardHeading,
} from "../shared";
import {
  type CommunicationSettings,
  MAX_FOLLOW_UP_DELAY_DAYS,
  MIN_FOLLOW_UP_DELAY_DAYS,
  OUTBOUND_CHANNELS,
  REPLY_MESSAGE_LENGTH_OPTIONS,
} from "../../../lib/communication/settings";
import {
  updateCommunicationSettingsAction,
} from "../actions";
/**
 * The communication section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function OutboundWritingStyleEditor({
  communicationSettings,
  defaultOpen = false,
}: Readonly<{
  communicationSettings: CommunicationSettings;
  defaultOpen?: boolean;
}>) {
  const writing = communicationSettings.replyWriting;

  return (
    <details
      className="settings-accordion settings-expandable"
      open={defaultOpen}
    >
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

        <div className="settings-footer compact-settings-footer">
          <span>
            Save to apply these writing instructions to future drafts.
          </span>
          <SettingsSubmitButton name="settingsFocus" value="outbound-writing">
            Save writing style
          </SettingsSubmitButton>
        </div>
      </div>
    </details>
  );
}

export function CommunicationSettingsDetail({
  communicationSettings,
  defaultPublicPhone,
  profile,
  settingsFocus,
  workspaceName,
}: Readonly<{
  communicationSettings: CommunicationSettings;
  defaultPublicPhone: string;
  profile: WorkspaceGeneralSettings["businessProfile"] | null;
  settingsFocus?: string | null;
  workspaceName: string;
}>) {
  const aiSignature = aiAssistantSignatureForEditor({
    communicationSettings,
    defaultPublicPhone,
    profile: profile ?? {
      ...DEFAULT_WORKSPACE_GENERAL_SETTINGS.businessProfile,
      businessName: workspaceName,
      publicPhoneNumber: defaultPublicPhone,
    },
    workspaceName,
  });

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

      <AutoSubmitControl className="settings-auto-save-stack">
        <section className="setting-card outbound-routing-card">
          <div className="outbound-routing-grid">
            <label className="outbound-permission-control">
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

            <fieldset className="outbound-channel-control">
              <legend className="settings-control-label">
                Allowed outbound channels
              </legend>
              <div className="channel-toggle-grid compact-channel-toggle-grid">
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
                    <span>
                      {channel === "sms" ? "SMS" : formatLabel(channel)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <label className="settings-switch-row known-fact-auto-reply-control">
            <span>
              <strong>Answer basic business questions automatically</strong>
              <small>
                Kyro can immediately answer from saved public contact details,
                service area, and business hours. Quotes, bookings, promises,
                complaints, and sensitive information still require review.
              </small>
            </span>
            <input
              defaultChecked={
                communicationSettings.autoReplyKnownBusinessFacts
              }
              name="autoReplyKnownBusinessFacts"
              type="checkbox"
            />
            <span aria-hidden="true" className="settings-switch" />
          </label>
        </section>

        <fieldset className="settings-fieldset follow-up-reminder-panel">
          <legend>Follow-up reminders</legend>
          <div className="follow-up-reminder-grid">
            <label className="compact-checkbox-row follow-up-toggle-card">
              <input
                defaultChecked={communicationSettings.followUpRemindersEnabled}
                name="followUpRemindersEnabled"
                type="checkbox"
              />
              <span>Automatically create internal follow-up reminders</span>
            </label>

            <label className="follow-up-delay-card">
              <span>Default delay</span>
              <input
                defaultValue={communicationSettings.followUpDelayDays}
                max={MAX_FOLLOW_UP_DELAY_DAYS}
                min={MIN_FOLLOW_UP_DELAY_DAYS}
                name="followUpDelayDays"
                type="number"
              />
              <span>days</span>
            </label>
          </div>
        </fieldset>
      </AutoSubmitControl>

      <OutboundWritingStyleEditor
        communicationSettings={communicationSettings}
        defaultOpen={settingsFocus === "outbound-writing"}
      />

      <details
        className="settings-accordion settings-expandable email-signatures-accordion"
        open={settingsFocus === "email-signatures"}
      >
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
            signature={aiSignature}
            title="AI assistant signature"
          />

          <div className="settings-footer compact-settings-footer">
            <span>
              Save to refresh the signature previews and apply them to future
              Gmail sends.
            </span>
            <SettingsSubmitButton name="settingsFocus" value="email-signatures">
              Save and preview signatures
            </SettingsSubmitButton>
          </div>
        </div>
      </details>
    </form>
  );
}
