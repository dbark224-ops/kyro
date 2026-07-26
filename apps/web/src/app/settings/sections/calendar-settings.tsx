import Link from "next/link";
import {
  CALENDAR_EVENT_TYPES,
  CALENDAR_SYNC_PROVIDERS,
  CALENDAR_VIEWS,
  type CalendarSettings,
} from "../../../lib/calendar/settings";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  type GoogleIntegrationOverview,
} from "../../../lib/integrations/google";
import {
  MICROSOFT_CALENDARS_READ_WRITE_SCOPE,
  type MicrosoftIntegrationOverview,
} from "../../../lib/integrations/microsoft";
import { updateCalendarSettingsAction } from "../actions";
import { settingsPanelHref } from "../settings-navigation";
import { SettingsSubmitButton } from "../settings-submit-button";
import { formatLabel, googlePermissionActive } from "../shared";
/**
 * The Calendar section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function microsoftPermissionActive(
  overview: MicrosoftIntegrationOverview,
  scope: string,
) {
  const requested = scope.toLowerCase();

  return overview.connections.some(
    (connection) =>
      connection.status === "connected" &&
      connection.scopes.some((connectionScope) => {
        const normalized = connectionScope.toLowerCase();

        return normalized === requested || normalized.endsWith(`/${requested}`);
      }),
  );
}

export function CalendarProviderStatus({
  googleOverview,
  microsoftOverview,
}: Readonly<{
  googleOverview: GoogleIntegrationOverview | null;
  microsoftOverview: MicrosoftIntegrationOverview | null;
}>) {
  const googleReady = googleOverview
    ? googlePermissionActive(googleOverview, GOOGLE_CALENDAR_EVENTS_SCOPE)
    : false;
  const microsoftReady = microsoftOverview
    ? microsoftPermissionActive(
        microsoftOverview,
        MICROSOFT_CALENDARS_READ_WRITE_SCOPE,
      )
    : false;

  return (
    <div className="settings-grid">
      <article className="setting-card">
        <div className="setting-card-heading">
          <strong>Google Calendar</strong>
          <span className={googleReady ? "pill success" : "pill warning"}>
            {googleReady ? "Ready" : "Reconnect needed"}
          </span>
        </div>
        <span>
          {googleReady
            ? "Kyro can create and update events on the connected Google calendar."
            : "Connect or reconnect Google with Calendar permission in Email accounts."}
        </span>
        <Link
          className="secondary-button compact link-button"
          href={settingsPanelHref("integrations", "email-accounts")}
        >
          Email accounts
        </Link>
      </article>

      <article className="setting-card">
        <div className="setting-card-heading">
          <strong>Outlook calendar</strong>
          <span className={microsoftReady ? "pill success" : "pill warning"}>
            {microsoftReady ? "Ready" : "Reconnect needed"}
          </span>
        </div>
        <span>
          {microsoftReady
            ? "Kyro can create and update events on the connected Outlook calendar."
            : "Connect or reconnect Outlook with Calendar permission in Email accounts."}
        </span>
        <Link
          className="secondary-button compact link-button"
          href={settingsPanelHref("integrations", "email-accounts")}
        >
          Email accounts
        </Link>
      </article>
    </div>
  );
}

export function CalendarSettingsDetail({
  activePanel,
  googleOverview,
  microsoftOverview,
  settings,
  timeZone,
}: Readonly<{
  activePanel: string;
  googleOverview: GoogleIntegrationOverview | null;
  microsoftOverview: MicrosoftIntegrationOverview | null;
  settings: CalendarSettings;
  timeZone: string;
}>) {
  const showDefaults = activePanel === "calendar-defaults";

  return (
    <form action={updateCalendarSettingsAction}>
      <input
        name="settingsPanel"
        type="hidden"
        value={showDefaults ? "calendar-defaults" : "calendar-sync"}
      />

      {showDefaults ? (
        <>
          <input
            name="calendarSyncProvider"
            type="hidden"
            value={settings.syncProvider}
          />
          <input
            name="calendarExternalCalendarId"
            type="hidden"
            value={settings.externalCalendarId}
          />
          <input
            name="calendarSyncCreatedEventsToExternal"
            type="hidden"
            value={settings.syncCreatedEventsToExternal ? "on" : "off"}
          />
          <input
            name="calendarSyncUpdatedEventsToExternal"
            type="hidden"
            value={settings.syncUpdatedEventsToExternal ? "on" : "off"}
          />
          <input
            name="calendarSyncDeletedEventsToExternal"
            type="hidden"
            value={settings.syncDeletedEventsToExternal ? "on" : "off"}
          />
          <input
            name="calendarImportExternalUpdates"
            type="hidden"
            value={settings.importExternalUpdates ? "on" : "off"}
          />
          <div className="settings-grid">
            <label className="setting-card">
              Default view
              <select
                defaultValue={settings.defaultView}
                name="calendarDefaultView"
              >
                {CALENDAR_VIEWS.map((view) => (
                  <option key={view} value={view}>
                    {formatLabel(view)}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-card">
              Default event type
              <select
                defaultValue={settings.defaultEventType}
                name="calendarDefaultEventType"
              >
                {CALENDAR_EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {formatLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-card">
              Default duration (mins)
              <input
                defaultValue={settings.defaultDurationMinutes}
                min={5}
                name="calendarDefaultDurationMinutes"
                step={5}
                type="number"
              />
            </label>
            <label className="setting-card">
              Buffer before (mins)
              <input
                defaultValue={settings.bufferMinutesBefore}
                min={0}
                name="calendarBufferMinutesBefore"
                step={5}
                type="number"
              />
            </label>
            <label className="setting-card">
              Buffer after (mins)
              <input
                defaultValue={settings.bufferMinutesAfter}
                min={0}
                name="calendarBufferMinutesAfter"
                step={5}
                type="number"
              />
            </label>
            <article className="setting-card">
              <strong>Workspace timezone</strong>
              <span>{timeZone}</span>
            </article>
          </div>
        </>
      ) : (
        <>
          <input
            name="calendarDefaultView"
            type="hidden"
            value={settings.defaultView}
          />
          <input
            name="calendarDefaultEventType"
            type="hidden"
            value={settings.defaultEventType}
          />
          <input
            name="calendarDefaultDurationMinutes"
            type="hidden"
            value={settings.defaultDurationMinutes}
          />
          <input
            name="calendarBufferMinutesBefore"
            type="hidden"
            value={settings.bufferMinutesBefore}
          />
          <input
            name="calendarBufferMinutesAfter"
            type="hidden"
            value={settings.bufferMinutesAfter}
          />
          <CalendarProviderStatus
            googleOverview={googleOverview}
            microsoftOverview={microsoftOverview}
          />
          <div className="settings-grid">
            <label className="setting-card">
              Sync provider
              <select
                defaultValue={settings.syncProvider}
                name="calendarSyncProvider"
              >
                {CALENDAR_SYNC_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider === "auto"
                      ? "Auto select connected calendar"
                      : formatLabel(provider)}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-card">
              External calendar ID
              <input
                defaultValue={settings.externalCalendarId}
                name="calendarExternalCalendarId"
                placeholder="primary"
                type="text"
              />
            </label>
            <label className="compact-checkbox-row setting-card">
              <input
                defaultChecked={settings.syncCreatedEventsToExternal}
                name="calendarSyncCreatedEventsToExternal"
                type="checkbox"
              />
              <span>Create events in Google/Outlook</span>
            </label>
            <label className="compact-checkbox-row setting-card">
              <input
                defaultChecked={settings.syncUpdatedEventsToExternal}
                name="calendarSyncUpdatedEventsToExternal"
                type="checkbox"
              />
              <span>Update Google/Outlook when Kyro events change</span>
            </label>
            <label className="compact-checkbox-row setting-card">
              <input
                defaultChecked={settings.syncDeletedEventsToExternal}
                name="calendarSyncDeletedEventsToExternal"
                type="checkbox"
              />
              <span>
                Delete Google/Outlook events when Kyro events are deleted
              </span>
            </label>
            <label className="compact-checkbox-row setting-card">
              <input
                defaultChecked={settings.importExternalUpdates}
                name="calendarImportExternalUpdates"
                type="checkbox"
              />
              <span>Import provider updates into Kyro when sync runs</span>
            </label>
          </div>
        </>
      )}

      <div className="settings-footer compact-settings-footer">
        <span>
          Kyro calendar remains the scheduling record; connected calendars
          mirror it.
        </span>
        <SettingsSubmitButton>Save</SettingsSubmitButton>
      </div>
    </form>
  );
}
