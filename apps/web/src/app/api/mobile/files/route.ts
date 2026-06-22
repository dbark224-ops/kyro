import {
  getWorkspaceFileLibrary,
  type WorkspaceFileKind,
  type WorkspaceFileLibraryItem,
} from "../../../../lib/files/library";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FILE_FILTERS = [
  "all",
  "generated",
  "upload",
  "image",
  "document",
  "email",
] as const;

type MobileFileFilter = (typeof FILE_FILTERS)[number];

export async function GET(request: Request) {
  try {
    const { workspace } = await requireMobileWorkspaceContext(request);
    const files = await getWorkspaceFileLibrary(workspace.id, 120);

    return Response.json({
      counts: Object.fromEntries(
        FILE_FILTERS.map((filter) => [
          filter,
          filter === "all"
            ? files.length
            : files.filter((file) => fileMatchesFilter(file, filter)).length,
        ]),
      ),
      files: files.map((file) => ({
        canPreviewInline: canPreviewInline(file),
        contentType: file.contentType,
        createdAt: file.createdAt,
        filename: file.filename,
        id: file.id,
        kind: file.kind,
        sizeBytes: file.sizeBytes,
        source: file.source,
        sourceLabel: file.sourceLabel,
      })),
      filters: [...FILE_FILTERS],
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

function fileMatchesFilter(
  file: WorkspaceFileLibraryItem,
  filter: Exclude<MobileFileFilter, "all">,
) {
  if (filter === "generated") {
    return file.kind === "generated" || file.source.startsWith("generated_");
  }

  return file.kind === (filter as WorkspaceFileKind);
}

function canPreviewInline(file: WorkspaceFileLibraryItem) {
  return (
    file.contentType?.startsWith("image/") ||
    file.contentType === "application/pdf"
  );
}
