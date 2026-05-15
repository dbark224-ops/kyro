"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export type SettingsSection = "communication" | "integrations" | "usage";

export type SettingsMenuItem = {
  detail: string;
  eyebrow: string;
  href: string;
  section: SettingsSection;
  status: string;
  title: string;
};

function sectionFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");

  if (section === "google" || section === "microsoft" || section === "integrations") {
    return "integrations";
  }

  if (section === "communication" || section === "usage") {
    return section;
  }

  return null;
}

export function SettingsShell({
  communication,
  empty,
  initialSection,
  integrations,
  items,
  usage,
}: Readonly<{
  communication: ReactNode;
  empty: ReactNode;
  initialSection: SettingsSection | null;
  integrations: ReactNode;
  items: SettingsMenuItem[];
  usage: ReactNode;
}>) {
  const [selectedSection, setSelectedSection] = useState<SettingsSection | null>(
    initialSection,
  );

  useEffect(() => {
    const handlePopState = () => setSelectedSection(sectionFromLocation());

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function openSection(item: SettingsMenuItem) {
    setSelectedSection(item.section);
    window.history.pushState(null, "", item.href);
  }

  const detail =
    selectedSection === "communication"
      ? communication
      : selectedSection === "integrations"
        ? integrations
        : selectedSection === "usage"
          ? usage
          : empty;

  return (
    <section
      className={
        selectedSection ? "settings-workspace has-detail" : "settings-workspace"
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
            <button
              className={
                selectedSection === item.section
                  ? "settings-menu-row active"
                  : "settings-menu-row"
              }
              key={item.section}
              onClick={() => openSection(item)}
              type="button"
            >
              <div className="settings-menu-main">
                <p className="eyebrow">{item.eyebrow}</p>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {detail}
    </section>
  );
}
