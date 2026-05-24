import { AppFrame } from "../components/app-frame";
import { getQuoteDraftList } from "../../lib/crm/queries";
import { getDocumentTemplateSettings } from "../../lib/documents/settings";
import {
  quoteTemplateCatalog,
  quoteTemplateOptions,
} from "../../lib/documents/templates";
import {
  quoteRevisionLabel,
  quoteRevisionState,
} from "../../lib/documents/revisions";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import Link from "next/link";

export const dynamic = "force-dynamic";

type DocumentsPageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
    filter?: string;
  }>;
};

const DOCUMENT_FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "sent", label: "Sent" },
  { value: "archived", label: "Archived" },
  { value: "linked", label: "Linked" },
  { value: "unlinked", label: "Unlinked" },
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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDocumentFilter(
  value: string | undefined,
): value is (typeof DOCUMENT_FILTERS)[number]["value"] {
  return DOCUMENT_FILTERS.some((filter) => filter.value === value);
}

function filterHref(filter: string) {
  return filter === "all" ? "/documents" : `/documents?filter=${filter}`;
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const [quoteDrafts, documentTemplateSettings] = await Promise.all([
    getQuoteDraftList(supabase, workspace.id),
    getDocumentTemplateSettings(supabase, workspace.id),
  ]);
  const activeFilter = isDocumentFilter(query?.filter) ? query.filter : "all";
  const filteredQuoteDrafts = quoteDrafts.filter((quoteDraft) => {
    if (activeFilter === "all") {
      return true;
    }

    if (activeFilter === "linked") {
      return Boolean(quoteDraft.conversation || quoteDraft.lead || quoteDraft.contact);
    }

    if (activeFilter === "unlinked") {
      return !quoteDraft.conversation && !quoteDraft.lead && !quoteDraft.contact;
    }

    return quoteDraft.status === activeFilter;
  });
  const filterCounts = new Map(
    DOCUMENT_FILTERS.map((filter) => [
      filter.value,
      filter.value === "all"
        ? quoteDrafts.length
        : filter.value === "linked"
          ? quoteDrafts.filter((quote) => quote.conversation || quote.lead || quote.contact).length
          : filter.value === "unlinked"
            ? quoteDrafts.filter((quote) => !quote.conversation && !quote.lead && !quote.contact).length
            : quoteDrafts.filter((quote) => quote.status === filter.value).length,
    ]),
  );
  const draftCount = quoteDrafts.filter((quote) => quote.status === "draft").length;
  const readyCount = quoteDrafts.filter((quote) => quote.status === "ready").length;
  const approvedCount = quoteDrafts.filter((quote) => quote.status === "approved").length;
  const templates = quoteTemplateOptions(
    quoteTemplateCatalog(documentTemplateSettings.customTemplates),
  );

  return (
    <AppFrame active="Documents">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Documents</h1>
        </div>
        <div className="topbar-right">
          <section className="metric-grid" aria-label="Document metrics">
            <article className="metric-card cyan">
              <p>Total</p>
              <strong>{quoteDrafts.length}</strong>
              <span>Quote drafts</span>
            </article>
            <article className="metric-card purple">
              <p>Draft</p>
              <strong>{draftCount}</strong>
              <span>Being edited</span>
            </article>
            <article className="metric-card pink">
              <p>Ready</p>
              <strong>{readyCount}</strong>
              <span>{approvedCount} customer-approved</span>
            </article>
          </section>
        </div>
      </header>

      {query?.engine_error ? <p className="form-alert error">{query.engine_error}</p> : null}
      {query?.engine_message ? <p className="form-alert">{query.engine_message}</p> : null}

      <section className="document-grid">
        <article className="panel page-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Quotes</p>
              <h2>Draft documents</h2>
            </div>
            <span className="pill">{filteredQuoteDrafts.length} shown</span>
          </div>

          <nav className="filter-bar" aria-label="Document filters">
            {DOCUMENT_FILTERS.map((filter) => (
              <Link
                className={activeFilter === filter.value ? "filter-pill active" : "filter-pill"}
                href={filterHref(filter.value)}
                key={filter.value}
                prefetch={false}
              >
                {filter.label}
                <span>{filterCounts.get(filter.value) ?? 0}</span>
              </Link>
            ))}
          </nav>

          <div className="data-list">
            {filteredQuoteDrafts.length > 0 ? (
              filteredQuoteDrafts.map((quoteDraft) => {
                const metadataCustomer =
                  textValue(quoteDraft.metadata.customerName) ??
                  textValue(quoteDraft.metadata.customerCompany);
                const customer =
                  quoteDraft.contact?.name ??
                  quoteDraft.contact?.company ??
                  metadataCustomer ??
                  "No customer yet";
                const jobType =
                  quoteDraft.inquiryFacts?.jobType ??
                  quoteDraft.lead?.serviceType ??
                  textValue(quoteDraft.metadata.jobType) ??
                  "Quote draft";
                const revisionState = quoteRevisionState(quoteDraft.metadata);
                const revisionLabel = quoteRevisionLabel(quoteDraft.metadata);

                return (
                  <Link
                    className="data-row document-row"
                    href={`/documents/${quoteDraft.id}`}
                    key={quoteDraft.id}
                    prefetch={false}
                  >
                    <div className="data-main">
                      <strong>{quoteDraft.title}</strong>
                      <span>
                        {customer} - {jobType}
                      </span>
                      {quoteDraft.notes ? (
                        <p className="body-preview">{quoteDraft.notes}</p>
                      ) : null}
                    </div>
                    <div className="data-meta">
                      <span className="pill">{revisionLabel}</span>
                      <span className="pill">{formatLabel(quoteDraft.status)}</span>
                      {revisionState.pendingChangeRequest ? (
                        <span className="pill warning">Changes requested</span>
                      ) : null}
                      <span>{quoteDraft.lineItemCount} line items</span>
                      {quoteDraft.conversation ? (
                        <span>{formatLabel(quoteDraft.conversation.status)}</span>
                      ) : null}
                      <span>{formatDate(quoteDraft.updatedAt)}</span>
                    </div>
                  </Link>
                );
              })
            ) : (
              <p className="empty-copy">
                {quoteDrafts.length > 0 ? "No quote drafts match this view." : "No quote drafts yet."}
              </p>
            )}
          </div>
        </article>

        <aside className="side-stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Templates</p>
                <h2>Start a quote</h2>
              </div>
              <Link
                className="secondary-button compact link-button"
                href="/documents/templates/new"
                prefetch={false}
              >
                Create template
              </Link>
            </div>

            <div className="template-grid">
              {templates.length > 0 ? (
                templates.map((template) => (
                  <div className="template-card template-card-compact" key={template.key}>
                    <div>
                      <strong>{template.label}</strong>
                      <span>{template.description}</span>
                    </div>
                    <div className="template-card-actions">
                      <Link
                        className="secondary-button compact link-button"
                        href={`/documents/new?templateKey=${encodeURIComponent(template.key)}`}
                        prefetch={false}
                      >
                        Create draft
                      </Link>
                      <Link
                        className="secondary-button compact link-button"
                        href={`/documents/templates/${encodeURIComponent(template.key)}`}
                        prefetch={false}
                      >
                        View/edit
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="template-card empty-template-card">
                  <div>
                    <strong>No templates yet</strong>
                    <span>Create your first reusable quote template before starting drafts from templates.</span>
                  </div>
                </div>
              )}
            </div>
          </article>
        </aside>
      </section>
    </AppFrame>
  );
}
