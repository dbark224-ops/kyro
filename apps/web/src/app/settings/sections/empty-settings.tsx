/**
 * The Empty state section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function EmptySettingsDetail() {
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
