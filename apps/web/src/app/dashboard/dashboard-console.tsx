"use client";

import { sendAssistantMessageAction } from "../assistant/actions";
import type {
  AssistantThreadMessage,
  AssistantThreadState,
} from "../../lib/assistant/types";
import type {
  DashboardCommandCenterData,
  DashboardContactSummary,
  DashboardWorkQueueItem,
} from "../../lib/dashboard/queries";
import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

type DashboardConsoleProps = {
  data: DashboardCommandCenterData;
  initialAssistantState: AssistantThreadState;
};

type DashboardMetricKey =
  | "needsReply"
  | "readyToQuote"
  | "quoteApprovedOrBooked"
  | "followUpDue"
  | "readyToSend"
  | "awaitingCustomer"
  | "missingInfo"
  | "contactsIndexed";

type DashboardWidgetKey =
  | "work_queue"
  | "assistant"
  | "activity"
  | "documents"
  | "vapi_voice"
  | "calendar"
  | "payments"
  | "top_contacts"
  | "suppliers";

type DashboardTimeframe = "today" | "week" | "month" | "year";
type DashboardActivityFilter =
  | "all"
  | "failed"
  | "inbound"
  | "outbound"
  | "system";
type DashboardQueueFilter =
  | "all"
  | "follow-up"
  | "needs-reply"
  | "ready-to-quote";

type DashboardLayoutConfig = {
  bottom: [DashboardWidgetKey, DashboardWidgetKey, DashboardWidgetKey];
  middle: [DashboardWidgetKey, DashboardWidgetKey, DashboardWidgetKey];
  top: [
    DashboardMetricKey,
    DashboardMetricKey,
    DashboardMetricKey,
    DashboardMetricKey,
  ];
};

type MetricDefinition = {
  description: string;
  href: string;
  icon: string;
  label: string;
  tone: "amber" | "cyan" | "pink" | "purple" | "success";
  value: (data: DashboardCommandCenterData) => number;
};

type WidgetDefinition = {
  description: string;
  key: DashboardWidgetKey;
  title: string;
};

const DASHBOARD_LAYOUT_STORAGE_KEY = "kyro.dashboard.layout.v1";
const DEFAULT_LAYOUT: DashboardLayoutConfig = {
  bottom: ["payments", "top_contacts", "suppliers"],
  middle: ["work_queue", "assistant", "activity"],
  top: ["needsReply", "readyToQuote", "quoteApprovedOrBooked", "followUpDue"],
};

const timeframeLabelMap: Record<DashboardTimeframe, string> = {
  month: "This month",
  today: "Today",
  week: "This week",
  year: "This year",
};

const metricDefinitions: Record<DashboardMetricKey, MetricDefinition> = {
  awaitingCustomer: {
    description: "Waiting on customer input",
    href: "/inbox",
    icon: "clock",
    label: "Awaiting customer",
    tone: "purple",
    value: (data) => data.stats.awaitingCustomer,
  },
  contactsIndexed: {
    description: "Profiles in Kyro CRM",
    href: "/contacts",
    icon: "users",
    label: "Contacts indexed",
    tone: "purple",
    value: (data) => data.stats.contactsIndexed,
  },
  followUpDue: {
    description: "Internal reminders ready",
    href: "/inbox",
    icon: "followup",
    label: "Follow-up due",
    tone: "amber",
    value: (data) => data.stats.followUpDue,
  },
  missingInfo: {
    description: "Need more customer detail",
    href: "/inbox",
    icon: "alert",
    label: "Missing info",
    tone: "pink",
    value: (data) => data.stats.missingInfo,
  },
  needsReply: {
    description: "Conversations need a reply",
    href: "/inbox",
    icon: "reply",
    label: "Needs reply",
    tone: "pink",
    value: (data) => data.stats.needsReply,
  },
  quoteApprovedOrBooked: {
    description: "Quotes approved or work booked",
    href: "/files",
    icon: "check",
    label: "Quote approved / booked",
    tone: "success",
    value: (data) => data.stats.quoteApprovedOrBooked,
  },
  readyToQuote: {
    description: "Inquiries ready for quoting",
    href: "/inbox",
    icon: "quote",
    label: "Ready to quote",
    tone: "cyan",
    value: (data) => data.stats.readyToQuote,
  },
  readyToSend: {
    description: "Draft quotes ready to send",
    href: "/files",
    icon: "document",
    label: "Ready to send",
    tone: "cyan",
    value: (data) => data.stats.readyToSend,
  },
};

const widgetDefinitions: Record<DashboardWidgetKey, WidgetDefinition> = {
  activity: {
    description: "Recent messages, calls, and system actions.",
    key: "activity",
    title: "System activity",
  },
  assistant: {
    description: "Mini text assistant with live Kyro context.",
    key: "assistant",
    title: "Assistant",
  },
  calendar: {
    description: "Placeholder until the Calendar tab is built.",
    key: "calendar",
    title: "Calendar",
  },
  documents: {
    description: "Recent generated files and document outputs.",
    key: "documents",
    title: "Document generation",
  },
  payments: {
    description: "Billing placeholder for customer collections and Kyro usage.",
    key: "payments",
    title: "Payments",
  },
  suppliers: {
    description: "Frequently used supplier contacts.",
    key: "suppliers",
    title: "Suppliers",
  },
  top_contacts: {
    description: "Most active contacts across the workspace.",
    key: "top_contacts",
    title: "Top contacts",
  },
  vapi_voice: {
    description: "Live embedded Vapi voice runtime.",
    key: "vapi_voice",
    title: "Vapi voice",
  },
  work_queue: {
    description: "Priority conversations and next actions.",
    key: "work_queue",
    title: "Work queue",
  },
};

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatCents(value: number, currency: string) {
  return formatCurrency(value / 100, currency);
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function startOfTimeframe(timeframe: DashboardTimeframe, now: Date) {
  const start = new Date(now);

  if (timeframe === "today") {
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (timeframe === "week") {
    start.setHours(0, 0, 0, 0);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return start;
  }

  if (timeframe === "month") {
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
    return start;
  }

  start.setHours(0, 0, 0, 0);
  start.setMonth(0, 1);
  return start;
}

function isWithinTimeframe(
  value: string | null,
  timeframe: DashboardTimeframe,
  now: Date,
) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() >= startOfTimeframe(timeframe, now).getTime();
}

function loadSavedLayout() {
  if (typeof window === "undefined") {
    return DEFAULT_LAYOUT;
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);

    if (!raw) {
      return DEFAULT_LAYOUT;
    }

    const parsed = JSON.parse(raw) as Partial<DashboardLayoutConfig>;

    return {
      bottom: Array.isArray(parsed.bottom) && parsed.bottom.length === 3
        ? (parsed.bottom as DashboardLayoutConfig["bottom"])
        : DEFAULT_LAYOUT.bottom,
      middle: Array.isArray(parsed.middle) && parsed.middle.length === 3
        ? (parsed.middle as DashboardLayoutConfig["middle"])
        : DEFAULT_LAYOUT.middle,
      top: Array.isArray(parsed.top) && parsed.top.length === 4
        ? (parsed.top as DashboardLayoutConfig["top"])
        : DEFAULT_LAYOUT.top,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(config: DashboardLayoutConfig) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    DASHBOARD_LAYOUT_STORAGE_KEY,
    JSON.stringify(config),
  );
}

function trimAssistantMessages(messages: AssistantThreadMessage[], limit = 6) {
  return messages.slice(-limit);
}

function lastAssistantMessageId(messages: AssistantThreadMessage[]) {
  return messages.at(-1)?.id ?? null;
}

function compactSnippet(value: string | null | undefined, limit = 86) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();

  if (!text) {
    return null;
  }

  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function buildToneClass(tone: MetricDefinition["tone"]) {
  return `dashboard-stat-card ${tone}`;
}

function metricIconLabel(icon: string) {
  switch (icon) {
    case "reply":
      return "Reply";
    case "quote":
      return "Quote";
    case "check":
      return "Approved";
    case "followup":
      return "Follow-up";
    case "users":
      return "Contacts";
    case "clock":
      return "Waiting";
    case "alert":
      return "Missing";
    case "document":
      return "Ready";
    default:
      return "Metric";
  }
}

function DashboardMetricIcon({ icon }: Readonly<{ icon: string }>) {
  return (
    <span aria-hidden="true" className={`dashboard-stat-icon ${icon}`}>
      {metricIconLabel(icon)}
    </span>
  );
}

function DashboardListItem({
  eyebrow,
  href,
  meta,
  subtitle,
  title,
}: Readonly<{
  eyebrow?: string | null;
  href: string;
  meta?: string | null;
  subtitle?: string | null;
  title: string;
}>) {
  return (
    <Link className="dashboard-list-item" href={href}>
      <div className="dashboard-list-copy">
        {eyebrow ? <span>{eyebrow}</span> : null}
        <strong>{title}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      {meta ? <em>{meta}</em> : null}
    </Link>
  );
}

function DashboardCompactContactItem({
  href,
  label,
  meta,
  subtitle,
}: Readonly<{
  href: string;
  label: string;
  meta?: string | null;
  subtitle?: string | null;
}>) {
  return (
    <Link className="dashboard-compact-contact-item" href={href}>
      <div className="dashboard-compact-contact-main">
        <strong>{label}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      {meta ? <em>{meta}</em> : null}
    </Link>
  );
}

function DashboardWidgetHeader({
  action,
  description,
  title,
}: Readonly<{
  action?: ReactNode;
  description?: string;
  title: string;
}>) {
  return (
    <header className="dashboard-widget-header">
      <div>
        <p>{title}</p>
        {description ? <span>{description}</span> : null}
      </div>
      {action ? <div className="dashboard-widget-action">{action}</div> : null}
    </header>
  );
}

function timeFilteredActivity(
  data: DashboardCommandCenterData,
  timeframe: DashboardTimeframe,
) {
  const now = new Date();
  const filtered = data.activity.filter((item) =>
    isWithinTimeframe(item.at, timeframe, now),
  );

  return filtered.length > 0 ? filtered : data.activity.slice(0, 6);
}

function timeFilteredDocuments(
  data: DashboardCommandCenterData,
  timeframe: DashboardTimeframe,
) {
  const now = new Date();
  const filtered = data.generatedDocuments.filter((item) =>
    isWithinTimeframe(item.updatedAt, timeframe, now),
  );

  return filtered.length > 0 ? filtered : data.generatedDocuments.slice(0, 6);
}

function timeFilteredContacts(
  contacts: DashboardContactSummary[],
  timeframe: DashboardTimeframe,
) {
  const now = new Date();
  const filtered = contacts.filter((item) =>
    isWithinTimeframe(item.lastMessageAt, timeframe, now),
  );

  return filtered.length > 0 ? filtered : contacts.slice(0, 6);
}

function timeFilteredWorkQueue(
  items: DashboardWorkQueueItem[],
  timeframe: DashboardTimeframe,
) {
  const now = new Date();
  const filtered = items.filter((item) =>
    isWithinTimeframe(item.lastMessageAt, timeframe, now),
  );

  return filtered.length > 0 ? filtered : items.slice(0, 8);
}

function matchesWorkQueueFilter(
  item: DashboardWorkQueueItem,
  filter: DashboardQueueFilter,
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "needs-reply") {
    return item.workflowBucket === "needs_reply";
  }

  if (filter === "ready-to-quote") {
    return item.workflowBucket === "ready_to_quote";
  }

  return item.workflowBucket === "follow_up_due";
}

function matchesActivityFilter(
  tone: DashboardCommandCenterData["activity"][number]["tone"],
  filter: DashboardActivityFilter,
) {
  return filter === "all" ? true : tone === filter;
}

function MiniAssistantWidget({
  initialState,
}: Readonly<{
  initialState: AssistantThreadState;
}>) {
  const [assistantState, sendAction, pending] = useActionState(
    sendAssistantMessageAction,
    initialState,
  );
  const [draft, setDraft] = useState("");
  const [optimisticMessage, setOptimisticMessage] =
    useState<AssistantThreadMessage | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const pendingDraftRef = useRef("");
  const previousLastMessageIdRef = useRef(
    lastAssistantMessageId(initialState.messages),
  );
  const currentLastMessageId = useMemo(
    () => lastAssistantMessageId(assistantState.messages),
    [assistantState.messages],
  );

  useEffect(() => {
    if (
      currentLastMessageId &&
      currentLastMessageId !== previousLastMessageIdRef.current
    ) {
      previousLastMessageIdRef.current = currentLastMessageId;
      pendingDraftRef.current = "";
      setOptimisticMessage(null);
    }
  }, [currentLastMessageId]);

  useEffect(() => {
    if (assistantState.error && pendingDraftRef.current) {
      setDraft(pendingDraftRef.current);
      setOptimisticMessage(null);
      pendingDraftRef.current = "";
    }
  }, [assistantState.error]);

  const messages = useMemo(
    () =>
      trimAssistantMessages(
        optimisticMessage
          ? [...assistantState.messages, optimisticMessage]
          : assistantState.messages,
        4,
      ),
    [assistantState.messages, optimisticMessage],
  );

  useEffect(() => {
    const feed = feedRef.current;

    if (!feed) {
      return;
    }

    feed.scrollTop = feed.scrollHeight;
  }, [messages, pending]);

  return (
    <section
      className="dashboard-widget assistant dashboard-widget-assistant"
      data-tour="dashboard-assistant"
    >
      <DashboardWidgetHeader
        action={
          <Link className="filter-pill" href="/assistant">
            Open full
          </Link>
        }
        title="Assistant"
      />
      <div className="dashboard-mini-assistant-feed" ref={feedRef}>
        {messages.map((message) => (
          <article
            className={`dashboard-mini-turn ${message.role === "user" ? "user" : "assistant"}`}
            key={message.id}
          >
            <span>{message.role === "user" ? "You" : "Kyro"}</span>
            <p>{message.content}</p>
          </article>
        ))}
        {pending ? (
          <article
            aria-label="Kyro is typing"
            className="dashboard-mini-turn assistant dashboard-mini-typing"
          >
            <span>Kyro</span>
            <p aria-hidden="true" className="typing-dots">
              <span />
              <span />
              <span />
            </p>
          </article>
        ) : null}
      </div>
      {assistantState.error ? (
        <div className="form-alert error dashboard-assistant-error">
          {assistantState.error}
        </div>
      ) : null}
      <form
        action={sendAction}
        className="dashboard-mini-assistant-form"
        onSubmit={() => {
          const trimmedDraft = draft.trim();

          if (!trimmedDraft) {
            return;
          }

          pendingDraftRef.current = draft;
          setOptimisticMessage({
            content: draft,
            createdAt: new Date().toISOString(),
            id: `optimistic-${Date.now()}`,
            role: "user",
          });
          setDraft("");
          formRef.current?.reset();
        }}
        ref={formRef}
      >
        <input name="threadId" type="hidden" value={assistantState.threadId ?? ""} />
        <input name="inputSource" type="hidden" value="typed" />
        <div className="dashboard-mini-assistant-actions">
          <input
            name="prompt"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask Kyro something..."
            type="text"
            value={draft}
          />
          <button className="primary-button" disabled={pending || !draft.trim()} type="submit">
            {pending ? "..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}

function renderWidget({
  activityFilter,
  data,
  initialAssistantState,
  key,
  onActivityFilterChange,
  onWorkQueueFilterChange,
  timeframe,
  workQueueFilter,
}: {
  activityFilter: DashboardActivityFilter;
  data: DashboardCommandCenterData;
  initialAssistantState: AssistantThreadState;
  key: DashboardWidgetKey;
  onActivityFilterChange: (value: DashboardActivityFilter) => void;
  onWorkQueueFilterChange: (value: DashboardQueueFilter) => void;
  timeframe: DashboardTimeframe;
  workQueueFilter: DashboardQueueFilter;
}) {
  const timeframeLabel = timeframeLabelMap[timeframe];

  if (key === "work_queue") {
    const items = timeFilteredWorkQueue(data.workQueue, timeframe)
      .filter((item) => matchesWorkQueueFilter(item, workQueueFilter))
      .slice(0, 4);

    return (
      <section
        className="dashboard-widget dashboard-widget-queue"
        data-tour="work-queue"
        key={key}
      >
        <DashboardWidgetHeader
          action={
            <select
              aria-label="Work queue filter"
              onChange={(event) =>
                onWorkQueueFilterChange(event.target.value as DashboardQueueFilter)
              }
              value={workQueueFilter}
            >
              <option value="all">All</option>
              <option value="needs-reply">Need reply</option>
              <option value="ready-to-quote">Ready to quote</option>
              <option value="follow-up">Follow-up</option>
            </select>
          }
          description={`${timeframeLabel} view of active inquiries.`}
          title="Work queue"
        />
        <div className="dashboard-work-queue">
          {items.map((item) => (
            <Link className="dashboard-work-item" href={item.href} key={item.id}>
              <div className="dashboard-work-item-head">
                <div className="dashboard-work-item-title">
                  <time dateTime={item.lastMessageAt ?? undefined}>
                    {formatDateTime(item.lastMessageAt) ?? "Queued"}
                  </time>
                  <strong>{item.title}</strong>
                </div>
                <span className={`pill ${item.workflowBucket}`}>
                  {item.nextActionLabel}
                </span>
              </div>
              <small>{compactSnippet(item.preview ?? item.nextActionLabel, 82)}</small>
            </Link>
          ))}
          {items.length === 0 ? (
            <p className="empty-copy">Nothing matches that queue filter yet.</p>
          ) : null}
          <Link className="dashboard-widget-footer-link" href="/inbox">
            View full queue
          </Link>
        </div>
      </section>
    );
  }

  if (key === "assistant") {
    return (
      <MiniAssistantWidget
        initialState={initialAssistantState}
        key={key}
      />
    );
  }

  if (key === "activity") {
    const items = timeFilteredActivity(data, timeframe)
      .filter((item) => matchesActivityFilter(item.tone, activityFilter))
      .slice(0, 6);

    return (
      <section
        className="dashboard-widget dashboard-widget-activity"
        data-tour="system-activity"
        key={key}
      >
        <DashboardWidgetHeader
          action={
            <select
              aria-label="Activity filter"
              onChange={(event) =>
                onActivityFilterChange(event.target.value as DashboardActivityFilter)
              }
              value={activityFilter}
            >
              <option value="all">All channels</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="failed">Failed</option>
              <option value="system">System</option>
            </select>
          }
          description="Calls, messages, and system-side actions."
          title="System activity"
        />
        <div className="dashboard-activity-list">
          {items.map((item) => (
            <Link
              className={`dashboard-activity-item ${item.tone}`}
              href={item.href ?? "/activity"}
              key={item.id}
            >
              <div className="dashboard-activity-dot" />
              <div className="dashboard-activity-copy">
                <strong>{item.title}</strong>
                {item.subject ? <span>{item.subject}</span> : null}
                <small>{compactSnippet(item.preview, 92)}</small>
              </div>
              <em>{formatDateTime(item.at) ?? ""}</em>
            </Link>
          ))}
          {items.length === 0 ? (
            <p className="empty-copy">Nothing matches that activity filter yet.</p>
          ) : null}
          <Link className="dashboard-widget-footer-link" href="/activity">
            View all activity
          </Link>
        </div>
      </section>
    );
  }

  if (key === "documents") {
    const items = timeFilteredDocuments(data, timeframe);

    return (
      <section className="dashboard-widget dashboard-widget-documents" key={key}>
        <DashboardWidgetHeader
          action={
            <Link className="filter-pill" href="/files">
              Open files
            </Link>
          }
          description="Recent generated images, drafts, and exports."
          title="Document generation"
        />
        <div className="dashboard-list-grid">
          {items.map((item) => (
            <DashboardListItem
              eyebrow={item.type.replace(/_/g, " ")}
              href={item.href}
              key={item.id}
              meta={formatDateTime(item.updatedAt)}
              subtitle={item.lifecycleStatus.replace(/_/g, " ")}
              title={item.title}
            />
          ))}
        </div>
      </section>
    );
  }

  if (key === "payments") {
    const paymentTiles = [
      {
        detail: "Settled this week",
        label: "Paid this week",
        value: formatCents(data.payments.paidThisWeekCents, data.payments.currency),
      },
      {
        detail: "Settled this month",
        label: "Paid this month",
        value: formatCents(data.payments.paidThisMonthCents, data.payments.currency),
      },
      {
        detail: `${formatCount(data.payments.outstandingCount)} open`,
        label: "Outstanding",
        value: formatCents(data.payments.outstandingAmountCents, data.payments.currency),
      },
      {
        detail: `${formatCount(data.payments.overdueCount)} past due`,
        label: "Overdue",
        value: formatCents(data.payments.overdueAmountCents, data.payments.currency),
      },
    ];

    return (
      <section className="dashboard-widget dashboard-widget-payments" key={key}>
        <DashboardWidgetHeader
          description="Customer collections and payment requests."
          title="Payments"
        />
        <div className="dashboard-payments-card">
          {paymentTiles.map((tile) => (
            <article key={tile.label}>
              <span>{tile.label}</span>
              <strong>{tile.value}</strong>
              <small>{tile.detail}</small>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (key === "top_contacts") {
    const items = timeFilteredContacts(data.topContacts, timeframe);

    return (
      <section className="dashboard-widget dashboard-widget-contacts" key={key}>
        <DashboardWidgetHeader
          action={<span className="filter-pill">{timeframeLabel}</span>}
          description="Most active people and companies in Kyro."
          title="Top contacts"
        />
        <div className="dashboard-compact-contact-grid">
          {items.map((item) => (
              <DashboardCompactContactItem
                href={item.href}
                key={item.id}
                label={item.label}
                meta={item.messageCount > 0 ? `${formatCount(item.messageCount)} msgs` : null}
                subtitle={compactSnippet(item.sublabel, 38)}
              />
            ))}
        </div>
      </section>
    );
  }

  if (key === "suppliers") {
    const items = timeFilteredContacts(data.suppliers, timeframe);

    return (
      <section className="dashboard-widget dashboard-widget-suppliers" key={key}>
        <DashboardWidgetHeader
          action={<Link className="filter-pill" href="/contacts">Open CRM</Link>}
          description="Quick access to supplier relationships."
          title="Suppliers"
        />
        <div className="dashboard-compact-contact-grid">
          {items.length > 0 ? (
            items.map((item) => (
              <DashboardCompactContactItem
                href={item.href}
                key={item.id}
                label={item.label}
                meta={item.messageCount > 0 ? `${formatCount(item.messageCount)} msgs` : null}
                subtitle={compactSnippet(item.sublabel, 38)}
              />
            ))
          ) : (
            <p className="empty-copy">
              No suppliers have been tagged in the CRM yet.
            </p>
          )}
        </div>
      </section>
    );
  }

  if (key === "calendar") {
    return (
      <section className="dashboard-widget placeholder" key={key}>
        <DashboardWidgetHeader
          action={<span className="filter-pill">Placeholder</span>}
          description="Calendar tab still needs building."
          title="Calendar"
        />
        <div className="dashboard-placeholder">
          <strong>Calendar surface coming next.</strong>
          <p>
            We will wire scheduling, site visits, and due reminders into a dedicated
            calendar tab, then surface the most useful slice of it here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-widget voice" key={key}>
      <DashboardWidgetHeader
        action={
          <Link className="filter-pill" href="/voice-vapi">
            Open full voice
          </Link>
        }
        description="Embedded Vapi runtime for quick hands-free use."
        title="Vapi voice"
      />
      <div className="dashboard-vapi-widget">
        <iframe src="/voice-vapi?embed=1" title="Kyro Vapi voice widget" />
      </div>
    </section>
  );
}

export function DashboardConsole({
  data,
  initialAssistantState,
}: DashboardConsoleProps) {
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>("today");
  const [activityFilter, setActivityFilter] =
    useState<DashboardActivityFilter>("all");
  const [layout, setLayout] = useState<DashboardLayoutConfig>(DEFAULT_LAYOUT);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [workQueueFilter, setWorkQueueFilter] =
    useState<DashboardQueueFilter>("all");

  useEffect(() => {
    const loadTimeout = window.setTimeout(() => {
      setLayout(loadSavedLayout());
    }, 0);

    return () => window.clearTimeout(loadTimeout);
  }, []);

  const updateLayout = (nextLayout: DashboardLayoutConfig) => {
    setLayout(nextLayout);
    saveLayout(nextLayout);
  };

  return (
    <section className="dashboard-command-centre">
      <header className="dashboard-command-header">
        <div className="dashboard-command-title">
          <h1>Dashboard</h1>
        </div>
        <div className="dashboard-command-actions" data-tour="dashboard-customise">
          <button
            className="secondary-button compact"
            onClick={() => setCustomizeOpen((current) => !current)}
            type="button"
          >
            {customizeOpen ? "Close" : "Customise"}
          </button>
          <label className="dashboard-timeframe-select">
            <span className="sr-only">Dashboard timeframe</span>
            <select
              onChange={(event) =>
                setTimeframe(event.target.value as DashboardTimeframe)
              }
              value={timeframe}
            >
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
            </select>
          </label>
        </div>
      </header>

      {customizeOpen ? (
        <section className="dashboard-customize-panel panel">
          <div className="dashboard-customize-heading">
            <div>
              <p className="eyebrow">Dashboard layout</p>
              <h2>Choose what appears in each row</h2>
            </div>
            <button
              className="secondary-button compact"
              onClick={() => {
                updateLayout(DEFAULT_LAYOUT);
                setCustomizeOpen(false);
              }}
              type="button"
            >
              Reset defaults
            </button>
          </div>

          <div className="dashboard-customize-grid">
            <div className="dashboard-customize-row">
              <strong>Top metrics</strong>
              {layout.top.map((selected, index) => (
                <label key={`top-${index}`}>
                  Top slot {index + 1}
                  <select
                    onChange={(event) => {
                      const nextTop = [...layout.top] as DashboardLayoutConfig["top"];
                      nextTop[index] = event.target.value as DashboardMetricKey;
                      updateLayout({ ...layout, top: nextTop });
                    }}
                    value={selected}
                  >
                    {Object.entries(metricDefinitions).map(([key, definition]) => (
                      <option key={key} value={key}>
                        {definition.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="dashboard-customize-row">
              <strong>Middle widgets</strong>
              {layout.middle.map((selected, index) => (
                <label key={`middle-${index}`}>
                  Middle slot {index + 1}
                  <select
                    onChange={(event) => {
                      const nextMiddle = [...layout.middle] as DashboardLayoutConfig["middle"];
                      nextMiddle[index] = event.target.value as DashboardWidgetKey;
                      updateLayout({ ...layout, middle: nextMiddle });
                    }}
                    value={selected}
                  >
                    {Object.entries(widgetDefinitions).map(([key, definition]) => (
                      <option key={key} value={key}>
                        {definition.title}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="dashboard-customize-row">
              <strong>Bottom widgets</strong>
              {layout.bottom.map((selected, index) => (
                <label key={`bottom-${index}`}>
                  Bottom slot {index + 1}
                  <select
                    onChange={(event) => {
                      const nextBottom = [...layout.bottom] as DashboardLayoutConfig["bottom"];
                      nextBottom[index] = event.target.value as DashboardWidgetKey;
                      updateLayout({ ...layout, bottom: nextBottom });
                    }}
                    value={selected}
                  >
                    {Object.entries(widgetDefinitions).map(([key, definition]) => (
                      <option key={key} value={key}>
                        {definition.title}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="dashboard-customize-options">
            {Object.values(widgetDefinitions).map((definition) => (
              <article className="dashboard-option-card" key={definition.key}>
                <strong>{definition.title}</strong>
                <p>{definition.description}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!customizeOpen ? (
        <>
          <section className="dashboard-stat-grid" data-tour="dashboard-metrics">
            {layout.top.map((metricKey) => {
              const definition = metricDefinitions[metricKey];

              return (
                <Link
                  className={buildToneClass(definition.tone)}
                  href={definition.href}
                  key={metricKey}
                >
                  <div className="dashboard-stat-copy">
                    <span>{definition.label}</span>
                    <strong>{formatCount(definition.value(data))}</strong>
                    <small>{definition.description}</small>
                  </div>
                  <DashboardMetricIcon icon={definition.icon} />
                </Link>
              );
            })}
          </section>

          <section className="dashboard-middle-grid">
            {layout.middle.map((widgetKey) =>
              renderWidget({
                activityFilter,
                data,
                initialAssistantState,
                key: widgetKey,
                onActivityFilterChange: setActivityFilter,
                onWorkQueueFilterChange: setWorkQueueFilter,
                timeframe,
                workQueueFilter,
              }),
            )}
          </section>

          <section
            className="dashboard-bottom-grid"
            data-tour="dashboard-bottom-widgets"
          >
            {layout.bottom.map((widgetKey) =>
              renderWidget({
                activityFilter,
                data,
                initialAssistantState,
                key: widgetKey,
                onActivityFilterChange: setActivityFilter,
                onWorkQueueFilterChange: setWorkQueueFilter,
                timeframe,
                workQueueFilter,
              }),
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
