import { AppFrame } from "../components/app-frame";
import { BrandMark } from "../components/brand-mark";
import {
  ActivitySelectedDetail,
  ActivitySelectionProvider,
  ActivityTimeline,
  type ActivityTimelineItem,
} from "./activity-timeline";
import {
  getAssistantExternalActivity,
  type AssistantExternalActivityItem,
} from "../../lib/assistant/external-activity";
import { getAiLedger } from "../../lib/ai/triage";
import {
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  formatDisplayMoney,
  type DisplayCurrencySettings,
} from "../../lib/billing/display-currency";
import { hasSupabaseEnv } from "../../lib/env";
import { getEngineQueues } from "../../lib/engine/event-action-audit";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import {
  getDashboardSnapshot,
  getPrimaryWorkspace,
} from "../../lib/workspace/bootstrap";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type LogItem = ActivityTimelineItem;

type LogFilter =
  | "all"
  | "actions"
  | "ai"
  | "audit"
  | "events"
  | "failed"
  | "inbound"
  | "messages"
  | "outbound"
  | "routing"
  | "usage";

type LogPageProps = {
  searchParams?: Promise<{
    detail?: string;
    filter?: string;
    from?: string;
    page?: string;
    q?: string;
    source?: string;
    to?: string;
  }>;
};

type LogSearchState = {
  detail: string;
  from: string;
  q: string;
  source: string;
  to: string;
};

const LOG_FILTERS: Array<{ label: string; value: LogFilter }> = [
  { label: "All", value: "all" },
  { label: "Messages", value: "messages" },
  { label: "Inbound", value: "inbound" },
  { label: "Outbound", value: "outbound" },
  { label: "Failed", value: "failed" },
  { label: "Actions", value: "actions" },
  { label: "Events", value: "events" },
  { label: "Audit", value: "audit" },
  { label: "AI runs", value: "ai" },
  { label: "Routing", value: "routing" },
  { label: "Usage", value: "usage" },
];
const LOG_PAGE_SIZE = 10;
const LOG_SOURCE_LIMIT = 200;

function SetupRequired() {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-lockup">
          <BrandMark />
        </div>
        <h1>Connect Supabase to continue.</h1>
        <p className="form-copy">
          Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
          `DATABASE_URL` to your local `.env`, then apply the migrations.
        </p>
        <div className="setup-list">
          <code>npm run db:migrate</code>
          <code>npm run dev</code>
        </div>
      </section>
    </main>
  );
}

function isLogFilter(value: string | undefined): value is LogFilter {
  return LOG_FILTERS.some((filter) => filter.value === value);
}

function normalizeSearch(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizeDateInput(value: string | undefined) {
  const date = normalizeSearch(value);

  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function logHref({
  filter,
  page,
  search,
}: {
  filter: LogFilter;
  page?: number;
  search?: LogSearchState;
}) {
  const params = new URLSearchParams();

  if (filter !== "all") {
    params.set("filter", filter);
  }

  if (search?.q) {
    params.set("q", search.q);
  }

  if (search?.source) {
    params.set("source", search.source);
  }

  if (search?.detail) {
    params.set("detail", search.detail);
  }

  if (search?.from) {
    params.set("from", search.from);
  }

  if (search?.to) {
    params.set("to", search.to);
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();

  return query ? `/activity?${query}` : "/activity";
}

function formatLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatMoney(
  value: string | null,
  sourceCurrency: string,
  displayCurrencySettings: DisplayCurrencySettings,
) {
  return formatDisplayMoney(value, sourceCurrency, displayCurrencySettings);
}

function operationalLogItem(item: AssistantExternalActivityItem): LogItem {
  const tone = item.tone === "system" ? "audit" : item.tone;
  const detail = [item.meta, item.subject, item.preview]
    .filter(Boolean)
    .join(" - ");

  return {
    at: item.at,
    detail,
    id: item.id,
    meta: tone === "failed" ? "Failed" : item.meta,
    searchText: [item.title, item.meta, item.subject, item.preview, tone]
      .filter(Boolean)
      .join(" "),
    title: item.title,
    tone,
  };
}

function buildLogItems({
  aiLedger,
  engine,
  displayCurrencySettings,
  operationalActivity,
}: {
  aiLedger: Awaited<ReturnType<typeof getAiLedger>>;
  engine: Awaited<ReturnType<typeof getEngineQueues>>;
  displayCurrencySettings: DisplayCurrencySettings;
  operationalActivity: AssistantExternalActivityItem[];
}) {
  const items: LogItem[] = [
    ...operationalActivity.map(operationalLogItem),
    ...engine.actions.map((action) => ({
      id: `action:${action.id}`,
      at: action.createdAt,
      detail: `${formatLabel(action.status)} action requested by ${formatLabel(
        action.requestedBy,
      )}`,
      meta: action.approvalRequired ? "Approval required" : "No approval",
      title: formatLabel(action.type),
      tone: "action" as const,
    })),
    ...engine.events.map((event) => ({
      id: `event:${event.id}`,
      at: event.createdAt,
      detail: `${formatLabel(event.source)} event processed as ${formatLabel(
        event.status,
      )}`,
      meta: "Event",
      title: formatLabel(event.type),
      tone: "event" as const,
    })),
    ...engine.auditLogs.map((log) => ({
      id: `audit:${log.id}`,
      at: log.createdAt,
      detail: `${formatLabel(log.actorType)} recorded against ${formatLabel(
        log.entityType,
      )}`,
      meta: "Audit",
      title: formatLabel(log.action),
      tone: "audit" as const,
    })),
    ...aiLedger.aiRuns.map((run) => ({
      id: `ai:${run.id}`,
      at: run.createdAt,
      detail: `${formatLabel(run.status)} on ${run.provider}/${run.model}`,
      meta: formatMoney(run.actualCost, "USD", displayCurrencySettings),
      title: formatLabel(run.taskType),
      tone: "ai" as const,
    })),
    ...aiLedger.routeDecisions.map((decision) => ({
      id: `route:${decision.id}`,
      at: decision.createdAt,
      detail: `${formatLabel(decision.taskType)} routed to ${
        decision.selectedProvider
      }`,
      meta: decision.decisionReason,
      title: decision.selectedModel,
      tone: "route" as const,
    })),
    ...aiLedger.usageEvents.map((usage) => ({
      id: `usage:${usage.id}`,
      at: usage.createdAt,
      detail: `${usage.quantity} units metered for ${formatLabel(
        usage.service,
      )}`,
      meta: formatMoney(
        usage.customerChargeSnapshot,
        usage.currency,
        displayCurrencySettings,
      ),
      title: formatLabel(usage.usageType),
      tone: "usage" as const,
    })),
  ];

  return items.sort(
    (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
  );
}

function itemMatchesFilter(item: LogItem, filter: LogFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "messages") {
    return (
      item.tone === "failed" ||
      item.tone === "inbound" ||
      item.tone === "outbound"
    );
  }

  if (filter === "outbound") {
    return item.tone === "failed" || item.tone === "outbound";
  }

  if (filter === "actions") {
    return item.tone === "action";
  }

  if (filter === "events") {
    return item.tone === "event";
  }

  if (filter === "routing") {
    return item.tone === "route";
  }

  return item.tone === filter;
}

function buildFilterCounts(items: LogItem[]) {
  return new Map(
    LOG_FILTERS.map((filter) => [
      filter.value,
      items.filter((item) => itemMatchesFilter(item, filter.value)).length,
    ]),
  );
}

function logItemSearchText(item: LogItem) {
  return [item.title, item.detail, item.meta, item.tone, item.searchText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function dateStart(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  const time = date.getTime();

  return Number.isFinite(time) ? time : null;
}

function dateEnd(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T23:59:59.999`);
  const time = date.getTime();

  return Number.isFinite(time) ? time : null;
}

function itemMatchesSearch(item: LogItem, search: LogSearchState) {
  const itemAt = new Date(item.at).getTime();
  const from = dateStart(search.from);
  const to = dateEnd(search.to);
  const combinedText = logItemSearchText(item);
  const sourceText = [item.tone, item.title, item.meta, item.detail]
    .join(" ")
    .toLowerCase();

  return (
    (!search.q || combinedText.includes(search.q.toLowerCase())) &&
    (!search.source || sourceText.includes(search.source.toLowerCase())) &&
    (!search.detail ||
      item.detail.toLowerCase().includes(search.detail.toLowerCase())) &&
    (!from || itemAt >= from) &&
    (!to || itemAt <= to)
  );
}

export default async function ActivityPage({ searchParams }: LogPageProps) {
  const query = await searchParams;
  const activeFilter = isLogFilter(query?.filter) ? query.filter : "all";
  const requestedPage = normalizePage(query?.page);
  const searchState: LogSearchState = {
    detail: normalizeSearch(query?.detail),
    from: normalizeDateInput(query?.from),
    q: normalizeSearch(query?.q),
    source: normalizeSearch(query?.source),
    to: normalizeDateInput(query?.to),
  };
  const hasAdvancedSearch = Boolean(
    searchState.source ||
    searchState.detail ||
    searchState.from ||
    searchState.to,
  );
  const hasSearch = Boolean(searchState.q || hasAdvancedSearch);

  if (!hasSupabaseEnv()) {
    return <SetupRequired />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    redirect("/onboarding");
  }

  const [dashboard, engine, aiLedger, operationalActivity, generalSettings] =
    await Promise.all([
      getDashboardSnapshot(supabase, workspace),
      getEngineQueues(supabase, workspace.id, LOG_SOURCE_LIMIT),
      getAiLedger(supabase, workspace.id, LOG_SOURCE_LIMIT),
      getAssistantExternalActivity(supabase, workspace.id, LOG_SOURCE_LIMIT),
      getWorkspaceGeneralSettings(supabase, workspace.id).catch(() => null),
    ]);
  const logItems = buildLogItems({
    aiLedger,
    displayCurrencySettings:
      generalSettings ?? DEFAULT_DISPLAY_CURRENCY_SETTINGS,
    engine,
    operationalActivity,
  });
  const searchedLogItems = logItems.filter((item) =>
    itemMatchesSearch(item, searchState),
  );
  const filterCounts = buildFilterCounts(searchedLogItems);
  const filteredLogItems = searchedLogItems.filter((item) =>
    itemMatchesFilter(item, activeFilter),
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredLogItems.length / LOG_PAGE_SIZE),
  );
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * LOG_PAGE_SIZE;
  const paginatedLogItems = filteredLogItems.slice(
    pageStart,
    pageStart + LOG_PAGE_SIZE,
  );
  const initialItem =
    paginatedLogItems[0] ?? filteredLogItems[0] ?? searchedLogItems[0] ?? null;
  const activityTimeZone = generalSettings?.timeZone ?? "UTC";

  return (
    <AppFrame active="Activity">
      <header className="topbar page-topbar-tight">
        <div>
          <h1>Activity</h1>
        </div>
        <div className="topbar-right">
          <section className="metric-grid" aria-label="Log metrics">
            <article className="metric-card cyan">
              <p>Messages</p>
              <strong>{dashboard.counts.messages}</strong>
              <span>Stored inbound and outbound</span>
            </article>
            <article className="metric-card purple">
              <p>Actions</p>
              <strong>{dashboard.counts.pendingActions}</strong>
              <span>Pending approval</span>
            </article>
            <article className="metric-card pink">
              <p>Usage</p>
              <strong>{dashboard.counts.usageEvents}</strong>
              <span>Metered events</span>
            </article>
          </section>
        </div>
      </header>

      <ActivitySelectionProvider
        initialItem={initialItem}
        key={initialItem?.id ?? "empty-activity"}
        timeZone={activityTimeZone}
      >
        <section className="log-layout activity-workspace">
          <article className="panel page-panel activity-log-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Activity</p>
                <h2>Workspace timeline</h2>
              </div>
              <span className="pill">
                {filteredLogItems.length === 0
                  ? "0 shown"
                  : `${pageStart + 1}-${Math.min(
                      pageStart + LOG_PAGE_SIZE,
                      filteredLogItems.length,
                    )} of ${filteredLogItems.length}`}
              </span>
            </div>

            <nav className="filter-bar log-filter-bar" aria-label="Log filters">
              {LOG_FILTERS.map((filter) => (
                <Link
                  className={
                    activeFilter === filter.value
                      ? "filter-pill active"
                      : "filter-pill"
                  }
                  href={logHref({ filter: filter.value, search: searchState })}
                  key={filter.value}
                  prefetch={false}
                >
                  {filter.label}
                  <span>{filterCounts.get(filter.value) ?? 0}</span>
                </Link>
              ))}
            </nav>

            <form action="/activity" className="log-search-form" method="get">
              {activeFilter !== "all" ? (
                <input name="filter" type="hidden" value={activeFilter} />
              ) : null}
              <label className="log-search-field">
                Search
                <input
                  defaultValue={searchState.q}
                  name="q"
                  placeholder="Customer, message, action, model..."
                  type="search"
                />
              </label>
              <button className="secondary-button compact" type="submit">
                Apply
              </button>
              {hasSearch ? (
                <Link
                  className="secondary-button compact"
                  href={logHref({ filter: activeFilter })}
                  prefetch={false}
                >
                  Clear
                </Link>
              ) : null}
              <details className="log-advanced-search" open={hasAdvancedSearch}>
                <summary>Advanced search</summary>
                <div className="log-advanced-grid">
                  <label>
                    Type / source
                    <input
                      defaultValue={searchState.source}
                      name="source"
                      placeholder="inbound, email, ai, audit..."
                      type="search"
                    />
                  </label>
                  <label>
                    Detail contains
                    <input
                      defaultValue={searchState.detail}
                      name="detail"
                      placeholder="customer, body, status..."
                      type="search"
                    />
                  </label>
                  <label>
                    From
                    <input
                      defaultValue={searchState.from}
                      name="from"
                      type="date"
                    />
                  </label>
                  <label>
                    To
                    <input
                      defaultValue={searchState.to}
                      name="to"
                      type="date"
                    />
                  </label>
                </div>
              </details>
            </form>

            <ActivityTimeline
              emptyCopy={
                searchedLogItems.length > 0
                  ? "No log activity matches this filter."
                  : logItems.length > 0
                    ? "No log activity matches this search."
                    : "No log activity has been recorded yet."
              }
              items={paginatedLogItems}
            />

            {totalPages > 1 ? (
              <nav aria-label="Activity pagination" className="pagination-bar">
                <Link
                  aria-disabled={currentPage === 1}
                  className={
                    currentPage === 1
                      ? "secondary-button compact disabled"
                      : "secondary-button compact"
                  }
                  href={logHref({
                    filter: activeFilter,
                    page: currentPage - 1,
                    search: searchState,
                  })}
                  prefetch={false}
                >
                  Previous
                </Link>
                <span className="pagination-label">
                  Page {currentPage} of {totalPages}
                </span>
                <Link
                  aria-disabled={currentPage === totalPages}
                  className={
                    currentPage === totalPages
                      ? "secondary-button compact disabled"
                      : "secondary-button compact"
                  }
                  href={logHref({
                    filter: activeFilter,
                    page: currentPage + 1,
                    search: searchState,
                  })}
                  prefetch={false}
                >
                  Next
                </Link>
              </nav>
            ) : null}
          </article>

          <aside className="side-stack">
            <ActivitySelectedDetail />

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Scope</p>
                  <h2>What appears here</h2>
                </div>
              </div>
              <div className="module-list">
                <span>Messages</span>
                <span>Inbound</span>
                <span>Outbound</span>
                <span>SMS attempts</span>
                <span>Failed deliveries</span>
                <span>Phone calls</span>
                <span>Actions</span>
                <span>AI runs</span>
                <span>Model routing</span>
                <span>Usage events</span>
                <span>Audit logs</span>
              </div>
            </article>
          </aside>
        </section>
      </ActivitySelectionProvider>
    </AppFrame>
  );
}
