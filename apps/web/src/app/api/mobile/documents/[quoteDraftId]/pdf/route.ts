import { appendQuoteDocumentHistory } from "../../../../../../lib/documents/history";
import {
  buildQuotePdfArtifactForDraft,
  quotePdfMetadata,
} from "../../../../../../lib/documents/pdf";
import {
  quoteRevisionState,
  quoteVersionedDocumentMetadata,
} from "../../../../../../lib/documents/revisions";
import { insertAuditLog } from "../../../../../../lib/engine/event-action-audit";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ quoteDraftId: string }> },
) {
  try {
    const { quoteDraftId } = await params;
    const { supabase, user, workspace } = await requireMobileWorkspaceContext(request);
    const artifact = await buildQuotePdfArtifactForDraft(supabase, {
      quoteDraftId,
      workspace,
    });
    const { data: quoteDraft, error: quoteDraftError } = await supabase
      .from("quote_drafts")
      .select("metadata")
      .eq("workspace_id", workspace.id)
      .eq("id", quoteDraftId)
      .maybeSingle();

    if (quoteDraftError) {
      return Response.json({ error: quoteDraftError.message }, { status: 400 });
    }

    if (quoteDraft) {
      const metadata = objectRecord(quoteDraft.metadata);
      const documentMetadata = quoteVersionedDocumentMetadata(
        quotePdfMetadata(artifact),
        metadata,
      );
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
          quoteVersion: quoteRevisionState(metadata).currentVersion,
          source: "mobile.documents.download_pdf",
        },
      );
      const { error: updateError } = await supabase
        .from("quote_drafts")
        .update({ metadata: nextMetadata })
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId);

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 400 });
      }

      await insertAuditLog(supabase, {
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "quote_draft.pdf_generated",
        entityType: "quote_draft",
        entityId: quoteDraftId,
        after: {
          document: documentMetadata,
          quoteVersion: quoteRevisionState(metadata).currentVersion,
        },
        metadata: {
          source: "mobile.documents.download_pdf",
        },
      });
    }

    const disposition =
      new URL(request.url).searchParams.get("disposition") === "inline"
        ? "inline"
        : "attachment";

    return new Response(Buffer.from(artifact.bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `${disposition}; filename="${artifact.filename}"`,
        "Content-Length": String(artifact.sizeBytes),
        "Content-Type": artifact.contentType,
      },
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
