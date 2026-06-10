import { AppFrame } from "../components/app-frame";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";
import { CreateInvoiceModal } from "./create-invoice-modal";
import { PaymentLinkModal } from "./payment-link-modal";
import { getDocumentTemplateSettings } from "../../lib/documents/settings";
import { quoteTemplateCatalog } from "../../lib/documents/templates";
import { getPaymentsOverviewData } from "../../lib/payments/queries";
import { requireWorkspaceContext } from "../../lib/workspace/context";

export const dynamic = "force-dynamic";

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(cents / 100);
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  if (status === "link_created") return "Awaiting payment";
  if (status === "paid") return "Paid";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";

  return status.replace(/_/g, " ");
}

function statusTone(status: string) {
  if (status === "paid") return "success";
  if (status === "failed") return "danger";
  if (status === "link_created" || status === "sent") return "pending";

  return "neutral";
}

export default async function PaymentsPage() {
  const { supabase, workspace } = await requireWorkspaceContext();
  const [data, documentTemplateSettings] = await Promise.all([
    getPaymentsOverviewData(supabase, workspace.id),
    getDocumentTemplateSettings(supabase, workspace.id),
  ]);
  const currency = data.stats.currency || data.account?.defaultCurrency || "AUD";
  const recentPayments = data.paymentRequests.slice(0, 12);
  const documentTemplates = quoteTemplateCatalog(
    documentTemplateSettings.customTemplates,
  );
  const defaultInvoiceTemplateKey =
    documentTemplateSettings.defaultInvoiceTemplateKey ??
    documentTemplates.find((template) => /invoice/i.test(template.label))?.key ??
    documentTemplates[0]?.key ??
    null;

  return (
    <AppFrame active="Payments">
      <div className="workspace-page payments-page">
        <header className="page-heading-row payments-heading">
          <div>
            <h1>Payments</h1>
          </div>
          <div className="payments-heading-actions">
            <PaymentLinkModal contacts={data.contacts} currency={currency} />
            <CreateInvoiceModal
              defaultTemplateKey={defaultInvoiceTemplateKey}
              templates={documentTemplates}
            />
            <SmartPrefetchLink
              aria-label="Payment settings"
              className="payments-settings-icon-button"
              href="/settings?section=integrations"
              title="Payment settings"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path
                  d="M10 7.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
                <path
                  d="M10 2.75v1.5M10 15.75v1.5M4.88 4.88l1.06 1.06M14.06 14.06l1.06 1.06M2.75 10h1.5M15.75 10h1.5M4.88 15.12l1.06-1.06M14.06 5.94l1.06-1.06"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </SmartPrefetchLink>
          </div>
        </header>

        {!data.migrationReady ? (
          <section className="engine-error">
            Payment tables are not available yet. Run the Stripe payments migration before
            using this screen.
          </section>
        ) : null}

        <section className="payments-metric-grid" aria-label="Payment summary">
          <article className="payments-metric-card accent-cyan">
            <p className="eyebrow">Paid this week</p>
            <strong>{formatMoney(data.stats.paidThisWeekCents, currency)}</strong>
            <span>Settled customer payments</span>
          </article>
          <article className="payments-metric-card accent-green">
            <p className="eyebrow">Paid this month</p>
            <strong>{formatMoney(data.stats.paidThisMonthCents, currency)}</strong>
            <span>Total received this month</span>
          </article>
          <article className="payments-metric-card accent-pink">
            <p className="eyebrow">Outstanding</p>
            <strong>{formatMoney(data.stats.outstandingAmountCents, currency)}</strong>
            <span>{data.stats.outstandingCount} open payment requests</span>
          </article>
          <article className="payments-metric-card accent-amber">
            <p className="eyebrow">Overdue</p>
            <strong>{formatMoney(data.stats.overdueAmountCents, currency)}</strong>
            <span>{data.stats.overdueCount} past due</span>
          </article>
        </section>

        <section className="payments-layout">
          <div className="payments-panel payments-main-panel">
            <div className="payments-panel-header">
              <div>
                <p className="eyebrow">Requests</p>
                <h2>Payment links and invoices</h2>
              </div>
              <span className="pill">{data.paymentRequests.length} requests</span>
            </div>

            <div className="payments-filter-row">
              <span className="pill active">All</span>
              <span className="pill">Outstanding {data.stats.outstandingCount}</span>
              <span className="pill">Paid</span>
              <span className="pill">Overdue {data.stats.overdueCount}</span>
            </div>

            <div className="payments-request-list">
              {recentPayments.length > 0 ? (
                recentPayments.map((request) => (
                  <article className="payments-request-row" key={request.id}>
                    <div className="payments-request-main">
                      <strong>{request.contactLabel}</strong>
                      <span>{request.description}</span>
                    </div>
                    <div className="payments-request-meta">
                      <strong>{formatMoney(request.amountCents, request.currency)}</strong>
                      <span>{formatDate(request.createdAt)}</span>
                    </div>
                    <span className={`payments-status-pill ${statusTone(request.status)}`}>
                      {statusLabel(request.status)}
                    </span>
                    {request.paymentUrl ? (
                      <a href={request.paymentUrl} rel="noreferrer" target="_blank">
                        Open
                      </a>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="payments-empty-state">
                  <strong>No payment requests yet.</strong>
                  <span>Create your first payment link when a customer is ready to pay.</span>
                </div>
              )}
            </div>
          </div>

          <aside className="payments-panel payments-side-panel">
            <div>
              <p className="eyebrow">Stripe</p>
              <h2>Payment service</h2>
            </div>
            <div className="payments-service-status">
              <span>Status</span>
              <strong>{data.account?.status ?? "Not connected"}</strong>
            </div>
            <div className="payments-service-status">
              <span>Payouts</span>
              <strong>{data.account?.payoutsEnabled ? "Enabled" : "Pending"}</strong>
            </div>
          </aside>
        </section>
      </div>
    </AppFrame>
  );
}
