import {
  applyQuoteTemplateAction,
  updateQuoteDraftAction,
} from "../actions";
import { AppFrame } from "../../components/app-frame";
import { getQuoteDraftProfile } from "../../../lib/crm/queries";
import {
  lineItemsToEditorText,
  normalizeQuoteLineItems,
  quoteTemplateOptions,
} from "../../../lib/documents/templates";
import { requireWorkspaceContext } from "../../../lib/workspace/context";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type QuoteDraftPageProps = {
  params: Promise<{
    quoteDraftId: string;
  }>;
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
  }>;
};

const QUOTE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "sent", label: "Sent" },
  { value: "archived", label: "Archived" },
] as const;

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
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeQuoteStatus(status: string) {
  return QUOTE_STATUS_OPTIONS.some((option) => option.value === status)
    ? status
    : "draft";
}

export default async function QuoteDraftPage({
  params,
  searchParams,
}: QuoteDraftPageProps) {
  const [{ quoteDraftId }, query] = await Promise.all([params, searchParams]);
  const { supabase, workspace } = await requireWorkspaceContext();
  const profile = await getQuoteDraftProfile(
    supabase,
    workspace.id,
    quoteDraftId,
  );

  if (!profile) {
    notFound();
  }

  const quoteDraft = profile.quoteDraft;
  const metadata = quoteDraft.metadata;
  const lineItems = normalizeQuoteLineItems(quoteDraft.lineItems);
  const customerName =
    textValue(metadata.customerName) ??
    quoteDraft.contact?.name ??
    quoteDraft.contact?.company ??
    "";
  const customerCompany =
    textValue(metadata.customerCompany) ??
    quoteDraft.contact?.company ??
    "";
  const customerEmail =
    textValue(metadata.customerEmail) ?? quoteDraft.contact?.email ?? "";
  const customerPhone =
    textValue(metadata.customerPhone) ?? quoteDraft.contact?.phone ?? "";
  const jobType =
    textValue(metadata.jobType) ??
    profile.inquiryFacts?.jobType ??
    quoteDraft.lead?.serviceType ??
    "";
  const jobAddress =
    textValue(metadata.jobAddress) ?? profile.inquiryFacts?.address ?? "";
  const preferredTime =
    textValue(metadata.preferredTime) ??
    profile.inquiryFacts?.preferredTime ??
    "";
  const subtotal = lineItems.reduce(
    (sum, item) => sum + (item.total ?? 0),
    0,
  );
  const attachToReplyHref = quoteDraft.conversation
    ? `/inbox/${quoteDraft.conversation.id}?attachQuoteDraftId=${quoteDraft.id}`
    : null;

  return (
    <AppFrame active="Documents">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>{quoteDraft.title}</h1>
        </div>
        <div className="topbar-actions">
          {attachToReplyHref ? (
            <Link
              className="primary-button link-button"
              href={attachToReplyHref}
              prefetch={false}
            >
              Attach to reply
            </Link>
          ) : null}
          {quoteDraft.conversation ? (
            <Link
              className="secondary-button link-button"
              href={`/inbox/${quoteDraft.conversation.id}`}
              prefetch={false}
            >
              Open inquiry
            </Link>
          ) : null}
          <Link className="secondary-button link-button" href="/documents" prefetch>
            Back to documents
          </Link>
        </div>
      </header>

      {query?.engine_error ? <p className="form-alert error">{query.engine_error}</p> : null}
      {query?.engine_message ? <p className="form-alert">{query.engine_message}</p> : null}

      <section className="document-summary-grid">
        <article className="panel inquiry-summary-card">
          <div className="summary-title">
            <div>
              <p className="eyebrow">Customer</p>
              <h2>{customerName || customerCompany || "Not set"}</h2>
            </div>
            {quoteDraft.contact ? (
              <Link
                className="pill plain-link"
                href={`/contacts/${quoteDraft.contact.id}`}
                prefetch={false}
              >
                Profile
              </Link>
            ) : (
              <span className="pill warning">Manual</span>
            )}
          </div>
          <div className="summary-fields">
            <span>{customerEmail || "No email"}</span>
            <span>{customerPhone || "No phone"}</span>
            <span>{customerCompany || "No company"}</span>
          </div>
        </article>

        <article className="panel inquiry-summary-card">
          <div className="summary-title">
            <div>
              <p className="eyebrow">Job</p>
              <h2>{jobType || quoteDraft.lead?.title || "No job type"}</h2>
            </div>
            <span className="pill">{formatLabel(quoteDraft.status)}</span>
          </div>
          <div className="summary-fields">
            <span>{jobAddress || "No address"}</span>
            <span>{preferredTime || "No preferred time"}</span>
            <span>Updated {formatDate(quoteDraft.updatedAt)}</span>
          </div>
        </article>
      </section>

      <section className="review-grid large-left">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Editor</p>
              <h2>Quote draft</h2>
            </div>
            <span className="pill">{lineItems.length} line items</span>
          </div>

          <form action={updateQuoteDraftAction} className="document-editor-form">
            <input name="quoteDraftId" type="hidden" value={quoteDraft.id} />
            <div className="document-form-grid">
              <label>
                Title
                <input name="title" required type="text" defaultValue={quoteDraft.title} />
              </label>
              <label>
                Status
                <select name="status" defaultValue={safeQuoteStatus(quoteDraft.status)}>
                  {QUOTE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Customer name
                <input name="customerName" type="text" defaultValue={customerName} />
              </label>
              <label>
                Company
                <input name="customerCompany" type="text" defaultValue={customerCompany} />
              </label>
              <label>
                Email
                <input name="customerEmail" type="email" defaultValue={customerEmail} />
              </label>
              <label>
                Phone
                <input name="customerPhone" type="tel" defaultValue={customerPhone} />
              </label>
              <label>
                Job type
                <input name="jobType" type="text" defaultValue={jobType} />
              </label>
              <label>
                Preferred time
                <input name="preferredTime" type="text" defaultValue={preferredTime} />
              </label>
              <label className="full-row">
                Job address
                <input name="jobAddress" type="text" defaultValue={jobAddress} />
              </label>
              <label className="full-row">
                Line items
                <textarea
                  className="line-items-editor"
                  defaultValue={lineItemsToEditorText(quoteDraft.lineItems)}
                  name="lineItemsText"
                  placeholder="Description | Qty | Unit | Unit price | Notes"
                  rows={9}
                />
              </label>
              <label className="full-row">
                Notes
                <textarea name="notes" defaultValue={quoteDraft.notes ?? ""} rows={5} />
              </label>
            </div>
            <button className="primary-button profile-submit" type="submit">
              Save quote draft
            </button>
          </form>
        </article>

        <aside className="side-stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Templates</p>
                <h2>Apply structure</h2>
              </div>
            </div>
            <div className="template-grid compact-template-grid">
              {quoteTemplateOptions().map((template) => (
                <form
                  action={applyQuoteTemplateAction}
                  className="template-card"
                  key={template.key}
                >
                  <input name="quoteDraftId" type="hidden" value={quoteDraft.id} />
                  <input name="templateKey" type="hidden" value={template.key} />
                  <div>
                    <strong>{template.label}</strong>
                    <span>{template.description}</span>
                  </div>
                  <button className="secondary-button compact" type="submit">
                    Apply
                  </button>
                </form>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Preview</p>
                <h2>Saved draft</h2>
              </div>
            </div>
            <div className="document-preview">
              <div>
                <strong>{quoteDraft.title}</strong>
                <span>{customerName || customerCompany || "Customer not set"}</span>
              </div>
              <div className="quote-preview-table">
                {lineItems.length > 0 ? (
                  lineItems.map((item, index) => (
                    <div className="quote-preview-row" key={`${item.description}-${index}`}>
                      <span>{item.description}</span>
                      <span>
                        {[item.quantity, item.unit].filter(Boolean).join(" ") || "-"}
                      </span>
                      <strong>{formatMoney(item.total)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">No line items saved.</p>
                )}
              </div>
              <div className="quote-preview-total">
                <span>Subtotal</span>
                <strong>{subtotal > 0 ? formatMoney(subtotal) : "-"}</strong>
              </div>
              {quoteDraft.notes ? <p>{quoteDraft.notes}</p> : null}
            </div>
          </article>
        </aside>
      </section>

      <section className="review-grid operations-grid">
        <details className="panel disclosure-panel">
          <summary>
            <div>
              <p className="eyebrow">Comms</p>
              <h2>Linked messages</h2>
            </div>
            <span className="pill">{profile.messages.length} messages</span>
          </summary>
          <div className="message-list disclosure-content">
            {profile.messages.length > 0 ? (
              profile.messages.map((message) => (
                <div
                  className={
                    message.direction === "outbound"
                      ? "message-row outbound"
                      : "message-row inbound"
                  }
                  key={message.id}
                >
                  <div className="message-meta">
                    <strong>{formatLabel(message.direction)}</strong>
                    <span>
                      {formatDate(
                        message.receivedAt ?? message.sentAt ?? message.createdAt,
                      )}
                    </span>
                  </div>
                  {message.subject ? <h3>{message.subject}</h3> : null}
                  <p>{message.bodyText ?? "No message body."}</p>
                </div>
              ))
            ) : (
              <p className="empty-copy">No messages linked to this quote draft.</p>
            )}
          </div>
        </details>

        <details className="panel disclosure-panel">
          <summary>
            <div>
              <p className="eyebrow">Audit</p>
              <h2>History</h2>
            </div>
            <span className="pill">{profile.auditLogs.length} logs</span>
          </summary>
          <div className="engine-list disclosure-content">
            {profile.auditLogs.length > 0 ? (
              profile.auditLogs.map((log) => (
                <div className="engine-row" key={log.id}>
                  <div>
                    <strong>{log.action}</strong>
                    <span>
                      {log.actorType} - {log.entityType} - {formatDate(log.createdAt)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-copy">No audit history linked to this quote draft.</p>
            )}
          </div>
        </details>
      </section>
    </AppFrame>
  );
}
