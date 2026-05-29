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
import { getGeneratedDocumentsForWorkspace } from "../../lib/documents/generated-documents";
import {
  getWorkspaceFileLibrary,
  type WorkspaceFileLibraryItem,
} from "../../lib/files/library";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { fileGeneratedDocumentToDriveAction } from "./actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

type DocumentsPageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
    fileFilter?: string;
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

const FILE_FILTERS = [
  { value: "all", label: "All" },
  { value: "generated", label: "Generated" },
  { value: "upload", label: "Uploaded" },
  { value: "image", label: "Images" },
  { value: "document", label: "Documents" },
  { value: "email", label: "Email" },
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

function formatFileSize(value: number | null) {
  if (!value || value <= 0) {
    return "-";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }

  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDocumentFilter(
  value: string | undefined,
): value is (typeof DOCUMENT_FILTERS)[number]["value"] {
  return DOCUMENT_FILTERS.some((filter) => filter.value === value);
}

function isFileFilter(
  value: string | undefined,
): value is (typeof FILE_FILTERS)[number]["value"] {
  return FILE_FILTERS.some((filter) => filter.value === value);
}

function filesHref({
  fileFilter,
  quoteFilter,
}: {
  fileFilter?: string;
  quoteFilter?: string;
}) {
  const params = new URLSearchParams();

  if (quoteFilter && quoteFilter !== "all") {
    params.set("filter", quoteFilter);
  }

  if (fileFilter && fileFilter !== "all") {
    params.set("fileFilter", fileFilter);
  }

  const query = params.toString();

  return query ? `/files?${query}` : "/files";
}

function canPreviewInline(file: WorkspaceFileLibraryItem) {
  return (
    file.contentType?.startsWith("image/") ||
    file.contentType === "application/pdf"
  );
}

function isGeneratedFile(file: WorkspaceFileLibraryItem) {
  return file.kind === "generated" || file.source.startsWith("generated_");
}

function isUploadedFile(file: WorkspaceFileLibraryItem) {
  return file.kind === "upload" || file.source.includes("upload");
}

function isImageFile(file: WorkspaceFileLibraryItem) {
  return file.contentType?.startsWith("image/") ?? false;
}

function matchesFileFilter(
  file: WorkspaceFileLibraryItem,
  filter: (typeof FILE_FILTERS)[number]["value"],
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "generated") {
    return isGeneratedFile(file);
  }

  if (filter === "upload") {
    return isUploadedFile(file);
  }

  if (filter === "image") {
    return isImageFile(file);
  }

  return file.kind === filter;
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const [
    quoteDrafts,
    documentTemplateSettings,
    generatedDocuments,
    fileLibrary,
  ] = await Promise.all([
    getQuoteDraftList(supabase, workspace.id),
    getDocumentTemplateSettings(supabase, workspace.id),
    getGeneratedDocumentsForWorkspace(supabase, workspace.id, 12),
    getWorkspaceFileLibrary(workspace.id, 80),
  ]);
  const activeFilter = isDocumentFilter(query?.filter) ? query.filter : "all";
  const activeFileFilter = isFileFilter(query?.fileFilter)
    ? query.fileFilter
    : "all";
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
  const filteredFiles = fileLibrary.filter((file) => {
    return matchesFileFilter(file, activeFileFilter);
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
  const fileFilterCounts = new Map(
    FILE_FILTERS.map((filter) => [
      filter.value,
      fileLibrary.filter((file) => matchesFileFilter(file, filter.value))
        .length,
    ]),
  );
  const draftCount = quoteDrafts.filter((quote) => quote.status === "draft").length;
  const readyCount = quoteDrafts.filter((quote) => quote.status === "ready").length;
  const invoiceDocumentCount = generatedDocuments.filter(
    (document) => document.documentType === "invoice",
  ).length;
  const generatedFileCount = fileFilterCounts.get("generated") ?? 0;
  const uploadFileCount = fileFilterCounts.get("upload") ?? 0;
  const templates = quoteTemplateOptions(
    quoteTemplateCatalog(documentTemplateSettings.customTemplates),
  );

  return (
    <AppFrame active="Files">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Files</h1>
        </div>
        <div className="topbar-right">
          <section className="metric-grid" aria-label="File metrics">
            <article className="metric-card cyan">
              <p>Files</p>
              <strong>{fileLibrary.length}</strong>
              <span>Saved assets</span>
            </article>
            <article className="metric-card purple">
              <p>Quotes</p>
              <strong>{draftCount}</strong>
              <span>{readyCount} ready</span>
            </article>
            <article className="metric-card pink">
              <p>Generated</p>
              <strong>{generatedFileCount}</strong>
              <span>{uploadFileCount} uploads</span>
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
              <p className="eyebrow">Library</p>
              <h2>Generated and uploaded files</h2>
            </div>
            <span className="pill">{filteredFiles.length} shown</span>
          </div>

          <nav className="filter-bar" aria-label="File filters">
            {FILE_FILTERS.map((filter) => (
              <Link
                className={
                  activeFileFilter === filter.value
                    ? "filter-pill active"
                    : "filter-pill"
                }
                href={filesHref({
                  fileFilter: filter.value,
                  quoteFilter: activeFilter,
                })}
                key={filter.value}
                prefetch={false}
              >
                {filter.label}
                <span>{fileFilterCounts.get(filter.value) ?? 0}</span>
              </Link>
            ))}
          </nav>

          <div className="file-library-list">
            {filteredFiles.length > 0 ? (
              filteredFiles.map((file) => (
                <div className="file-library-row" key={file.id}>
                  <div className="file-kind-token" aria-hidden="true">
                    {file.kind === "image" ? "IMG" : file.kind.toUpperCase()}
                  </div>
                  <div className="file-library-main">
                    <strong>{file.filename}</strong>
                    <span>
                      {file.sourceLabel} - {formatFileSize(file.sizeBytes)} -{" "}
                      {formatDate(file.createdAt)}
                    </span>
                  </div>
                  <div className="file-library-actions">
                    {canPreviewInline(file) ? (
                      <Link
                        className="secondary-button compact link-button"
                        href={file.inlineHref}
                        prefetch={false}
                        target="_blank"
                      >
                        Open
                      </Link>
                    ) : null}
                    <Link
                      className="secondary-button compact link-button"
                      href={file.downloadHref}
                      prefetch={false}
                    >
                      Download
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-copy">
                {fileLibrary.length > 0
                  ? "No files match this view."
                  : "Generated images, PDFs, inbound attachments, and uploaded files will appear here."}
              </p>
            )}
          </div>
        </article>

        <aside className="side-stack">
          <article className="panel">
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
                  className={
                    activeFilter === filter.value
                      ? "filter-pill active"
                      : "filter-pill"
                  }
                  href={filesHref({
                    fileFilter: activeFileFilter,
                    quoteFilter: filter.value,
                  })}
                  key={filter.value}
                  prefetch={false}
                >
                  {filter.label}
                  <span>{filterCounts.get(filter.value) ?? 0}</span>
                </Link>
              ))}
            </nav>

            <div className="engine-list compact-history-list">
              {filteredQuoteDrafts.length > 0 ? (
                filteredQuoteDrafts.slice(0, 8).map((quoteDraft) => {
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
                      className="engine-row compact-history-row"
                      href={`/files/${quoteDraft.id}`}
                      key={quoteDraft.id}
                      prefetch={false}
                    >
                      <div>
                        <strong>{quoteDraft.title}</strong>
                        <span>
                          {customer} - {jobType} -{" "}
                          {formatLabel(quoteDraft.status)}
                        </span>
                        {revisionState.pendingChangeRequest ? (
                          <span>Changes requested</span>
                        ) : (
                          <span>{revisionLabel}</span>
                        )}
                      </div>
                      <span>{formatDate(quoteDraft.updatedAt)}</span>
                    </Link>
                  );
                })
              ) : (
                <p className="empty-copy">
                  {quoteDrafts.length > 0
                    ? "No quote drafts match this view."
                    : "No quote drafts yet."}
                </p>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Templates</p>
                <h2>Start a quote</h2>
              </div>
              <Link
                className="secondary-button compact link-button"
                href="/files/templates/new"
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
                        href={`/files/new?templateKey=${encodeURIComponent(template.key)}`}
                        prefetch={false}
                      >
                        Create draft
                      </Link>
                      <Link
                        className="secondary-button compact link-button"
                        href={`/files/templates/${encodeURIComponent(template.key)}`}
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

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Files</p>
                <h2>Generated PDFs</h2>
              </div>
              <span className="pill">
                {generatedDocuments.length} saved
                {invoiceDocumentCount > 0 ? ` - ${invoiceDocumentCount} invoices` : ""}
              </span>
            </div>

            <div className="engine-list compact-history-list">
              {generatedDocuments.length > 0 ? (
                generatedDocuments.map((document) => (
                  <div className="engine-row compact-history-row" key={document.id}>
                    <div>
                      <strong>{document.title}</strong>
                      <span>
                        {formatLabel(document.documentType)} -{" "}
                        {formatLabel(document.lifecycleStatus)} -{" "}
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
                          {document.quoteDraftId ? (
                            <input
                              name="quoteDraftId"
                              type="hidden"
                              value={document.quoteDraftId}
                            />
                          ) : null}
                          <button className="secondary-button compact" type="submit">
                            File
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-copy">
                  Generate, send, or download quote and invoice PDFs to save them here.
                </p>
              )}
            </div>
          </article>
        </aside>
      </section>
    </AppFrame>
  );
}
