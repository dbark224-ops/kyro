"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export type SettingsSection = "communication" | "google" | "usage";

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

  if (section === "communication" || section === "google" || section === "usage") {
    return section;
  }

  return null;
}

export function SettingsShell({
  communication,
  empty,
  google,
  initialSection,
  items,
  usage,
}: Readonly<{
  communication: ReactNode;
  empty: ReactNode;
  google: ReactNode;
  initialSection: SettingsSection | null;
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
      : selectedSection === "google"
        ? google
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
          <span className="pill">{items.length} areas</span>
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
              <span className="pill">{item.status}</span>
            </button>
          ))}
        </div>
      </section>

      {detail}
    </section>
  );
}
