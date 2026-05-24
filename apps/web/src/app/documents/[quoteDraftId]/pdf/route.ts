import { appendQuoteDocumentHistory } from "../../../../lib/documents/history";
import {
  buildQuotePdfArtifactForDraft,
  quotePdfMetadata,
} from "../../../../lib/documents/pdf";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type QuotePdfRouteProps = {
  params: Promise<{
    quoteDraftId: string;
  }>;
};

export async function GET(_request: Request, { params }: QuotePdfRouteProps) {
  const [{ quoteDraftId }, { supabase, user, workspace }] = await Promise.all([
    params,
    requireWorkspaceContext(),
  ]);

  try {
    const artifact = await buildQuotePdfArtifactForDraft(supabase, {
      quoteDraftId,
      workspace,
    });
    const documentMetadata = quotePdfMetadata(artifact);
    const { data: quoteDraft, error: quoteDraftError } = await supabase
      .from("quote_drafts")
      .select("metadata")
      .eq("workspace_id", workspace.id)
      .eq("id", quoteDraftId)
      .maybeSingle();

    if (quoteDraftError) {
      throw new Error(`Unable to record PDF generation: ${quoteDraftError.message}`);
    }

    if (quoteDraft) {
      const metadata =
        quoteDraft.metadata &&
        typeof quoteDraft.metadata === "object" &&
        !Array.isArray(quoteDraft.metadata)
          ? (quoteDraft.metadata as Record<string, unknown>)
          : {};
      const nextMetadata = appendQuoteDocumentHistory(
        {
          ...metadata,
          lastGeneratedDocument: documentMetadata,
        },
        {
          actorType: "user",
          contentHash: documentMetadata.contentHash,
          document: documentMetadata,
          kind: "pdf_generated",
          occurredAt: documentMetadata.generatedAt,
          source: "documents.download_pdf",
        },
      );
      const { error: updateError } = await supabase
        .from("quote_drafts")
        .update({ metadata: nextMetadata })
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId);

      if (updateError) {
        throw new Error(`Unable to record PDF generation: ${updateError.message}`);
      }

      await insertAuditLog(supabase, {
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "quote_draft.pdf_generated",
        entityType: "quote_draft",
        entityId: quoteDraftId,
        after: { document: documentMetadata },
        metadata: {
          source: "documents.download_pdf",
        },
      });
    }

    return new Response(Buffer.from(artifact.bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${artifact.filename}"`,
        "Content-Length": String(artifact.sizeBytes),
        "Content-Type": artifact.contentType,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Quote draft was not found.") {
      notFound();
    }

    throw error;
  }
}
