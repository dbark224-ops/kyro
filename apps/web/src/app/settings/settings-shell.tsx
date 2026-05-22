import Link from "next/link";
import type { ReactNode } from "react";

export type SettingsSection =
  | "communication"
  | "general"
  | "integrations"
  | "usage"
  | "voice";

export type SettingsMenuItem = {
  detail: string;
  eyebrow: string;
  href: string;
  section: SettingsSection;
  status: string;
  title: string;
};

export function SettingsShell({
  detail,
  empty,
  items,
  selectedSection,
}: Readonly<{
  detail: ReactNode | null;
  empty: ReactNode;
  items: SettingsMenuItem[];
  selectedSection: SettingsSection | null;
}>) {
  const hasDetail = Boolean(selectedSection && detail);

  return (
    <section
      className={
        hasDetail ? "settings-workspace has-detail" : "settings-workspace"
      }
    >
      <section className="panel settings-list-panel">
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
              prefetch={false}
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

      {hasDetail ? detail : empty}
    </section>
  );
}
