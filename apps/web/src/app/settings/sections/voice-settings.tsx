import Link from "next/link";
import scheduleStyles from "../schedule-settings.module.css";
import {
  ELEVENLABS_VOICE_PRESETS,
  PHONE_AGENT_DEMEANORS,
  PHONE_AGENT_ESCALATION_MODES,
  PHONE_AGENT_HUMOUR_LEVELS,
  PHONE_AGENT_VERBOSITIES,
  type VoiceSettings,
} from "../../../lib/assistant/voice-settings";
import {
  InfoBubble,
} from "../info-bubble";
import {
  PronunciationEntryCard,
} from "../sections/pronunciation-entry-card";
import {
  PronunciationEntryExpander,
} from "../pronunciation-entry-expander";
import {
  SettingsSubmitButton,
} from "../settings-submit-button";
import {
  WorkplaceContactsEditor,
} from "../workplace-contacts-editor";
import {
  createPronunciationEntryAction,
  disableVoicemailOverflowNumberAction,
  enableVoicemailOverflowNumberAction,
  updateVoiceSettingsAction,
} from "../actions";
import {
  formatLabel,
  isVoicemailOverflowPhoneNumber,
  SettingCardHeading,
} from "../shared";
import {
  type AssistantPronunciationEntry,
  PRONUNCIATION_CATEGORIES,
} from "../../../lib/assistant/pronunciation";
import {
  type BusinessHoursScheduleSettings,
  type WorkplaceContactSettings,
} from "../../../lib/workspace/general-settings";
import {
  type PhoneRegion,
} from "../../../lib/crm/identity";
import {
  type WorkspacePhoneNumberPoolRow,
} from "../../../lib/voice/phone-number-pool";
/**
 * The voice section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function VoiceSettingsDetail({
  activePanel,
  assignedPhoneNumbers,
  businessWorkingHoursSchedule,
  defaultPhoneRegion,
  pronunciationEntries,
  workplaceContacts,
  userEmail,
  voiceSettings,
}: Readonly<{
  activePanel?: string | null;
  assignedPhoneNumbers: WorkspacePhoneNumberPoolRow[];
  businessWorkingHoursSchedule: BusinessHoursScheduleSettings;
  defaultPhoneRegion: PhoneRegion;
  pronunciationEntries: AssistantPronunciationEntry[];
  workplaceContacts: WorkplaceContactSettings[];
  userEmail: string;
  voiceSettings: VoiceSettings;
}>) {
  const activeVoicePanel =
    activePanel === "phone-assistant" ||
    activePanel === "voicemail-overflow" ||
    activePanel === "pronunciation"
      ? activePanel
      : "voice-assistant";
  const hiddenPanelStyle = { display: "none" } as const;
  const visibleWhen = (condition: boolean) =>
    condition ? undefined : hiddenPanelStyle;
  const showVoiceSettingsForm =
    activeVoicePanel === "voice-assistant" ||
    activeVoicePanel === "phone-assistant";

  return (
    <>
      <form
        action={updateVoiceSettingsAction}
        className="settings-form"
        style={visibleWhen(showVoiceSettingsForm)}
      >
        <input name="settingsPanel" type="hidden" value={activeVoicePanel} />
        <input
          name="openAiVoice"
          type="hidden"
          value={voiceSettings.openAiVoice}
        />
        <input
          name="outboundVoicePronunciationPolicy"
          type="hidden"
          value={voiceSettings.outboundVoicePronunciationPolicy}
        />
        <div
          className="settings-grid"
          style={visibleWhen(activeVoicePanel === "voice-assistant")}
        >
          <label className="setting-card">
            <SettingCardHeading
              info={
                <>
                  This voice is used across Kyro&apos;s internal voice
                  assistant, inbound phone assistant, voicemail overflow, and
                  outbound phone calls.
                </>
              }
            >
              Voice assistant
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
        </div>

        <fieldset
          className="settings-fieldset"
          style={visibleWhen(activeVoicePanel === "phone-assistant")}
        >
          <legend>Phone assistant</legend>
          <div className="phone-assistant-compact-panel">
            <label className="settings-switch-row phone-assistant-master-toggle">
              <span>
                <strong>Enable phone assistant infrastructure</strong>
                <small>
                  Turns on Kyro&apos;s phone-call runtime for configured
                  numbers.
                </small>
              </span>
              <input
                defaultChecked={voiceSettings.phoneAgentEnabled}
                name="phoneAgentEnabled"
                type="checkbox"
              />
              <span aria-hidden="true" className="settings-switch" />
            </label>

            <div className="settings-grid phone-assistant-style-grid">
              <label className="setting-card compact-setting-card">
                <SettingCardHeading
                  info="This controls the broad feel of Kyro's assistant prompt for inbound, voicemail overflow, and outbound calls."
                  infoPlacement="right"
                >
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

              <label className="setting-card compact-setting-card">
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

              <label className="setting-card compact-setting-card">
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

              <label className="setting-card compact-setting-card">
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

            <div className="phone-assistant-toggle-row">
              <label className="settings-switch-row compact">
                <span>Inbound customer calls</span>
                <input
                  defaultChecked={voiceSettings.phoneAgentInboundEnabled}
                  name="phoneAgentInboundEnabled"
                  type="checkbox"
                />
                <span aria-hidden="true" className="settings-switch" />
              </label>
              <label className="settings-switch-row compact">
                <span>Voicemail overflow</span>
                <input
                  defaultChecked={
                    voiceSettings.phoneAgentVoicemailOverflowEnabled
                  }
                  name="phoneAgentVoicemailOverflowEnabled"
                  type="checkbox"
                />
                <span aria-hidden="true" className="settings-switch" />
              </label>
              <label className="settings-switch-row compact">
                <span>Outbound calls</span>
                <input
                  defaultChecked={voiceSettings.phoneAgentOutboundEnabled}
                  name="phoneAgentOutboundEnabled"
                  type="checkbox"
                />
                <span aria-hidden="true" className="settings-switch" />
              </label>
            </div>

            <input
              name="phoneAgentInboundInquiryMode"
              type="hidden"
              value={voiceSettings.phoneAgentInboundInquiryMode}
            />
          </div>

          <input
            name="phoneAgentUserNumbers"
            type="hidden"
            value={voiceSettings.phoneAgentUserNumbers.join("\n")}
          />
          <input
            name="vapiPhoneNumberId"
            type="hidden"
            value={voiceSettings.vapiPhoneNumberId ?? ""}
          />
          <input
            name="vapiInternalAssistantId"
            type="hidden"
            value={voiceSettings.vapiInternalAssistantId ?? ""}
          />
          <input
            name="vapiInboundAssistantId"
            type="hidden"
            value={voiceSettings.vapiInboundAssistantId ?? ""}
          />
          <input
            name="vapiVoicemailAssistantId"
            type="hidden"
            value={voiceSettings.vapiVoicemailAssistantId ?? ""}
          />
          <input
            name="vapiOutboundAssistantId"
            type="hidden"
            value={voiceSettings.vapiOutboundAssistantId ?? ""}
          />
          <div className={scheduleStyles.phoneAssistantContacts}>
            <WorkplaceContactsEditor
              businessWorkingHoursSchedule={businessWorkingHoursSchedule}
              contacts={workplaceContacts}
              defaultEmail={userEmail}
              defaultPhoneRegion={defaultPhoneRegion}
              description="These workplace contacts are used to recognize internal callers and decide who Kyro can alert when calls need a human."
              title="User and team contacts"
            />
          </div>
        </fieldset>

        <div
          className="settings-footer align-end"
          style={visibleWhen(showVoiceSettingsForm)}
        >
          <SettingsSubmitButton>Save voice settings</SettingsSubmitButton>
        </div>
      </form>

      <div style={visibleWhen(activeVoicePanel === "voicemail-overflow")}>
        <VoicemailOverflowSettings
          assignedPhoneNumbers={assignedPhoneNumbers}
          voiceSettings={voiceSettings}
        />
      </div>

      <div style={visibleWhen(activeVoicePanel === "pronunciation")}>
        <PronunciationVocabularySettings entries={pronunciationEntries} />
      </div>
    </>
  );
}

export function VoicemailOverflowSettings({
  assignedPhoneNumbers,
  voiceSettings,
}: Readonly<{
  assignedPhoneNumbers: WorkspacePhoneNumberPoolRow[];
  voiceSettings: VoiceSettings;
}>) {
  const voiceNumbers = assignedPhoneNumbers.filter(
    (number) => number.status === "active" && number.capabilities.voice,
  );
  const voicemailNumber =
    voiceNumbers.find(isVoicemailOverflowPhoneNumber) ??
    assignedPhoneNumbers.find(isVoicemailOverflowPhoneNumber) ??
    null;
  const voicemailBackendReady = Boolean(
    voicemailNumber?.vapiPhoneNumberId &&
    voiceSettings.phoneAgentVoicemailOverflowEnabled &&
    voiceSettings.vapiVoicemailAssistantId,
  );

  return (
    <article className="panel embedded-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Voicemail overflow</p>
          <h2>Missed-call fallback number</h2>
        </div>
        <span className="pill">
          {voicemailNumber
            ? "Configured"
            : voiceNumbers.length > 0
              ? "Needs setup"
              : "Needs phone number"}
        </span>
      </div>

      {voicemailNumber ? (
        <div className="detail-list compact-detail-list voicemail-overflow-status-list">
          <div>
            <span>Your call forwarding number is</span>
            <strong>{voicemailNumber.phoneNumber}</strong>
          </div>
          <div>
            <span>Backend status</span>
            <strong
              className={
                voicemailBackendReady
                  ? "settings-status-pill ready"
                  : "settings-status-pill warning"
              }
            >
              {voicemailBackendReady
                ? "Ready for forwarded calls"
                : "Needs voice assistant or linked number"}
            </strong>
          </div>
        </div>
      ) : null}

      {!voiceSettings.phoneAgentVoicemailOverflowEnabled ? (
        <p className="form-alert compact-alert">
          Turn on voicemail overflow in phone assistant settings and save before
          forwarded callers are routed to the voicemail overflow assistant.{" "}
          <Link href="/settings?section=voice&panel=phone-assistant">
            Open phone assistant settings
          </Link>
        </p>
      ) : null}

      {voicemailNumber ? (
        <div className="settings-grid">
          <div className="setting-card">
            <SettingCardHeading info="Kyro cannot change a mobile carrier forwarding rule directly. Use this number in the user's phone or carrier portal for unanswered, busy, or unreachable-call forwarding.">
              Set up personal phone overflow
            </SettingCardHeading>
            <div className="detail-list compact-detail-list">
              <div>
                <span>Use this number in your phone forwarding settings</span>
                <strong>{voicemailNumber.phoneNumber}</strong>
              </div>
            </div>
            <ol className="settings-step-list">
              <li>
                Open your mobile carrier or phone-system call forwarding
                settings.
              </li>
              <li>
                Choose conditional forwarding for unanswered, busy, and
                unreachable calls. Avoid unconditional forwarding unless every
                call should go straight to Kyro.
              </li>
              <li>
                Enter the Kyro number shown above as the forwarding destination
                and save the change.
              </li>
              <li>
                If you use iPhone, turn off Live Voicemail so the carrier can
                forward missed calls to Kyro instead of the phone intercepting
                them locally.
              </li>
              <li>
                Place a call from another phone, let your personal phone ring
                out, then confirm the call appears in Kyro activity.
              </li>
            </ol>
            <p className="empty-copy">
              Once the carrier forwards the missed call, Kyro answers with the
              voicemail overflow assistant and records the transcript in
              Assistant activity.
            </p>
          </div>

          <form
            action={disableVoicemailOverflowNumberAction}
            className="setting-card"
          >
            <SettingCardHeading info="This removes the voicemail overflow purpose from the Kyro number. It does not change forwarding rules inside your carrier account.">
              Disconnect overflow routing
            </SettingCardHeading>
            <p className="empty-copy">
              Use this when the number should keep working for normal calls and
              SMS, but should no longer be treated as a voicemail fallback.
            </p>
            <input
              name="phoneNumberId"
              type="hidden"
              value={voicemailNumber?.id ?? ""}
            />
            <div className="settings-footer align-end">
              <SettingsSubmitButton
                className="secondary-button compact"
                disabled={!voicemailNumber}
                pendingLabel="Removing..."
              >
                Remove overflow setup
              </SettingsSubmitButton>
            </div>
          </form>
        </div>
      ) : voiceNumbers.length > 0 ? (
        <form
          action={enableVoicemailOverflowNumberAction}
          className="setting-card voicemail-overflow-setup-card"
        >
          <SettingCardHeading info="Choose which Kyro number your personal phone or carrier should forward unanswered calls to.">
            Choose overflow number
          </SettingCardHeading>
          <p className="empty-copy">
            Your workspace has a voice-capable Kyro number, but voicemail
            overflow is not assigned yet.
          </p>
          <div className="phone-number-choice-list">
            {voiceNumbers.map((number, index) => (
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
                      number.countryCode,
                      number.vapiPhoneNumberId ? "Voice linked" : null,
                    ]
                      .filter(Boolean)
                      .join(" - ")}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="settings-footer compact-settings-footer">
            <span>
              Kyro will mark this number as the missed-call overflow
              destination.
            </span>
            <SettingsSubmitButton pendingLabel="Setting up...">
              Set up voicemail overflow
            </SettingsSubmitButton>
          </div>
        </form>
      ) : (
        <p className="form-alert compact-alert">
          Kyro needs a voice-capable assistant number before voicemail overflow
          can be enabled.{" "}
          <Link href="/settings?section=integrations&panel=phone-sms">
            Get a Kyro number
          </Link>
        </p>
      )}
    </article>
  );
}

export function PronunciationVocabularySettings({
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
        <SettingsSubmitButton pendingLabel="Adding...">
          Add pronunciation
        </SettingsSubmitButton>
      </form>

      <div className="pronunciation-entry-list">
        {visibleEntries.length > 0 ? (
          <>
            {previewEntries.map((entry) => (
              <PronunciationEntryCard entry={entry} key={entry.id} />
            ))}
            {collapsedEntries.length > 0 ? (
              <PronunciationEntryExpander count={collapsedEntries.length}>
                {collapsedEntries.map((entry) => (
                  <PronunciationEntryCard entry={entry} key={entry.id} />
                ))}
              </PronunciationEntryExpander>
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
