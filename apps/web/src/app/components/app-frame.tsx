import { BrandMark } from "./brand-mark";
import { RoutePreloader } from "./route-preloader";
import { TextScaleControl } from "./text-scale-control";
import { signOutAction } from "../auth/actions";
import { getLlmDevStatus } from "../../lib/ai/dev-status";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

const navItems = [
  { label: "Assistant", href: "/assistant", primary: true },
  { label: "Voice", href: "/voice" },
  { label: "Inbox", href: "/inbox" },
  { label: "CRM", href: "/contacts" },
  { label: "Documents", href: "/documents" },
  { label: "Log", href: "/" },
  { label: "Developer", href: "/developer" },
  { label: "Settings", href: "/settings" },
];
const bottomNavItems = ["Assistant", "Voice", "Inbox", "Settings"]
  .map((label) => navItems.find((item) => item.label === label))
  .filter((item): item is (typeof navItems)[number] => Boolean(item));
const preloadRoutes = navItems
  .filter((item) => item.label !== "Developer")
  .map((item) => item.href);

async function LlmDevStatusPill() {
  const status = await getLlmDevStatus();

  if (!status) {
    return null;
  }

  return (
    <div
      aria-label={status.detail}
      className={`llm-dev-pill ${status.tone}`}
      title={status.detail}
    >
      <span aria-hidden="true" />
      {status.label}
    </div>
  );
}

export function AppFrame({
  active,
  children,
}: Readonly<{
  active: string;
  children: ReactNode;
}>) {
  const activeHref = navItems.find((item) => item.label === active)?.href;

  return (
    <main className="app-shell">
      <RoutePreloader activeHref={activeHref} routes={preloadRoutes} />
      <details className="mobile-nav-drawer">
        <summary className="mobile-drawer-toggle" aria-label="Open navigation">
          <span aria-hidden="true" className="mobile-drawer-lines">
            <span />
            <span />
          </span>
          Menu
        </summary>
        <div className="mobile-drawer-panel">
          <div className="brand-lockup">
            <BrandMark />
          </div>

          <nav className="mobile-drawer-list" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <Link
                href={item.href}
                className={[
                  "nav-link",
                  item.primary ? "primary" : null,
                  item.label === active ? "active" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.label}
                prefetch={false}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <form action={signOutAction}>
            <button className="secondary-button full-width" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </details>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <BrandMark />
        </div>

        <nav className="nav-list">
          {navItems.map((item) =>
            item.href ? (
              <Link
                href={item.href}
                className={[
                  "nav-link",
                  item.primary ? "primary" : null,
                  item.label === active ? "active" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.label}
                prefetch={false}
              >
                {item.label}
              </Link>
            ) : (
              <span className="nav-link disabled" key={item.label}>
                {item.label}
              </span>
            ),
          )}
        </nav>

        <form action={signOutAction}>
          <button className="secondary-button full-width" type="submit">
            Sign out
          </button>
        </form>
      </aside>

      <section className="workspace">
        <div className="dev-top-controls">
          <TextScaleControl />
          <Suspense fallback={null}>
            <LlmDevStatusPill />
          </Suspense>
        </div>
        {children}
      </section>

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {bottomNavItems.map((item) => (
          <Link
            className={[
              "mobile-bottom-link",
              item.label === active ? "active" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            href={item.href}
            key={item.label}
            prefetch={false}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
