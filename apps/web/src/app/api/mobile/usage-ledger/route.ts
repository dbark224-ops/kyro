import { formatDisplayMoney } from "../../../../lib/billing/display-currency";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";
import {
  getUsageReport,
  normalizeUsageWindow,
  usageWindows,
} from "../../../../lib/usage/queries";
import { getWorkspaceGeneralSettings } from "../../../../lib/workspace/general-settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const usageWindow = normalizeUsageWindow(
      url.searchParams.get("usageWindow"),
    );
    const [general, usageReport] = await Promise.all([
      getWorkspaceGeneralSettings(context.supabase, context.workspace.id),
      getUsageReport(context.supabase, context.workspace.id, usageWindow),
    ]);

    return Response.json({
      activeWindow: usageReport.activeWindow,
      generatedAt: usageReport.generatedAt,
      ledger: usageReport.ledger.slice(0, 200).map((row) => ({
        createdAt: row.createdAt,
        currency: row.currency,
        customerCharge: row.customerCharge,
        displayCustomerCharge: formatDisplayMoney(
          row.customerCharge,
          row.currency,
          general,
        ),
        id: row.id,
        model: row.model,
        provider: row.provider,
        quantity: row.quantity,
        service: row.service,
        sourceLabel: row.sourceLabel,
        sourceMeta: row.sourceMeta,
        taskLabel: row.taskLabel,
        unit: row.unit,
        userName: row.userName,
      })),
      totals: {
        customerCharge: usageReport.totals.customerCharge,
        currency: usageReport.totals.currency,
        displayCustomerCharge: formatDisplayMoney(
          usageReport.totals.customerCharge,
          usageReport.totals.currency,
          general,
        ),
        events: usageReport.totals.events,
        providerCost: usageReport.totals.providerCost,
      },
      windows: usageWindows.map((window) => window.value),
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
