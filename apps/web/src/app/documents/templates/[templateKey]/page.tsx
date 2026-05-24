import { notFound } from "next/navigation";
import Link from "next/link";
import { AppFrame } from "../../../components/app-frame";
import { getDocumentTemplateSettings } from "../../../../lib/documents/settings";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { TemplateBuilderForm } from "../new/template-builder-form";

export const dynamic = "force-dynamic";

type TemplateReviewPageProps = {
  params: Promise<{
    templateKey: string;
  }>;
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
  }>;
};

export default async function TemplateReviewPage({
  params,
  searchParams,
}: TemplateReviewPageProps) {
  const [routeParams, query, { supabase, workspace }] = await Promise.all([
    params,
    searchParams,
    requireWorkspaceContext(),
  ]);
  const settings = await getDocumentTemplateSettings(supabase, workspace.id);
  const template = settings.customTemplates.find(
    (item) => item.key === routeParams.templateKey,
  );

  if (!template) {
    notFound();
  }

  return (
    <AppFrame active="Documents">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Review template</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button link-button" href="/documents" prefetch={false}>
            Back to documents
          </Link>
        </div>
      </header>

      {query?.engine_error ? <p className="form-alert error">{query.engine_error}</p> : null}
      {query?.engine_message ? <p className="form-alert">{query.engine_message}</p> : null}

      <section className="template-builder-layout">
        <div className="template-builder-intro panel">
          <p className="eyebrow">Reusable template</p>
          <h2>{template.label}</h2>
          <p>
            Review the saved quote template, ask Kyro to reshape it, or make field edits directly. Nothing changes for
            future drafts until you save changes.
          </p>
        </div>
        <TemplateBuilderForm
          mode="edit"
          settings={settings}
          template={template}
          workspaceName={workspace.name}
        />
      </section>
    </AppFrame>
  );
}
