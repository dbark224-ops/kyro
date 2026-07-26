import {
  AddressAutocompleteField,
} from "../../components/address-autocomplete-field";
import {
  BrandColorPicker,
} from "../brand-color-picker";
import {
  BrandingAutosavePanel,
} from "../branding-autosave-panel";
import {
  BusinessAvailabilityEditor,
} from "../business-availability-editor";
import {
  DISPLAY_CURRENCIES,
} from "../../../lib/billing/display-currency";
import {
  EmailSignatureAutosavePanel,
} from "../email-signature-autosave-panel";
import {
  EmailSignatureEditor,
} from "../email-signature-editor";
import {
  EmergencyWindowEditor,
} from "../emergency-window-editor";
import {
  EscalationSettingsEditor,
} from "../escalation-settings-editor";
import {
  OPERATING_COUNTRY_OPTIONS,
  operatingCountryForPhoneRegion,
} from "../../../lib/workspace/operating-countries";
import {
  PHONE_REGION_OPTIONS,
} from "../../../lib/crm/identity";
import {
  SettingsSubmitButton,
} from "../settings-submit-button";
import {
  SmartPrefetchLink,
} from "../../components/smart-prefetch-link";
import {
  TagInputField,
} from "../tag-input-field";
import {
  WorkplaceContactsEditor,
} from "../workplace-contacts-editor";
import {
  aiAssistantSignatureForEditor,
  formatLabel,
  SettingCardHeading,
} from "../shared";
import {
  resendEmailVerificationAction,
  updateGeneralSettingsAction,
} from "../actions";
import {
  settingsPanelHref,
} from "../settings-navigation";
import {
  type CommunicationSettings,
} from "../../../lib/communication/settings";
import {
  type WorkspaceGeneralSettings,
} from "../../../lib/workspace/general-settings";
import {
  type WorkspacePhoneNumberPoolRow,
} from "../../../lib/voice/phone-number-pool";
/**
 * The general business profile section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export const COMMON_WORKSPACE_TIME_ZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Hobart",
  "Pacific/Auckland",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
] as const;

export function formatTimeZoneOffset(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return (
      parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
    ).replace(/^GMT$/, "GMT+0");
  } catch {
    return "GMT";
  }
}

export function workspaceTimeZoneOptions(currentTimeZone: string) {
  const options = new Set<string>(COMMON_WORKSPACE_TIME_ZONES);
  options.add(currentTimeZone);

  return Array.from(options).map((timeZone) => ({
    label: `${timeZone} (${formatTimeZoneOffset(timeZone)})`,
    value: timeZone,
  }));
}

export function phoneCapabilitiesLabel(number: WorkspacePhoneNumberPoolRow) {
  const capabilities = [
    number.capabilities.sms ? "SMS" : null,
    number.capabilities.voice ? "Voice" : null,
    number.capabilities.mms ? "MMS" : null,
  ].filter(Boolean);

  return capabilities.length ? capabilities.join(" + ") : "Phone number";
}

export function BusinessLogoEditor({
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
      <input
        name="businessProfileLogoWidthPx"
        type="hidden"
        value={profile.logoWidthPx}
      />
      <div>
        <p className="eyebrow">Business logo</p>
        <p>
          Used for business-facing documents, reports, and signatures when a
          logo is available.
        </p>
      </div>

      <div className="settings-grid business-profile-grid">
        <label className="setting-card">
          <SettingCardHeading info="Upload a compact logo, up to 512 KB. If no logo is saved, Kyro falls back to the business name.">
            Logo file
          </SettingCardHeading>
          <input accept="image/*" name="businessProfileLogoFile" type="file" />
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
      </div>

      <div className="signature-preview-card email-signature-preview-card">
        <strong>Preview</strong>
        <div className="signature-preview email-signature-preview">
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

export function EmailVerificationSettingsNotice() {
  return (
    <section className="email-verification-notice">
      <div>
        <p className="eyebrow">Email verification required</p>
        <h3>Check your inbox to unlock these settings</h3>
      </div>
      <SettingsSubmitButton
        className="secondary-button compact"
        formAction={resendEmailVerificationAction}
        pendingLabel="Sending..."
      >
        Resend verification email
      </SettingsSubmitButton>
    </section>
  );
}

export function mergedServiceAreaValue(
  profile: WorkspaceGeneralSettings["businessProfile"],
) {
  const seen = new Set<string>();

  return [profile.serviceArea, profile.serviceSuburbs, profile.servicePostcodes]
    .flatMap((value) => (value ?? "").split(/[\n,]+/))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .join(", ");
}

export function GeneralSettingsDetail({
  activePanel,
  communicationSettings,
  emailVerified,
  operationalPhoneNumbers,
  settings,
  userEmail,
  userFirstName,
  userLastName,
  workspaceName,
}: Readonly<{
  activePanel?: string | null;
  communicationSettings: CommunicationSettings | null;
  emailVerified: boolean;
  operationalPhoneNumbers: WorkspacePhoneNumberPoolRow[];
  settings: WorkspaceGeneralSettings;
  userEmail: string;
  userFirstName: string;
  userLastName: string;
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
  const activeBusinessPanel =
    activePanel === "public-details" ||
    activePanel === "availability" ||
    activePanel === "branding-logo" ||
    activePanel === "email-signature" ||
    activePanel === "emergency-work" ||
    activePanel === "urgent-escalation" ||
    activePanel === "workplace-contacts"
      ? activePanel
      : "business";
  const hiddenPanelStyle = { display: "none" } as const;
  const visibleWhen = (condition: boolean) =>
    condition ? undefined : hiddenPanelStyle;
  const showCoreProfile = activeBusinessPanel === "business";
  const showPublicDetails = activeBusinessPanel === "public-details";
  const showAvailability = activeBusinessPanel === "availability";
  const showCorePanel =
    showCoreProfile || showPublicDetails || showAvailability;
  const emailVerificationPending = !emailVerified;
  const serviceAreaValue = mergedServiceAreaValue(profile);
  const timeZoneOptions = workspaceTimeZoneOptions(settings.timeZone);

  return (
    <form
      action={updateGeneralSettingsAction}
      className="settings-form"
      encType="multipart/form-data"
    >
      <input name="settingsPanel" type="hidden" value={activeBusinessPanel} />
      {emailVerificationPending ? <EmailVerificationSettingsNotice /> : null}
      <fieldset
        className={
          emailVerificationPending
            ? "settings-verification-gated is-disabled"
            : "settings-verification-gated"
        }
        disabled={emailVerificationPending}
      >
        <section
          className="business-profile-section-panel"
          id="business-profile-core"
          style={visibleWhen(showCorePanel)}
        >
          <div className="settings-grid business-profile-grid">
            <label
              className="setting-card"
              style={visibleWhen(showCoreProfile)}
            >
              <SettingCardHeading info="Shown internally and used as the default business name in generated documents and reports.">
                Business name
              </SettingCardHeading>
              <input
                defaultValue={profile.businessName || workspaceName}
                name="businessName"
                placeholder="WFA Plumbing"
              />
            </label>

            <label
              className="setting-card"
              style={visibleWhen(showCoreProfile)}
            >
              <SettingCardHeading info="The account user Kyro is speaking to in the Voice assistant. This is used for greetings such as first-name voice intros.">
                Account user first name
              </SettingCardHeading>
              <input
                defaultValue={userFirstName}
                name="accountUserFirstName"
                placeholder="David"
              />
            </label>

            <label
              className="setting-card"
              style={visibleWhen(showCoreProfile)}
            >
              <SettingCardHeading info="Used with first name to keep the logged-in Kyro user profile accurate across voice greetings and internal context.">
                Account user last name
              </SettingCardHeading>
              <input
                defaultValue={userLastName}
                name="accountUserLastName"
                placeholder="Barker"
              />
            </label>

            <label
              className="setting-card"
              style={visibleWhen(showCoreProfile)}
            >
              <SettingCardHeading info="The trade or service category Kyro should assume for tone, context, and future workflows.">
                Industry
              </SettingCardHeading>
              <input
                defaultValue={profile.industry}
                name="businessIndustry"
                placeholder="Plumbing, electrical, building, landscaping..."
              />
            </label>

            <label
              className="setting-card"
              style={visibleWhen(showCoreProfile)}
            >
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

            <div
              className="setting-card service-area-tag-card"
              style={visibleWhen(showCoreProfile)}
            >
              <SettingCardHeading info="Areas, suburbs, towns, postcodes, or plain-English notes Kyro can use when qualifying jobs. Press Enter after each entry.">
                Service area
              </SettingCardHeading>
              <TagInputField
                ariaLabel="Service area"
                autoSubmit={showCoreProfile}
                autoSaveEndpoint="/api/settings/business-profile-tags"
                autocompleteType="regions"
                defaultValue={serviceAreaValue}
                name="businessServiceArea"
                placeholder="Brisbane southside, Logan, Ipswich, 4121..."
              />
            </div>

            <label
              className="setting-card setting-card-compact-input"
              style={visibleWhen(showPublicDetails)}
            >
              <SettingCardHeading
                info="The public email address shown on reports, documents, and business-facing material."
                infoPlacement="right"
              >
                Public email
              </SettingCardHeading>
              <input
                defaultValue={profile.publicEmail || userEmail}
                name="businessPublicEmail"
                placeholder="hello@example.com"
                type="email"
              />
            </label>

            <label
              className="setting-card setting-card-compact-input"
              style={visibleWhen(showPublicDetails)}
            >
              <SettingCardHeading
                info={
                  <>
                    This is the phone number customers see on reports,
                    documents, and business-facing material. It can be different
                    from the Kyro assistant number.
                  </>
                }
              >
                Public phone number
              </SettingCardHeading>
              <input
                defaultValue={defaultPublicPhone}
                name="businessPublicPhoneNumber"
                placeholder="+61 7 4517 4330"
                type="tel"
              />
            </label>

            <div
              className="setting-card business-address-card"
              style={visibleWhen(showPublicDetails)}
            >
              <SettingCardHeading info="The business base address. Customer job addresses are still stored separately on contacts and leads.">
                Business address
              </SettingCardHeading>
              <AddressAutocompleteField
                className="business-address-autocomplete"
                defaultValue={profile.businessAddress}
                label=""
                name="businessAddress"
                placeholder="Start typing a business address..."
              />
            </div>

            <div
              className="availability-editor-wrapper"
              style={visibleWhen(showAvailability)}
            >
              <BusinessAvailabilityEditor
                contactHoursSchedule={profile.contactHoursSchedule}
                fieldStaffContactIds={profile.fieldStaffContactIds}
                staffCount={profile.staffCount}
                workplaceContacts={profile.workplaceContacts}
                workingHoursSchedule={profile.workingHoursSchedule}
              />
            </div>
          </div>

          <section
            className="signature-editor public-assistant-number-card"
            style={visibleWhen(showPublicDetails)}
          >
            <div className="public-assistant-number-content">
              <div className="public-assistant-number-main">
                <p className="eyebrow">Assistant phone number</p>
                {operationalPhoneNumbers.length ? (
                  <div className="public-assistant-number-list">
                    {operationalPhoneNumbers.map((number) => (
                      <div key={number.id}>
                        <strong>{number.phoneNumber}</strong>
                        <div className="public-assistant-number-meta">
                          <span>{phoneCapabilitiesLabel(number)}</span>
                          <span
                            className={`settings-status-pill ${
                              number.status === "active" ? "ready" : "warning"
                            }`}
                          >
                            {formatLabel(number.status)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-copy">
                    No assistant phone number is assigned yet.
                  </p>
                )}
              </div>
              <SmartPrefetchLink
                className="secondary-button phone-number-route-button"
                href={settingsPanelHref("integrations", "phone-sms")}
              >
                {operationalPhoneNumbers.length
                  ? "Manage Kyro number"
                  : "Get a Kyro number"}
              </SmartPrefetchLink>
            </div>
          </section>

          <div className="settings-grid" style={visibleWhen(showCoreProfile)}>
            <label className="setting-card">
              <SettingCardHeading
                info={
                  <>
                    Used wherever Kyro needs local time, including quiet-hours
                    email polling. Use an IANA timezone such as
                    Australia/Brisbane, America/Denver, or UTC.
                  </>
                }
              >
                Workspace timezone
              </SettingCardHeading>
              <select defaultValue={settings.timeZone} name="workspaceTimeZone">
                {timeZoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-card">
              <SettingCardHeading
                info={
                  <>
                    Controls how Kyro displays internal money values such as
                    usage charges and billing exports. Stored ledger values stay
                    in USD for clean accounting; this is the display currency
                    users see in the app.
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
                    country code. Numbers that already include a country code
                    are kept international.
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
        </section>

        <section
          className="business-profile-section-panel"
          id="business-profile-branding"
          style={visibleWhen(activeBusinessPanel === "branding-logo")}
        >
          <section className="integration-choice-panel">
            <div>
              <p className="eyebrow">Branding and logo</p>
              <h3>Visual identity</h3>
              <p>
                Logo, colours, and style notes used by reports, documents, and
                generated customer-facing assets.
              </p>
            </div>
          </section>

          <BrandingAutosavePanel>
            <BusinessLogoEditor profile={profile} />

            <div className="settings-grid">
              <BrandColorPicker
                autosave
                defaultValue={profile.brandPrimaryColor}
                info="Primary brand colour for documents, previews, and future generated assets."
                label="Primary colour"
                name="businessBrandPrimaryColor"
              />

              <BrandColorPicker
                autosave
                defaultValue={profile.brandAccentColor}
                info="Accent colour for highlights and secondary visual marks."
                label="Accent colour"
                name="businessBrandAccentColor"
              />

              <label className="setting-card settings-textarea">
                <SettingCardHeading
                  info="Short notes about brand personality, wording style, visual feel, or anything Kyro should respect."
                  infoPlacement="right"
                >
                  Brand style notes
                </SettingCardHeading>
                <textarea
                  defaultValue={profile.brandStyle}
                  name="businessBrandStyle"
                  placeholder="Clean, practical, friendly, no corporate fluff..."
                />
              </label>
            </div>
          </BrandingAutosavePanel>
        </section>

        {activeBusinessPanel === "email-signature" && communicationSettings ? (
          <section
            className="business-profile-section-panel"
            id="business-profile-signature"
          >
            <section className="integration-choice-panel">
              <div>
                <p className="eyebrow">Email signature</p>
                <h3>Default customer email signature</h3>
                <p>
                  The signature Kyro can use when drafting or sending business
                  emails.
                </p>
              </div>
            </section>

            <EmailSignatureAutosavePanel>
              <input
                name="businessProfileEmailSignatureSubmitted"
                type="hidden"
                value="on"
              />
              <EmailSignatureEditor
                autosave
                description="Used for manual replies and business-facing email defaults."
                namePrefix="manualSignature"
                signature={communicationSettings.manualSignature}
                title="Human email signature"
              />

              <fieldset className="settings-fieldset compact-checkbox-fieldset">
                <legend>AI email signature</legend>
                <label className="compact-checkbox-row">
                  <input
                    defaultChecked={
                      communicationSettings.useSeparateAiSignature
                    }
                    name="useSeparateAiSignature"
                    type="checkbox"
                  />
                  <span>Use a different signature for AI-generated emails</span>
                </label>
              </fieldset>

              <EmailSignatureEditor
                autosave
                description="Used when Kyro drafts or sends an AI-generated customer reply."
                namePrefix="aiGeneratedSignature"
                signature={aiAssistantSignatureForEditor({
                  communicationSettings,
                  defaultPublicPhone,
                  profile,
                  workspaceName,
                })}
                title="AI email signature"
              />
            </EmailSignatureAutosavePanel>
          </section>
        ) : null}

        <section
          className="business-profile-section-panel"
          id="business-profile-emergency"
          style={visibleWhen(activeBusinessPanel === "emergency-work")}
        >
          <section className="integration-choice-panel">
            <div>
              <p className="eyebrow">Emergency work</p>
              <h3>After-hours availability and handling</h3>
              <p>
                Define when Kyro should treat work as urgent or after-hours, and
                what rate or handling notes to reference.
              </p>
            </div>
          </section>

          {activeBusinessPanel === "emergency-work" ||
          profile.emergencyJobsEnabled ? (
            <input
              name="businessEmergencyJobsEnabled"
              type="hidden"
              value="on"
            />
          ) : null}
          <input
            name="businessEmergencyAvailabilityMode"
            type="hidden"
            value={
              activeBusinessPanel === "emergency-work"
                ? "specified"
                : profile.emergencyAvailabilityMode
            }
          />

          <div className="settings-grid emergency-settings-grid">
            <label className="setting-card">
              <SettingCardHeading info="Optional rate text Kyro can reference without inventing prices.">
                After-hours rate
              </SettingCardHeading>
              <input
                defaultValue={profile.emergencyAfterHoursRate}
                name="businessEmergencyAfterHoursRate"
                placeholder="$250 call-out, double time, POA..."
              />
            </label>
          </div>

          <EmergencyWindowEditor
            active={activeBusinessPanel === "emergency-work"}
            daysValue={profile.emergencyDays}
            endValue={profile.emergencyEndTime}
            startValue={profile.emergencyStartTime}
          />

          <label className="settings-textarea setting-card">
            <SettingCardHeading info="Instructions Kyro should follow when an urgent or after-hours request comes in.">
              Handling notes
            </SettingCardHeading>
            <textarea
              defaultValue={profile.emergencyRateNotes}
              name="businessEmergencyRateNotes"
              placeholder="Ask for safety details first. Confirm call-out rates before promising attendance."
            />
          </label>
        </section>

        <section
          className="business-profile-section-panel"
          id="business-profile-workplace-contacts"
          style={visibleWhen(activeBusinessPanel === "workplace-contacts")}
        >
          <WorkplaceContactsEditor
            businessWorkingHoursSchedule={profile.workingHoursSchedule}
            contacts={profile.workplaceContacts}
            defaultEmail={userEmail}
            defaultPhoneRegion={settings.defaultPhoneRegion}
            description="These workplace contacts are used to recognize internal callers and decide who Kyro can alert when calls need a human."
            title="Workplace contacts"
          />
        </section>

        <section
          className="business-profile-section-panel"
          id="business-profile-urgent-escalation"
          style={visibleWhen(activeBusinessPanel === "urgent-escalation")}
        >
          <EscalationSettingsEditor
            contacts={profile.workplaceContacts}
            escalation={profile.urgentEscalation}
          />
        </section>

        {activeBusinessPanel === "email-signature" ? null : (
          <div className="settings-footer">
            <SettingsSubmitButton>Save</SettingsSubmitButton>
          </div>
        )}
      </fieldset>
    </form>
  );
}
