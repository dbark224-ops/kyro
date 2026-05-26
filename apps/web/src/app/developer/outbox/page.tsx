import { AppFrame } from "../../components/app-frame";
import { requireWorkspaceContext } from "../../../lib/workspace/context";
import Link from "next/link";
import {
  dismissOutboxDeliveryAction,
  retryOutboxDeliveryAction,
} from "./actions";

export const dynamic = "force-dynamic";

type OutboxPageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
    q?: string;
    source?: string;
    status?: string;
  }>;
};

type OutboxRow = {
  id: string;
  action_id: string | null;
  attachments: unknown;
  attempt_count: number | null;
  body_text: string;
  channel_type: string;
  connection_id: string | null;
  conversation_id: string | null;
  created_at: string;
  event_id: string | null;
  failed_at: string | null;
  idempotency_key: string;
  last_error: string | null;
  max_attempts: number | null;
  metadata: unknown;
  next_attempt_at: string | null;
  provider: string | null;
  provider_message_id: string | null;
  provider_request_id: string | null;
  provider_thread_id: string | null;
  queued_at: string;
  recipient: string | null;
  sending_at: string | null;
  sent_at: string | null;
  service: string | null;
  source: string;
  status: string;
  subject: string | null;
  updated_at: string;
};

type QueryError = {
  code?: string;
  message?: string;
} | null;

const STATUS_FILTERS = [
  { label: "Active ops", value: "active" },
  { label: "Failed", value: "failed" },
  { label: "Retry scheduled", value: "retry_scheduled" },
  { label: "Queued", value: "queued" },
  { label: "Sending", value: "sending" },
  { label: "Sent", value: "sent" },
  { label: "Dismissed", value: "dismissed" },
  { label: "All", value: "all" },
] as const;

const ACTIVE_STATUSES = ["queued", "sending", "retry_scheduled", "failed"];
const RETRYABLE_STATUSES = new Set(["queued", "retry_scheduled", "failed"]);

function isStatusFilter(
  value: string | undefined,
): value is (typeof STATUS_FILTERS)[number]["value"] {
  return STATUS_FILTERS.some((status) => status.value === value);
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function compactUuid(value: string | null) {
  return value ? `${value.slice(0, 8)}...${value.slice(-4)}` : "-";
}

function preview(value: string | null, maxLength = 180) {
  if (!value) {
    return "No message body.";
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function statusTone(status: string) {
  if (status === "sent") {
    return "success";
  }

  if (status === "failed") {
    return "warning";
  }

  if (status === "retry_scheduled") {
    return "scheduled";
  }

  if (status === "dismissed") {
    return "muted";
  }

  return "active";
}

function outboxHref({
  query,
  source,
  status,
}: {
  query: string;
  source: string;
  status: string;
}) {
  const params = new URLSearchParams();

  if (status !== "active") {
    params.set("status", status);
  }

  if (source !== "all") {
    params.set("source", source);
  }

  if (query.trim()) {
    params.set("q", query.trim());
  }

  const qs = params.toString();

  return qs ? `/developer/outbox?${qs}` : "/developer/outbox";
}

function sourceOptions(rows: Array<{ source: string | null }>) {
  return Array.from(
    new Set(
      rows
        .map((row) => textValue(row.source))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function attachmentSummary(row: OutboxRow) {
  const fromAttachments = arrayValue(row.attachments);

  if (fromAttachments.length > 0) {
    return fromAttachments
      .map((attachment) => {
        const record = objectRecord(attachment);
        const filename = textValue(record.filename) ?? "Attachment";
        const sizeBytes = numberValue(record.sizeBytes);

        return sizeBytes > 0
          ? `${filename} (${Math.ceil(sizeBytes / 1024)} KB)`
          : filename;
      })
      .join(", ");
  }

  const metadata = objectRecord(row.metadata);
  const attachmentMetadata = arrayValue(metadata.attachmentSummary);

  if (attachmentMetadata.length === 0) {
    return "No attachments";
  }

  return `${attachmentMetadata.length} attachment${
    attachmentMetadata.length === 1 ? "" : "s"
  }`;
}

function reconnectHint(lastError: string | null) {
  if (!lastError) {
    return false;
  }

  return /auth|credential|grant|permission|reconnect|refresh|scope|token|401|403/i.test(
    lastError,
  );
}

function matchesSearch(row: OutboxRow, query: string) {
  if (!query) {
    return true;
  }

  const q = query.toLowerCase();
  const fields = [
    row.body_text,
    row.channel_type,
    row.id,
    row.idempotency_key,
    row.last_error,
    row.provider,
    row.recipient,
    row.service,
    row.source,
    row.status,
    row.subject,
  ];

  return fields.some((field) => field?.toLowerCase().includes(q));
}

function countsByStatus(rows: Array<{ status: string | null }>) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const status = textValue(row.status) ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return counts;
}

function countStatus(counts: Map<string, number>, status: string) {
  return counts.get(status) ?? 0;
}

function countActive(counts: Map<string, number>) {
  return ACTIVE_STATUSES.reduce(
    (total, status) => total + countStatus(counts, status),
    0,
  );
}

function returnTo({
  query,
  source,
  status,
}: {
  query: string;
  source: string;
  status: string;
}) {
  return outboxHref({ query, source, status });
}

function isMissingOutboxTableError(error: QueryError) {
  if (!error) {
    return false;
  }

  return (
    error.code === "PGRST205" ||
    /outbound_messages.*schema cache|Could not find the table/i.test(
      error.message ?? "",
    )
  );
}

function MissingOutboxTablePage() {
  return (
    <AppFrame active="Developer">
      <header className="topbar">
        <div>
          <p className="eyebrow">Developer</p>
          <h1>Outbox operations</h1>
        </div>
        <div className="row-actions">
          <Link className="secondary-button compact" href="/developer">
            Developer home
          </Link>
          <Link className="secondary-button compact" href="/settings?section=integrations">
            Connected accounts
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Setup required</p>
            <h2>Outbox table is not available yet</h2>
          </div>
        </div>
        <p className="panel-copy">
          The app code expects `public.outbound_messages`, but the connected
          Supabase project has not exposed it through the REST schema cache yet.
          Run the database migrations, then refresh this page.
        </p>
        <div className="detail-list">
          <div>
            <span>Migration command</span>
            <strong>npm run db:migrate</strong>
          </div>
          <div>
            <span>Expected table</span>
            <strong>public.outbound_messages</strong>
          </div>
        </div>
      </section>
    </AppFrame>
  );
}

function OutboxOperationActions({
  row,
  returnPath,
}: Readonly<{ row: OutboxRow; returnPath: string }>) {
  const canRetry = RETRYABLE_STATUSES.has(row.status);
  const canDismiss = RETRYABLE_STATUSES.has(row.status);

  if (!canRetry && !canDismiss) {
    return null;
  }

  return (
    <div className="outbox-operation-actions">
      {canRetry ? (
        <form action={retryOutboxDeliveryAction}>
          <input name="outboundQueueId" type="hidden" value={row.id} />
          <input name="returnTo" type="hidden" value={returnPath} />
          <button className="primary-button compact" type="submit">
            Retry now
          </button>
        </form>
      ) : null}
      {canDismiss ? (
        <form action={dismissOutboxDeliveryAction}>
          <input name="outboundQueueId" type="hidden" value={row.id} />
          <input name="returnTo" type="hidden" value={returnPath} />
          <button className="secondary-button compact" type="submit">
            Dismiss
          </button>
        </form>
      ) : null}
    </div>
  );
}

function OutboxRowCard({
  row,
  returnPath,
}: Readonly<{ row: OutboxRow; returnPath: string }>) {
  const providerLabel =
    [row.provider, row.service].filter(Boolean).join(" / ") || "Internal";

  return (
    <article className={`outbox-operation-row ${statusTone(row.status)}`}>
      <div className="outbox-operation-main">
        <div className="outbox-operation-title">
          <div>
            <p className="eyebrow">
              {formatLabel(row.channel_type)} - {formatLabel(providerLabel)}
            </p>
            <h2>{row.subject || row.recipient || "Outbound delivery"}</h2>
          </div>
          <span className={`pill outbox-status ${statusTone(row.status)}`}>
            {formatLabel(row.status)}
          </span>
        </div>

        <p className="outbox-preview">{preview(row.body_text)}</p>

        <div className="outbox-meta-line">
          <span>To {row.recipient ?? "No recipient"}</span>
          <span>{formatLabel(row.source)}</span>
          <span>Queued {formatDate(row.queued_at)}</span>
        </div>
      </div>

      <aside className="outbox-operation-side">
        <div>
          <span>Attempts</span>
          <strong>
            {row.attempt_count ?? 0} / {row.max_attempts ?? 3}
          </strong>
        </div>
        <div>
          <span>Next retry</span>
          <strong>{formatDate(row.next_attempt_at)}</strong>
        </div>
        <div>
          <span>Last update</span>
          <strong>{formatDate(row.updated_at)}</strong>
        </div>
        <OutboxOperationActions row={row} returnPath={returnPath} />
      </aside>

      {row.last_error ? (
        <div className="outbox-error-panel">
          <strong>Last error</strong>
          <p>{row.last_error}</p>
          {reconnectHint(row.last_error) ? (
            <Link className="pill link-pill" href="/settings?section=integrations">
              Check connected account
            </Link>
          ) : null}
        </div>
      ) : null}

      <details className="outbox-details">
        <summary>
          <span>Delivery details</span>
          <span>{compactUuid(row.id)}</span>
        </summary>
        <div className="outbox-detail-grid">
          <div>
            <span>Outbox id</span>
            <strong>{row.id}</strong>
          </div>
          <div>
            <span>Conversation</span>
            {row.conversation_id ? (
              <Link href={`/inbox?conversationId=${row.conversation_id}`}>
                {compactUuid(row.conversation_id)}
              </Link>
            ) : (
              <strong>-</strong>
            )}
          </div>
          <div>
            <span>Event</span>
            <strong>{compactUuid(row.event_id)}</strong>
          </div>
          <div>
            <span>Action</span>
            <strong>{compactUuid(row.action_id)}</strong>
          </div>
          <div>
            <span>Provider message</span>
            <strong>{row.provider_message_id ?? "-"}</strong>
          </div>
          <div>
            <span>Provider thread</span>
            <strong>{row.provider_thread_id ?? "-"}</strong>
          </div>
          <div>
            <span>Provider request</span>
            <strong>{row.provider_request_id ?? "-"}</strong>
          </div>
          <div>
            <span>Attachments</span>
            <strong>{attachmentSummary(row)}</strong>
          </div>
        </div>
      </details>
    </article>
  );
}

export default async function OutboxOperationsPage({
  searchParams,
}: OutboxPageProps) {
  const query = await searchParams;
  const status = isStatusFilter(query?.status) ? query.status : "active";
  const searchQuery = query?.q?.trim() ?? "";
  const source = query?.source?.trim() || "all";
  const { supabase, workspace } = await requireWorkspaceContext();
  let rowsQuery = supabase
    .from("outbound_messages")
    .select(
      "id,conversation_id,action_id,event_id,channel_type,provider,service,connection_id,recipient,subject,body_text,attachments,status,idempotency_key,source,attempt_count,max_attempts,next_attempt_at,queued_at,sending_at,sent_at,failed_at,provider_message_id,provider_thread_id,provider_request_id,last_error,metadata,created_at,updated_at",
    )
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(120);

  if (status === "active") {
    rowsQuery = rowsQuery.in("status", ACTIVE_STATUSES);
  } else if (status !== "all") {
    rowsQuery = rowsQuery.eq("status", status);
  }

  if (source !== "all") {
    rowsQuery = rowsQuery.eq("source", source);
  }

  const [rowsResult, countResult] = await Promise.all([
    rowsQuery,
    supabase
      .from("outbound_messages")
      .select("status,source")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (
    isMissingOutboxTableError(rowsResult.error) ||
    isMissingOutboxTableError(countResult.error)
  ) {
    return <MissingOutboxTablePage />;
  }

  if (rowsResult.error) {
    throw new Error(`Unable to load outbox operations: ${rowsResult.error.message}`);
  }

  if (countResult.error) {
    throw new Error(`Unable to load outbox counts: ${countResult.error.message}`);
  }

  const allCountRows = countResult.data ?? [];
  const counts = countsByStatus(allCountRows);
  const rows = ((rowsResult.data ?? []) as OutboxRow[]).filter((row) =>
    matchesSearch(row, searchQuery),
  );
  const sources = sourceOptions(allCountRows);
  const returnPath = returnTo({ query: searchQuery, source, status });

  return (
    <AppFrame active="Developer">
      <header className="topbar">
        <div>
          <p className="eyebrow">Developer</p>
          <h1>Outbox operations</h1>
        </div>
        <div className="row-actions">
          <Link className="secondary-button compact" href="/developer">
            Developer home
          </Link>
          <Link className="secondary-button compact" href="/settings?section=integrations">
            Connected accounts
          </Link>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}

      <section className="outbox-summary-strip" aria-label="Outbox summary">
        <div>
          <span>Active ops</span>
          <strong>{countActive(counts)}</strong>
        </div>
        <div>
          <span>Failed</span>
          <strong>{countStatus(counts, "failed")}</strong>
        </div>
        <div>
          <span>Retry scheduled</span>
          <strong>{countStatus(counts, "retry_scheduled")}</strong>
        </div>
        <div>
          <span>Sent</span>
          <strong>{countStatus(counts, "sent")}</strong>
        </div>
      </section>

      <section className="panel outbox-ops-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Operations</p>
            <h2>Delivery queue</h2>
          </div>
          <span className="pill">{rows.length} shown</span>
        </div>

        <form action="/developer/outbox" className="outbox-filter-form">
          <label>
            Search
            <input
              defaultValue={searchQuery}
              name="q"
              placeholder="Recipient, subject, error, provider..."
              type="search"
            />
          </label>
          <label>
            Status
            <select defaultValue={status} name="status">
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select defaultValue={source} name="source">
              <option value="all">All sources</option>
              {sources.map((item) => (
                <option key={item} value={item}>
                  {formatLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <div className="outbox-filter-actions">
            <button className="primary-button compact" type="submit">
              Apply
            </button>
            <Link className="secondary-button compact" href="/developer/outbox">
              Clear
            </Link>
          </div>
        </form>

        <div className="filter-row outbox-status-filters">
          {STATUS_FILTERS.map((filter) => {
            const href = outboxHref({
              query: searchQuery,
              source,
              status: filter.value,
            });
            const filterCount =
              filter.value === "active"
                ? countActive(counts)
                : filter.value === "all"
                  ? allCountRows.length
                  : countStatus(counts, filter.value);

            return (
              <Link
                className={`filter-pill ${
                  filter.value === status ? "active" : ""
                }`}
                href={href}
                key={filter.value}
              >
                {filter.label}
                <span>{filterCount}</span>
              </Link>
            );
          })}
        </div>

        <div className="outbox-operation-list">
          {rows.length > 0 ? (
            rows.map((row) => (
              <OutboxRowCard key={row.id} row={row} returnPath={returnPath} />
            ))
          ) : (
            <div className="empty-state">
              <h2>No outbound deliveries match this view.</h2>
              <p>
                Sent, failed, queued, and retry-scheduled deliveries will appear
                here once outbound email activity exists for this workspace.
              </p>
            </div>
          )}
        </div>
      </section>
    </AppFrame>
  );
}
