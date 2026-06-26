import { BrandMark } from "./brand-mark";
import { FloatingAssistantWidget } from "./floating-assistant-widget";
import { GlobalSearch } from "./global-search";
import { RoutePreloader } from "./route-preloader";
import { SmartPrefetchLink } from "./smart-prefetch-link";
import { TextScaleControl } from "./text-scale-control";
import { TutorialLauncher } from "./tutorial-launcher";
import { signOutAction } from "../auth/actions";
import { getAssistantThreadState } from "../../lib/assistant/persistence";
import { getLlmDevStatus } from "../../lib/ai/dev-status";
import { developerAccessEnabled } from "../../lib/auth/developer-access";
import {
  convertDisplayMoney,
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  formatDisplayMoney,
  formatCurrencyAmount,
} from "../../lib/billing/display-currency";
import { getBillableUsageSummary } from "../../lib/billing/usage-summary";
import { hasSupabaseEnv } from "../../lib/env";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import { usageWindowStart } from "../../lib/usage/queries";
import { getPrimaryWorkspace } from "../../lib/workspace/bootstrap";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import { cache, Suspense } from "react";
import type { ReactNode } from "react";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Assistant", href: "/assistant", icon: "assistant", primary: true },
  { label: "Vapi Voice", href: "/voice-vapi", icon: "voice" },
  { label: "Inbox", href: "/inbox", icon: "inbox" },
  { label: "CRM", href: "/contacts", icon: "crm" },
  { label: "Files", href: "/files", icon: "files" },
  { label: "Payments", href: "/payments", icon: "payments" },
  { label: "Activity", href: "/activity", icon: "activity" },
  { label: "Reports", href: "/reports", icon: "reports" },
  { label: "Settings", href: "/settings", icon: "settings" },
];
const bottomNavItems = ["Dashboard", "Assistant", "Inbox", "Settings"]
  .map((label) => navItems.find((item) => item.label === label))
  .filter((item): item is (typeof navItems)[number] => Boolean(item));
const preloadRoutes = navItems
  .filter((item) =>
    ["Dashboard", "Assistant", "Inbox", "CRM", "Files", "Payments", "Activity"].includes(
      item.label,
    ),
  )
  .map((item) => item.href);
const USAGE_COST_CACHE_TTL_MS = 30_000;
const usageCostCache = new Map<
  string,
  {
    expiresAt: number;
    value: {
      currency: string;
      grossMargin: number;
      providerCost: number;
    } | null;
  }
>();

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

    const cacheKey = `${user.id}:${workspace.id}`;
    const cached = usageCostCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
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

    const value = {
      currency: settings.displayCurrency,
      grossMargin: totals.grossMargin,
      providerCost: totals.providerCost,
    };

    usageCostCache.set(cacheKey, {
      expiresAt: Date.now() + USAGE_COST_CACHE_TTL_MS,
      value,
    });

    return value;
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

function initialsFor(value: string) {
  const words = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return "KY";
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

const loadWorkspaceChromeData = cache(async function loadWorkspaceChromeData() {
  if (!hasSupabaseEnv()) {
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

    const [settings, weeklyUsageSummary, monthlyUsageSummary] = await Promise.all([
      getWorkspaceGeneralSettings(supabase, workspace.id).catch(
        () => DEFAULT_DISPLAY_CURRENCY_SETTINGS,
      ),
      getBillableUsageSummary(supabase, workspace.id, {
        period: "weekly",
      }).catch(() => null),
      getBillableUsageSummary(supabase, workspace.id, {
        period: "monthly",
      }).catch(() => null),
    ]);

    const weeklyAmount = (weeklyUsageSummary?.totals ?? []).reduce<number>(
      (total, item) => total + item.customerCharge,
      0,
    );
    const monthlyAmount = (monthlyUsageSummary?.totals ?? []).reduce<number>(
      (total, item) => total + item.customerCharge,
      0,
    );
    const weeklyCurrency =
      weeklyUsageSummary?.totals[0]?.currency ?? settings.displayCurrency;
    const monthlyCurrency =
      monthlyUsageSummary?.totals[0]?.currency ?? settings.displayCurrency;

    return {
      isDeveloper: developerAccessEnabled(user),
      initials: initialsFor(workspace.name),
      usageMonthLabel: formatDisplayMoney(
        monthlyAmount,
        monthlyCurrency,
        settings,
      ),
      usageWeekLabel: formatDisplayMoney(weeklyAmount, weeklyCurrency, settings),
      userEmail: user.email?.trim() ?? "Signed in",
      workspaceName: workspace.name,
    };
  } catch {
    return null;
  }
});

const loadFloatingAssistantData = cache(async function loadFloatingAssistantData() {
  if (!hasSupabaseEnv()) {
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

    const assistantState = await getAssistantThreadState({
      supabase,
      user,
      workspace,
    });

    return {
      assistantState,
      workspaceName: workspace.name,
    };
  } catch {
    return null;
  }
});

async function SidebarUsageCard() {
  const data = await loadWorkspaceChromeData();

  if (!data) {
    return null;
  }

  return (
    <section className="sidebar-usage-card">
      <p className="eyebrow">Usage</p>
      <div className="sidebar-usage-metrics">
        <div>
          <span>This week</span>
          <strong>{data.usageWeekLabel}</strong>
        </div>
        <div>
          <span>This month</span>
          <strong>{data.usageMonthLabel}</strong>
        </div>
      </div>
      <SmartPrefetchLink
        className="sidebar-usage-link"
        href="/settings?section=usage"
      >
        View settings and billing
      </SmartPrefetchLink>
    </section>
  );
}

async function AppNavLinks({
  active,
  items = navItems,
  isMobile = false,
}: Readonly<{
  active: string;
  items?: typeof navItems;
  isMobile?: boolean;
}>) {
  const data = await loadWorkspaceChromeData();
  const visibleNavItems = items.filter(
    (item) => item.label !== "Developer" || data?.isDeveloper,
  );

  return (
    <>
      {visibleNavItems.map((item) => (
        <SmartPrefetchLink
          href={item.href}
          className={[
            isMobile ? "mobile-bottom-link" : "nav-link",
            item.primary ? "primary" : null,
            item.label === active ? "active" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          key={item.label}
        >
          <span
            className={
              isMobile ? "mobile-bottom-link-inner" : "nav-link-inner"
            }
          >
            <AppShellIcon name={item.icon} />
            <span>{item.label}</span>
          </span>
        </SmartPrefetchLink>
      ))}
    </>
  );
}

async function WorkspaceAccountChip() {
  const data = await loadWorkspaceChromeData();

  if (!data) {
    return null;
  }

  return (
    <details className="workspace-account-menu">
      <summary className="workspace-account-chip" aria-label="Workspace menu">
        <span className="workspace-account-avatar">{data.initials}</span>
        <span className="workspace-account-copy">
          <strong>{data.workspaceName}</strong>
          <small>{data.userEmail}</small>
        </span>
        <span className="workspace-account-chevron" aria-hidden="true">
          v
        </span>
      </summary>
      <div className="workspace-account-menu-panel">
        <SmartPrefetchLink className="workspace-account-menu-item" href="/settings">
          Settings
        </SmartPrefetchLink>
        <form action={signOutAction}>
          <button className="workspace-account-menu-item danger" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

async function FloatingAssistantBridge() {
  const data = await loadFloatingAssistantData();

  if (!data) {
    return null;
  }

  return (
    <FloatingAssistantWidget
      initialState={data.assistantState}
      workspaceName={data.workspaceName}
    />
  );
}

function AppShellIcon({
  name,
}: Readonly<{
  name?: string;
}>) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  if (name === "assistant") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M5 6.5h10M5 10h7M5 13.5h5" />
        <path {...common} d="M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 13.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5Z" />
      </svg>
    );
  }

  if (name === "voice") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M10 13.5a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v4.5a3 3 0 0 0 3 3Z" />
        <path {...common} d="M5 10.5a5 5 0 0 0 10 0M10 15v2.5M7.5 17.5h5" />
      </svg>
    );
  }

  if (name === "crm") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M10 10.25a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 15.75a6 6 0 0 1 12 0" />
      </svg>
    );
  }

  if (name === "inbox") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5V14A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14V6A1.5 1.5 0 0 1 4 4.5Z" />
        <path {...common} d="M3 8.5h4l1.25 2h3.5l1.25-2H17" />
      </svg>
    );
  }

  if (name === "files") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M6 3.5h5l3 3V16A1.5 1.5 0 0 1 12.5 17.5h-7A1.5 1.5 0 0 1 4 16V5A1.5 1.5 0 0 1 5.5 3.5Z" />
        <path {...common} d="M11 3.5V7h3.5M7 10.5h6M7 13h4" />
      </svg>
    );
  }

  if (name === "activity") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M3.5 10h3l1.5-3 3 6 1.5-3H16.5" />
        <path {...common} d="M3.5 4.5h13v11h-13z" />
      </svg>
    );
  }

  if (name === "payments") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M3.5 5.5h13v9h-13zM3.5 8h13" />
        <path {...common} d="M6 12h3M12 12h2" />
      </svg>
    );
  }

  if (name === "reports") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M5 3.5h8l2.5 2.5V16A1.5 1.5 0 0 1 14 17.5H5.5A1.5 1.5 0 0 1 4 16V5A1.5 1.5 0 0 1 5.5 3.5Z" />
        <path {...common} d="M13 3.5V6h2.5M7 13.5V10M10 13.5V7.5M13 13.5v-2" />
      </svg>
    );
  }

  if (name === "developer") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="m7 6-3 4 3 4M13 6l3 4-3 4M11 4l-2 12" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M10 7.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z" />
        <path {...common} d="M10 2.75v1.5M10 15.75v1.5M4.88 4.88l1.06 1.06M14.06 14.06l1.06 1.06M2.75 10h1.5M15.75 10h1.5M4.88 15.12l1.06-1.06M14.06 5.94l1.06-1.06" />
      </svg>
    );
  }

  if (name === "dashboard") {
    return (
      <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
        <path {...common} d="M3.5 3.5h5v5h-5zM11.5 3.5h5v8h-5zM3.5 11.5h5v5h-5zM11.5 14.5h5v2h-5z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="app-shell-icon" viewBox="0 0 20 20">
      <circle {...common} cx="10" cy="10" r="6" />
    </svg>
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
  const fitFoldPages = new Set(["Activity", "CRM", "Files", "Inbox", "Payments"]);
  const workspaceClassName = [
    "workspace",
    fitFoldPages.has(active) ? "workspace-fit-fold" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const showFloatingAssistant = active !== "Assistant";

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
          <SmartPrefetchLink
            aria-label="Go to Dashboard"
            className="brand-lockup"
            href="/dashboard"
          >
            <BrandMark />
          </SmartPrefetchLink>

          <nav className="mobile-drawer-list" aria-label="Mobile navigation">
            <Suspense fallback={null}>
              <AppNavLinks active={active} />
            </Suspense>
          </nav>

          <form action={signOutAction}>
            <button className="secondary-button full-width" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </details>
      <aside className="sidebar" aria-label="Primary navigation" data-tour="side-panel">
        <SmartPrefetchLink
          aria-label="Go to Dashboard"
          className="brand-lockup"
          href="/dashboard"
        >
          <BrandMark />
        </SmartPrefetchLink>

        <nav className="nav-list">
          <Suspense fallback={null}>
            <AppNavLinks active={active} />
          </Suspense>
        </nav>

        <Suspense fallback={null}>
          <SidebarUsageCard />
        </Suspense>

        <form action={signOutAction}>
          <button className="secondary-button full-width" type="submit">
            Sign out
          </button>
        </form>
      </aside>

      <section className={workspaceClassName}>
        <div className="app-top-chrome">
          <div className="global-search-anchor" data-tour="global-search">
            <GlobalSearch />
          </div>
          <div className="dev-top-controls">
            {topControls}
            <Suspense fallback={null}>
              <UsageInternalCostPills />
            </Suspense>
            <TutorialLauncher />
            <TextScaleControl />
            <Suspense fallback={null}>
              <LlmDevStatusPill />
            </Suspense>
            <Suspense fallback={null}>
              <WorkspaceAccountChip />
            </Suspense>
          </div>
        </div>
        {children}
      </section>

      {showFloatingAssistant ? (
        <Suspense fallback={null}>
          <FloatingAssistantBridge />
        </Suspense>
      ) : null}

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        <Suspense fallback={null}>
          <AppNavLinks active={active} isMobile items={bottomNavItems} />
        </Suspense>
      </nav>
    </main>
  );
}
