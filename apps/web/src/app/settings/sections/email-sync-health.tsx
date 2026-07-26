import Link from "next/link";
import {
  SmartPrefetchLink,
} from "../../components/smart-prefetch-link";
import {
  connectionName,
  connectionNeedsReconnect,
  type EmailProviderConnection,
  formatDate,
  formatTimeOfDay,
  hasRequiredReadScope,
  missingReadScope,
  type ProviderConnection,
  scopeLabel,
} from "../shared";
import {
  settingsPanelHref,
} from "../settings-navigation";
import {
  type InboundEmailSettings,
} from "../../../lib/integrations/inbound-email-settings";
/**
 * The email sync health section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function providerConnectedAccountsAnchor(
  provider: EmailProviderConnection["provider"],
) {
  return provider === "google"
    ? "google-connected-email-accounts"
    : "microsoft-connected-email-accounts";
}

export function providerEmailSettingsHref(
  provider: EmailProviderConnection["provider"],
) {
  return `/settings?section=integrations&panel=email-accounts#${providerConnectedAccountsAnchor(provider)}`;
}

export function latestTimestamp(
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

export function minutesUntilNextSync(
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

export function timePartsForZone(date: Date, timeZone: string) {
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

export function minuteOfDay(value: string) {
  const [hour, minute] = value.split(":").map(Number);

  return hour * 60 + minute;
}

export function quietHoursActiveNow(settings: InboundEmailSettings) {
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

export function nextSyncLabel({
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

export function syncHealthStatus({
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

export function EmailSyncHealthPanel({
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
        {connected.length === 0 ? (
          <div className="email-sync-health-actions">
            <SmartPrefetchLink
              className="primary-button compact link-button"
              href={settingsPanelHref("integrations", "email-accounts")}
            >
              Set up email
            </SmartPrefetchLink>
          </div>
        ) : null}
      </div>

      <div className="email-sync-status-grid">
        <article>
          <span>Last successful sync</span>
          <strong>
            {lastSyncAt ? formatDate(lastSyncAt, settings.timeZone) : "Never"}
          </strong>
        </article>
        <article>
          <span>Last check attempt</span>
          <strong>
            {lastCheckedAt
              ? formatDate(lastCheckedAt, settings.timeZone)
              : "Not yet"}
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
                    href={providerEmailSettingsHref(connection.provider)}
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
