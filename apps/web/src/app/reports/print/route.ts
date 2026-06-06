import {
  buildWorkspaceReport,
  parseReportFilters,
  reportSearchParams,
} from "../../../lib/reports/data";
import { buildReportPrintHtml } from "../../../lib/reports/render";
import { requireWorkspaceContext } from "../../../lib/workspace/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [{ supabase, workspace }, url] = await Promise.all([
    requireWorkspaceContext(),
    Promise.resolve(new URL(request.url)),
  ]);
  const filters = parseReportFilters(url.searchParams);
  const report = await buildWorkspaceReport(supabase, workspace, filters);
  const html = buildReportPrintHtml(report, reportSearchParams(filters).toString());

  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
