import { AppFrame } from "../../components/app-frame";
import {
  getQuoteDraftProfile,
} from "../../../lib/crm/queries";
import {
  normalizeQuoteLineItems,
} from "../../../lib/documents/templates";
import {
  quoteDocumentChangedSinceLastEvent,
  quoteDocumentContentHash,
  quoteDocumentHistory,
  type QuoteDocumentHistoryEvent,
} from "../../../lib/documents/history";
import {
  quoteRevisionLabel,
  quoteRevisionState,
} from "../../../lib/documents/revisions";
import { getGeneratedDocumentsForQuoteDraft } from "../../../lib/documents/generated-documents";
import {
  getLatestQuoteApprovalLinkForDraft,
  isQuoteApprovalLinkExpired,
  quoteApprovalPublicUrl,
} from "../../../lib/documents/approval";
import {
  documentTemplateDesignSettingsForQuote,
  getDocumentTemplateSettings,
} from "../../../lib/documents/settings";
import { requireWorkspaceContext } from "../../../lib/workspace/context";
import { QuoteDraftEditorForm } from "./quote-draft-editor-form";
import {
  createQuoteApprovalLinkAction,
  fileGeneratedDocumentToDriveAction,
  generateInvoiceDocumentAction,
  prepareQuoteDraftSendAction,
} from "../actions";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type QuoteDraftPageProps = {
  params: Promise<{
    quoteDraftId: string;
  }>;
  searchParams?: Promise<{
    approval_token?: string;
    engine_error?: string;
    engine_message?: string;
  }>;
};

const QUOTE_STATUS_OPTIONS = [
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes requested" },
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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeQuoteStatus(status: string) {
  return QUOTE_STATUS_OPTIONS.some((option) => option.value === status)
    ? status
    : "draft";
}

function documentEventLabel(event: QuoteDocumentHistoryEvent) {
  if (event.kind === "customer_approved") {
    return "Customer approved";
  }

  if (event.kind === "customer_changes_requested") {
    return "Customer requested changes";
  }

  if (event.kind === "customer_viewed") {
    return "Customer viewed";
  }

  if (event.kind === "email_sent") {
    return "Sent to customer";
  }

  if (event.kind === "email_prepared") {
    return "Email prepared";
  }

  return "PDF generated";
}

function documentEventMeta(event: QuoteDocumentHistoryEvent) {
  const details = [
    event.quoteVersion ? `v${event.quoteVersion}` : null,
    event.sentTo ? `to ${event.sentTo}` : null,
    event.channelType ? formatLabel(event.channelType) : null,
  ].filter(Boolean);

  return details.join(" - ") || textValue(event.source) || "Kyro document";
}

export default async function QuoteDraftPage({
  params,
  searchParams,
}: QuoteDraftPageProps) {
  const [{ quoteDraftId }, query] = await Promise.all([params, searchParams]);
  const { supabase, workspace } = await requireWorkspaceContext();
  const [profile, documentTemplateSettings] = await Promise.all([
    getQuoteDraftProfile(supabase, workspace.id, quoteDraftId),
    getDocumentTemplateSettings(supabase, workspace.id),
  ]);

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
  const attachToReplyHref = quoteDraft.conversation
    ? `/inbox/${quoteDraft.conversation.id}?attachQuoteDraftId=${quoteDraft.id}`
    : null;
  const lastGeneratedDocument = metadata.lastGeneratedDocument &&
    typeof metadata.lastGeneratedDocument === "object" &&
    !Array.isArray(metadata.lastGeneratedDocument)
    ? (metadata.lastGeneratedDocument as Record<string, unknown>)
    : null;
  const history = quoteDocumentHistory(metadata);
  const documentSettings = documentTemplateDesignSettingsForQuote(
    metadata,
    documentTemplateSettings,
  );
  const currentContentHash = quoteDocumentContentHash({
    profile,
    settings: documentSettings,
  });
  const documentFreshness = quoteDocumentChangedSinceLastEvent({
    currentContentHash,
    history,
  });
  const revisionState = quoteRevisionState(metadata);
  const revisionLabel = quoteRevisionLabel(metadata);
  const revisionNeedsEdit =
    quoteDraft.status === "changes_requested" ||
    Boolean(revisionState.pendingChangeRequest);
  const latestDocumentEvent = documentFreshness.latest;
  const [approvalLink, generatedDocuments] = await Promise.all([
    getLatestQuoteApprovalLinkForDraft(supabase, {
      quoteDraftId: quoteDraft.id,
      workspaceId: workspace.id,
    }),
    getGeneratedDocumentsForQuoteDraft(supabase, workspace.id, quoteDraft.id),
  ]);
  const approvalUrl = query?.approval_token
    ? quoteApprovalPublicUrl(query.approval_token)
    : null;
  const approvalExpired = approvalLink
    ? isQuoteApprovalLinkExpired(approvalLink)
    : false;

  return (
    <AppFrame active="Files">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>{quoteDraft.title}</h1>
        </div>
        <div className="topbar-actions">
          {quoteDraft.conversation && !revisionNeedsEdit ? (
            <form action={prepareQuoteDraftSendAction}>
              <input name="quoteDraftId" type="hidden" value={quoteDraft.id} />
              <button className="primary-button link-button" type="submit">
                {revisionState.currentVersion > 1
                  ? "Send revised quote"
                  : "Send to customer"}
              </button>
            </form>
          ) : null}
          {attachToReplyHref ? (
            <Link
              className="secondary-button link-button"
              href={attachToReplyHref}
              prefetch={false}
            >
              Attach to reply
            </Link>
          ) : null}
          <form action={generateInvoiceDocumentAction}>
            <input name="quoteDraftId" type="hidden" value={quoteDraft.id} />
            <button className="secondary-button link-button" type="submit">
              Generate invoice
            </button>
          </form>
          <Link
            className="primary-button link-button"
            href={`/files/${quoteDraft.id}/pdf`}
            prefetch={false}
          >
            Download PDF
          </Link>
          <Link
            className="secondary-button link-button"
            href={`/files/${quoteDraft.id}/print`}
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Print / PDF
          </Link>
          {quoteDraft.conversation ? (
            <Link
              className="secondary-button link-button"
              href={`/inbox/${quoteDraft.conversation.id}`}
              prefetch={false}
            >
              Open inquiry
            </Link>
          ) : null}
          <Link className="secondary-button link-button" href="/files" prefetch>
            Back to files
          </Link>
        </div>
      </header>

      {query?.engine_error ? <p className="form-alert error">{query.engine_error}</p> : null}
      {query?.engine_message ? <p className="form-alert">{query.engine_message}</p> : null}
      {revisionNeedsEdit ? (
        <section className="form-alert error">
          Customer requested changes to {revisionLabel}. Review the note, edit
          the quote, then send a revised quote with a fresh approval link.
        </section>
      ) : null}

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
            {lastGeneratedDocument ? (
              <span>
                PDF generated {formatDate(textValue(lastGeneratedDocument.generatedAt))}
              </span>
            ) : null}
          </div>
        </article>

        <article className="panel inquiry-summary-card">
          <div className="summary-title">
            <div>
              <p className="eyebrow">Documents</p>
              <h2>Version history</h2>
            </div>
            {latestDocumentEvent ? (
              <span
                className={
                  documentFreshness.changed ? "pill warning" : "pill success"
                }
              >
                {documentFreshness.changed ? "Changed since PDF" : "Up to date"}
              </span>
            ) : (
              <span className="pill warning">No PDF yet</span>
            )}
          </div>
          {latestDocumentEvent ? (
            <div className="summary-fields">
              <span>
                Current {revisionLabel}
                {revisionState.pendingChangeRequest
                  ? ` - changes requested from v${revisionState.pendingChangeRequest.requestedFromVersion}`
                  : ""}
              </span>
              <span>
                Latest: {documentEventLabel(latestDocumentEvent)}{" "}
                {formatDate(latestDocumentEvent.occurredAt)}
              </span>
              <span>
                {documentFreshness.changed
                  ? "Regenerate or prepare a fresh email before sending."
                  : "Latest generated document matches the current quote."}
              </span>
            </div>
          ) : (
            <p className="empty-copy">
              Current {revisionLabel}. Download or prepare a quote email to
              create the first document history entry.
            </p>
          )}
          {revisionState.pendingChangeRequest?.message ? (
            <p className="empty-copy">
              Requested change: {revisionState.pendingChangeRequest.message}
            </p>
          ) : null}
          {history.length > 0 ? (
            <div className="engine-list compact-history-list">
              {history.slice(0, 4).map((event) => (
                <div className="engine-row compact-history-row" key={event.id}>
                  <div>
                    <strong>{documentEventLabel(event)}</strong>
                    <span>{documentEventMeta(event)}</span>
                  </div>
                  <span>{formatDate(event.occurredAt)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <article className="panel inquiry-summary-card">
          <div className="summary-title">
            <div>
              <p className="eyebrow">Files</p>
              <h2>Saved PDFs</h2>
            </div>
            <span className="pill">{generatedDocuments.length} records</span>
          </div>
          {generatedDocuments.length > 0 ? (
            <div className="engine-list compact-history-list">
              {generatedDocuments.slice(0, 5).map((document) => (
                <div className="engine-row compact-history-row" key={document.id}>
                  <div>
                    <strong>{formatLabel(document.documentType)}</strong>
                    <span>
                      {formatLabel(document.lifecycleStatus)} -{" "}
                      {document.documentVersion ?? "v1"} -{" "}
                      {formatDate(document.updatedAt)}
                    </span>
                  </div>
                  <div className="template-card-actions">
                    {document.fileId ? (
                      <Link
                        className="secondary-button compact link-button"
                        href={`/api/files/${document.fileId}`}
                        prefetch={false}
                      >
                        Download
                      </Link>
                    ) : null}
                    {document.googleDriveWebUrl ? (
                      <Link
                        className="secondary-button compact link-button"
                        href={document.googleDriveWebUrl}
                        prefetch={false}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Drive
                      </Link>
                    ) : (
                      <form action={fileGeneratedDocumentToDriveAction}>
                        <input
                          name="generatedDocumentId"
                          type="hidden"
                          value={document.id}
                        />
                        <input name="quoteDraftId" type="hidden" value={quoteDraft.id} />
                        <button className="secondary-button compact" type="submit">
                          File
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-copy">
              Download, send, or generate an invoice to create the first saved PDF.
            </p>
          )}
        </article>

        <article className="panel inquiry-summary-card">
          <div className="summary-title">
            <div>
              <p className="eyebrow">Customer approval</p>
              <h2>
                {approvalLink
                  ? formatLabel(approvalExpired ? "expired" : approvalLink.status)
                  : "No approval link"}
              </h2>
            </div>
            {approvalLink ? (
              <span
                className={
                  approvalLink.status === "approved"
                    ? "pill success"
                    : approvalLink.status === "changes_requested" || approvalExpired
                      ? "pill warning"
                      : "pill"
                }
              >
                {approvalExpired ? "Expired" : formatLabel(approvalLink.status)}
              </span>
            ) : (
              <span className="pill warning">Not shared</span>
            )}
          </div>
          {approvalUrl ? (
            <div className="approval-copy-box">
              <label>
                New approval link
                <input readOnly value={approvalUrl} />
              </label>
              <p>
                This is the customer-facing link for this quote. It will only be
                shown here immediately after creation; generate a new link if you
                need to copy it again later.
              </p>
            </div>
          ) : (
            <div className="summary-fields">
              {approvalLink?.customerEmail ? (
                <span>{approvalLink.customerEmail}</span>
              ) : null}
              {approvalLink?.viewedAt ? (
                <span>Viewed {formatDate(approvalLink.viewedAt)}</span>
              ) : (
                <span>Not viewed yet</span>
              )}
              {approvalLink?.approvedAt ? (
                <span>Approved {formatDate(approvalLink.approvedAt)}</span>
              ) : null}
              {approvalLink?.changesRequestedAt ? (
                <span>
                  Changes requested {formatDate(approvalLink.changesRequestedAt)}
                </span>
              ) : null}
              {approvalLink?.lastChangeRequest ? (
                <span>{approvalLink.lastChangeRequest}</span>
              ) : null}
            </div>
          )}
          <form action={createQuoteApprovalLinkAction}>
            <input name="quoteDraftId" type="hidden" value={quoteDraft.id} />
            <button className="secondary-button compact" type="submit">
              {approvalLink ? "Generate fresh link" : "Create approval link"}
            </button>
          </form>
        </article>
      </section>

      <section className="review-grid document-editor-only">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Editor</p>
              <h2>Quote draft</h2>
            </div>
            <span className="pill">{lineItems.length} line items</span>
          </div>

          <QuoteDraftEditorForm
            customer={{
              company: customerCompany,
              email: customerEmail,
              jobAddress,
              name: customerName,
              phone: customerPhone,
            }}
            initialContact={quoteDraft.contact}
            jobType={jobType}
            lineItems={lineItems}
            notes={quoteDraft.notes ?? ""}
            preferredTime={preferredTime}
            quoteDraftId={quoteDraft.id}
            status={safeQuoteStatus(quoteDraft.status)}
            statusOptions={QUOTE_STATUS_OPTIONS}
            title={quoteDraft.title}
          />
        </article>
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
