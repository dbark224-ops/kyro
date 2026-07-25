import { buildWorkspaceReport, parseReportFilters } from "../../../lib/reports/data";
import { buildReportPdf, reportFilename } from "../../../lib/reports/render";
import { requireWorkspaceContext } from "../../../lib/workspace/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [{ supabase, workspace }, url] = await Promise.all([
    requireWorkspaceContext(),
    Promise.resolve(new URL(request.url)),
  ]);
  const filters = parseReportFilters(url.searchParams);
  const report = await buildWorkspaceReport(supabase, workspace, filters);
  const bytes = await buildReportPdf(report);

  return new Response(Buffer.from(bytes), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${reportFilename(report)}"`,
      "Content-Type": "application/pdf",
    },
  });
}
