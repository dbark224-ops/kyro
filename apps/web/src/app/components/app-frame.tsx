import { BrandMark } from "./brand-mark";
import { RoutePreloader } from "./route-preloader";
import { TextScaleControl } from "./text-scale-control";
import { signOutAction } from "../auth/actions";
import { getLlmDevStatus } from "../../lib/ai/dev-status";
import {
  convertDisplayMoney,
  formatCurrencyAmount,
} from "../../lib/billing/display-currency";
import { hasSupabaseEnv } from "../../lib/env";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import { usageWindowStart } from "../../lib/usage/queries";
import { getPrimaryWorkspace } from "../../lib/workspace/bootstrap";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
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

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "USD";
}

async function loadUsageInternalCostPillData() {
  if (process.env.NODE_ENV === "production" || !hasSupabaseEnv()) {
    return null;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const workspace = await getPrimaryWorkspace(supabase);

    if (!workspace) {
      return null;
    }

    const start = usageWindowStart("30d");
    let usageQuery = supabase
      .from("usage_events")
      .select("cost_snapshot,customer_charge_snapshot,currency")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (start) {
      usageQuery = usageQuery.gte("created_at", start);
    }

    const [settings, usageResult] = await Promise.all([
      getWorkspaceGeneralSettings(supabase, workspace.id),
      usageQuery,
    ]);

    if (usageResult.error) {
      return null;
    }

    const totals = (usageResult.data ?? []).reduce(
      (current, row) => {
        const currency = textValue(row.currency);
        const provider =
          convertDisplayMoney(numberValue(row.cost_snapshot), currency, settings)
            ?.amount ?? 0;
        const customer =
          convertDisplayMoney(
            numberValue(row.customer_charge_snapshot),
            currency,
            settings,
          )?.amount ?? 0;

        return {
          grossMargin: current.grossMargin + customer - provider,
          providerCost: current.providerCost + provider,
        };
      },
      { grossMargin: 0, providerCost: 0 },
    );

    return {
      currency: settings.displayCurrency,
      grossMargin: totals.grossMargin,
      providerCost: totals.providerCost,
    };
  } catch {
    return null;
  }
}

async function UsageInternalCostPills() {
  const totals = await loadUsageInternalCostPillData();

  if (!totals) {
    return null;
  }

  return (
    <div
      aria-label="Internal usage cost controls"
      className="usage-internal-cost-pills"
    >
      <span title="Internal provider/API cost over the last 30 days before Kyro markup.">
        <b>Provider</b>
        {formatCurrencyAmount(totals.providerCost, totals.currency)}
      </span>
      <span title="Internal margin over the last 30 days before payment processing, support, and infrastructure costs.">
        <b>Margin</b>
        {formatCurrencyAmount(totals.grossMargin, totals.currency)}
      </span>
    </div>
  );
}

export function AppFrame({
  active,
  children,
  topControls,
}: Readonly<{
  active: string;
  children: ReactNode;
  topControls?: ReactNode;
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
          {topControls}
          <Suspense fallback={null}>
            <UsageInternalCostPills />
          </Suspense>
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
