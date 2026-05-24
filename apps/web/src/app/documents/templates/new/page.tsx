import { AppFrame } from "../../../components/app-frame";
import { getDocumentTemplateSettings } from "../../../../lib/documents/settings";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { TemplateBuilderForm } from "./template-builder-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

type NewTemplatePageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
  }>;
};

export default async function NewTemplatePage({ searchParams }: NewTemplatePageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const settings = await getDocumentTemplateSettings(supabase, workspace.id);

  return (
    <AppFrame active="Documents">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Create template</h1>
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
          <p className="eyebrow">Deterministic templates</p>
          <h2>Reusable HTML quote structure</h2>
          <p>
            Build a quote template Kyro can reuse consistently. The saved template stores structured line items,
            terms, style direction, and reference-file metadata, then creates normal editable quote drafts.
          </p>
        </div>
        <TemplateBuilderForm settings={settings} workspaceName={workspace.name} />
      </section>
    </AppFrame>
  );
}
