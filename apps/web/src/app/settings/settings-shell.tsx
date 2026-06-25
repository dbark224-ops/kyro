"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SettingsRoutePrefetcher } from "./settings-route-prefetcher";
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const hasDetail = Boolean(selectedSection && detail);
  const prefetchHrefs = [
    ...items.map((item) => item.href),
    ...nestedItems.map((item) => item.href),
  ];
  const currentHref = useMemo(() => {
    const query = searchParams.toString();

    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const detailIsLoading = Boolean(pendingHref && pendingHref !== currentHref);

  useEffect(() => {
    setPendingHref(null);
  }, [currentHref]);

  function markRoutePending(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      href === currentHref
    ) {
      return;
    }

    setPendingHref(href);
  }

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
              onClick={(event) => markRoutePending(event, item.href)}
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
                onClick={(event) => markRoutePending(event, item.href)}
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

      <div
        aria-busy={detailIsLoading}
        className={
          detailIsLoading
            ? "settings-detail-transition is-loading"
            : "settings-detail-transition"
        }
      >
        {hasDetail ? detail : empty}
        {detailIsLoading ? (
          <div className="settings-detail-loading-overlay" aria-live="polite">
            <span
              className="settings-detail-loading-spinner"
              aria-hidden="true"
            />
            <span>Loading settings</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
