import notificationStyles from "../notification-settings.module.css";
import {
  CALENDAR_DAILY_DIGEST_TIMINGS,
  CALENDAR_SMS_REMINDER_MINUTES,
  type NotificationSettings,
} from "../../../lib/notifications/settings";
import {
  SettingsSubmitButton,
} from "../settings-submit-button";
import {
  type WorkspaceGeneralSettings,
} from "../../../lib/workspace/general-settings";
import {
  updateNotificationSettingsAction,
} from "../actions";
/**
 * The Notifications section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function calendarNotificationFallbackRecipient(
  settings: WorkspaceGeneralSettings,
) {
  const contacts = settings.businessProfile.workplaceContacts;
  const primary = contacts.find(
    (contact) => contact.primaryEscalationContact && contact.phoneNumber,
  );
  const firstWithPhone = contacts.find((contact) => contact.phoneNumber);

  return (
    primary?.phoneNumber ||
    firstWithPhone?.phoneNumber ||
    settings.businessProfile.publicPhoneNumber ||
    ""
  );
}

export function notificationDigestTimingLabel(
  timing: (typeof CALENDAR_DAILY_DIGEST_TIMINGS)[number],
) {
  return timing === "night_before" ? "Night before" : "Morning of";
}

export function NotificationSettingsDetail({
  generalSettings,
  settings,
}: Readonly<{
  generalSettings: WorkspaceGeneralSettings;
  settings: NotificationSettings;
}>) {
  const fallbackRecipient =
    calendarNotificationFallbackRecipient(generalSettings);
  const fallbackCopy = fallbackRecipient
    ? `Leave blank to use ${fallbackRecipient}.`
    : "Add a recipient number or a workplace contact phone number before turning this on.";
  const notificationsEnabled =
    settings.calendarSmsRemindersEnabled || settings.calendarDailyDigestEnabled;

  return (
    <form
      action={updateNotificationSettingsAction}
      className={notificationStyles.form}
    >
      <div className={notificationStyles.intro}>
        <div>
          <p className="eyebrow">SMS notifications</p>
          <h3>Calendar alerts</h3>
          <p>Receive event reminders and a compact summary of the day ahead.</p>
        </div>
        <span className={notificationsEnabled ? "pill success" : "pill"}>
          {notificationsEnabled ? "On" : "Off"}
        </span>
      </div>

      <div className={notificationStyles.preferenceList}>
        <section className={notificationStyles.preferenceRow}>
          <label className={notificationStyles.toggleLabel}>
            <input
              className={notificationStyles.toggleInput}
              defaultChecked={settings.calendarSmsRemindersEnabled}
              name="calendarSmsRemindersEnabled"
              type="checkbox"
            />
            <span
              aria-hidden="true"
              className={notificationStyles.toggleTrack}
            />
            <span className={notificationStyles.preferenceCopy}>
              <strong>Event reminders</strong>
              <span>Send an SMS before each calendar event.</span>
            </span>
          </label>

          <label className={notificationStyles.field}>
            Reminder time
            <select
              defaultValue={settings.calendarSmsReminderMinutes}
              name="calendarSmsReminderMinutes"
            >
              {CALENDAR_SMS_REMINDER_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes < 60
                    ? `${minutes} minutes before`
                    : `${minutes / 60} hour${minutes === 60 ? "" : "s"} before`}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className={notificationStyles.preferenceRow}>
          <label className={notificationStyles.toggleLabel}>
            <input
              className={notificationStyles.toggleInput}
              defaultChecked={settings.calendarDailyDigestEnabled}
              name="calendarDailyDigestEnabled"
              type="checkbox"
            />
            <span
              aria-hidden="true"
              className={notificationStyles.toggleTrack}
            />
            <span className={notificationStyles.preferenceCopy}>
              <strong>Daily calendar summary</strong>
              <span>Send one SMS with the next day&apos;s events.</span>
            </span>
          </label>

          <div className={notificationStyles.reportFields}>
            <label className={notificationStyles.field}>
              Send
              <select
                defaultValue={settings.calendarDailyDigestTiming}
                name="calendarDailyDigestTiming"
              >
                {CALENDAR_DAILY_DIGEST_TIMINGS.map((timing) => (
                  <option key={timing} value={timing}>
                    {notificationDigestTimingLabel(timing)}
                  </option>
                ))}
              </select>
            </label>

            <label className={notificationStyles.field}>
              Time
              <input
                defaultValue={settings.calendarDailyDigestTime}
                name="calendarDailyDigestTime"
                type="time"
              />
            </label>
          </div>
        </section>
      </div>

      <section className={notificationStyles.deliveryRow}>
        <label className={notificationStyles.field}>
          SMS recipient
          <input
            defaultValue={settings.calendarSmsRecipientPhone}
            name="calendarSmsRecipientPhone"
            placeholder={fallbackRecipient || "+1 555 123 4567"}
            type="tel"
          />
          <span>{fallbackCopy}</span>
        </label>
        <div className={notificationStyles.timeZone}>
          <span>Workspace time zone</span>
          <strong>{generalSettings.timeZone || "UTC"}</strong>
        </div>
      </section>

      <div className={notificationStyles.footer}>
        <SettingsSubmitButton>Save</SettingsSubmitButton>
      </div>
    </form>
  );
}
