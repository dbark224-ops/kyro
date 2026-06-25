import Link from "next/link";
import { SettingsRoutePrefetcher } from "./settings-route-prefetcher";
import type { ReactNode } from "react";

export type SettingsSection =
  | "general"
  | "integrations"
  | "usage"
  | "voice"
  | "developer";

export type SettingsMenuItem = {
  detail: string;
  eyebrow: string;
  href: string;
  section: SettingsSection;
  title: string;
};

export type SettingsNestedItem = {
  detail: string;
  href: string;
  key: string;
  selected: boolean;
  title: string;
};

export function SettingsShell({
  detail,
  empty,
  items,
  nestedItems,
  selectedSection,
}: Readonly<{
  detail: ReactNode | null;
  empty: ReactNode;
  items: SettingsMenuItem[];
  nestedItems: SettingsNestedItem[];
  selectedSection: SettingsSection | null;
}>) {
  const hasDetail = Boolean(selectedSection && detail);
  const prefetchHrefs = [
    ...items.map((item) => item.href),
    ...nestedItems.map((item) => item.href),
  ];

  return (
    <section
      className={
        hasDetail ? "settings-workspace has-detail" : "settings-workspace"
      }
    >
      <SettingsRoutePrefetcher hrefs={prefetchHrefs} />
      <section className="panel settings-list-panel settings-primary-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Workspace controls</h2>
          </div>
        </div>

        <div className="settings-menu-list">
          {items.map((item) => (
            <Link
              aria-current={
                selectedSection === item.section ? "page" : undefined
              }
              className={
                selectedSection === item.section
                  ? "settings-menu-row active"
                  : "settings-menu-row"
              }
              href={item.href}
              key={item.section}
              >
                <div className="settings-menu-main">
                  <p className="eyebrow">{item.eyebrow}</p>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </Link>
          ))}
        </div>
      </section>

      <section className="panel settings-list-panel settings-nested-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Section</p>
            <h2>Choose a setting</h2>
          </div>
        </div>

        <div className="settings-menu-list settings-nested-list">
          {nestedItems.length > 0 ? (
            nestedItems.map((item) => (
              <Link
                aria-current={item.selected ? "page" : undefined}
                className={
                  item.selected
                    ? "settings-menu-row settings-nested-row active"
                    : "settings-menu-row settings-nested-row"
                }
                href={item.href}
                key={item.key}
              >
                <div className="settings-menu-main">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </Link>
            ))
          ) : (
            <p className="empty-copy">
              Pick a settings area to see its controls.
            </p>
          )}
        </div>
      </section>

      {hasDetail ? detail : empty}
    </section>
  );
}
