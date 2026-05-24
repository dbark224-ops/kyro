import { AppFrame } from "../../components/app-frame";
import {
  getDocumentTemplateSettings,
} from "../../../lib/documents/settings";
import {
  draftTitleFromTemplate,
  normalizeQuoteLineItems,
  quoteTemplateCatalog,
} from "../../../lib/documents/templates";
import { requireWorkspaceContext } from "../../../lib/workspace/context";
import { QuoteDraftEditorForm } from "../[quoteDraftId]/quote-draft-editor-form";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type NewQuoteDraftPageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
    templateKey?: string;
  }>;
};

const QUOTE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "sent", label: "Sent" },
  { value: "archived", label: "Archived" },
] as const;

export default async function NewQuoteDraftPage({
  searchParams,
}: NewQuoteDraftPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const documentTemplateSettings = await getDocumentTemplateSettings(
    supabase,
    workspace.id,
  );
  const templateKey = query?.templateKey?.trim() ?? "";
  const template = quoteTemplateCatalog(documentTemplateSettings.customTemplates).find(
    (item) => item.key === templateKey,
  );

  if (!template) {
    redirect(
      `/documents?engine_error=${encodeURIComponent(
        "Choose a reusable template before starting a quote draft.",
      )}`,
    );
  }

  const lineItems = normalizeQuoteLineItems(template.lineItems);
  const title = draftTitleFromTemplate(template);

  return (
    <AppFrame active="Documents">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>{title}</h1>
        </div>
        <div className="topbar-right">
          <span className="pill warning">Unsaved draft</span>
        </div>
      </header>

      {query?.engine_error ? <p className="form-alert error">{query.engine_error}</p> : null}
      {query?.engine_message ? <p className="form-alert">{query.engine_message}</p> : null}

      <section className="review-grid document-editor-only">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Editor</p>
              <h2>New quote draft</h2>
            </div>
            <span className="pill">Not saved yet</span>
          </div>

          <QuoteDraftEditorForm
            customer={{
              company: "",
              email: "",
              jobAddress: "",
              name: "",
              phone: "",
            }}
            initialContact={null}
            jobType={template.label}
            lineItems={lineItems}
            mode="create"
            notes={template.notes}
            preferredTime=""
            status="draft"
            statusOptions={QUOTE_STATUS_OPTIONS}
            templateKey={template.key}
            title={title}
          />
        </article>
      </section>
    </AppFrame>
  );
}
