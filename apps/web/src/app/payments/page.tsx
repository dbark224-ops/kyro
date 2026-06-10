import { AppFrame } from "../components/app-frame";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";
import { PaymentLinkModal } from "./payment-link-modal";
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
  const data = await getPaymentsOverviewData(supabase, workspace.id);
  const currency = data.stats.currency || data.account?.defaultCurrency || "AUD";
  const recentPayments = data.paymentRequests.slice(0, 12);

  return (
    <AppFrame active="Payments">
      <div className="workspace-page payments-page">
        <header className="page-heading-row payments-heading">
          <div>
            <h1>Payments</h1>
          </div>
          <div className="payments-heading-actions">
            <PaymentLinkModal contacts={data.contacts} currency={currency} />
            <SmartPrefetchLink className="secondary-button" href="/files/new">
              Create invoice
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
              <span>Charges</span>
              <strong>{data.account?.chargesEnabled ? "Enabled" : "Pending"}</strong>
            </div>
            <div className="payments-service-status">
              <span>Payouts</span>
              <strong>{data.account?.payoutsEnabled ? "Enabled" : "Pending"}</strong>
            </div>
            <SmartPrefetchLink className="secondary-button full-width" href="/settings">
              Payment settings
            </SmartPrefetchLink>

            <div className="payments-side-note">
              <p className="eyebrow">Invoice flow</p>
              <p>
                Generate an invoice from Files, then create a payment link from this tab
                when the customer is ready to pay.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </AppFrame>
  );
}
