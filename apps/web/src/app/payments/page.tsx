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
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path
                  d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path
                  d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.02-1.58a.5.5 0 0 0 .12-.64l-1.91-3.31a.5.5 0 0 0-.61-.22l-2.38.96a7.6 7.6 0 0 0-1.7-.98l-.36-2.53a.5.5 0 0 0-.5-.43h-3.82a.5.5 0 0 0-.5.43l-.36 2.53a7.6 7.6 0 0 0-1.7.98l-2.38-.96a.5.5 0 0 0-.61.22L2.83 8.8a.5.5 0 0 0 .12.64l2.02 1.58c-.04.32-.07.65-.07.98s.02.66.07.98l-2.02 1.58a.5.5 0 0 0-.12.64l1.91 3.31a.5.5 0 0 0 .61.22l2.38-.96c.52.4 1.09.73 1.7.98l.36 2.53a.5.5 0 0 0 .5.43h3.82a.5.5 0 0 0 .5-.43l.36-2.53c.61-.25 1.18-.58 1.7-.98l2.38.96a.5.5 0 0 0 .61-.22l1.91-3.31a.5.5 0 0 0-.12-.64l-2.02-1.58Z"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
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
