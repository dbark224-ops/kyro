import {
  buildWorkspaceReport,
  parseReportFilters,
} from "../../../../../lib/reports/data";
import {
  buildReportPdf,
  reportFilename,
} from "../../../../../lib/reports/render";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

const REPORT_FILTER_KEYS = [
  "channel",
  "contactId",
  "direction",
  "end",
  "start",
  "timeframe",
  "type",
] as const;

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadToSearchParams(payload: unknown) {
  const record = objectRecord(payload);
  const source = Object.keys(objectRecord(record.filters)).length
    ? objectRecord(record.filters)
    : record;
  const params = new URLSearchParams();

  for (const key of REPORT_FILTER_KEYS) {
    const value = source[key];

    if (typeof value === "string" && value.trim()) {
      params.set(key, value.trim());
    }
  }

  return params;
}

async function reportPdfResponse(request: Request, params: URLSearchParams) {
  const context = await requireMobileWorkspaceContext(request);
  const filters = parseReportFilters(params);
  const report = await buildWorkspaceReport(
    context.supabase,
    context.workspace,
    filters,
  );
  const bytes = await buildReportPdf(report);

  return new Response(Buffer.from(bytes), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${reportFilename(report)}"`,
      "Content-Type": "application/pdf",
    },
  });
}

export async function GET(request: Request) {
  try {
    return await reportPdfResponse(request, new URL(request.url).searchParams);
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);

    return await reportPdfResponse(request, payloadToSearchParams(payload));
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
