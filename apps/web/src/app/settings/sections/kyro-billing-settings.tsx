import {
  SettingsSubmitButton,
} from "../settings-submit-button";
import {
  formatDate,
  formatLabel,
  invoiceDisplayCurrencySettings,
} from "../shared";
import {
  formatDisplayMoney,
} from "../../../lib/billing/display-currency";
import {
  openKyroBillingPortalAction,
  startKyroBillingSetupAction,
} from "../actions";
import {
  type KyroBillingEngineOverview,
} from "../../../lib/billing/kyro-billing-engine";
import {
  type KyroUserBillingOverview,
} from "../../../lib/billing/kyro-user-billing";
/**
 * The Kyro billing section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function KyroBillingSettingsDetail({
  billingEngineOverview,
  billingOverview,
}: Readonly<{
  billingEngineOverview: KyroBillingEngineOverview;
  billingOverview: KyroUserBillingOverview;
}>) {
  const billingReady = billingOverview.setupReady;
  const billingBlocked =
    !billingOverview.configured || !billingOverview.appUrlConfigured;
  const trialEndsAt = billingOverview.settings.trialEndsAt
    ? formatDate(billingOverview.settings.trialEndsAt)
    : null;
  const cardDisplay = billingOverview.defaultPaymentMethod;
  const cardBrand = cardDisplay?.brand
    ? cardDisplay.brand.replace(/_/g, " ").toUpperCase()
    : "Card";
  const cardExpiry =
    cardDisplay?.expMonth && cardDisplay.expYear
      ? `${String(cardDisplay.expMonth).padStart(2, "0")}/${String(
          cardDisplay.expYear,
        ).slice(-2)}`
      : null;

  return (
    <section className="panel embedded-panel kyro-billing-card standalone">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Kyro subscription</p>
          <h2>
            {billingReady
              ? "Payment method ready"
              : "Add a card to start your trial"}
          </h2>
        </div>
        <span className={billingReady ? "status-pill ready" : "status-pill"}>
          {billingReady ? "Ready" : "Setup needed"}
        </span>
      </div>
      <p className="kyro-billing-copy">
        Add a credit or debit card to activate the two-week free trial. Kyro
        meters usage during the trial, but trial usage is not billed. After the
        trial, Kyro charges the saved payment method for metered usage.
      </p>
      {trialEndsAt ? (
        <div className="kyro-billing-fact">
          <span>Trial ends</span>
          <strong>{trialEndsAt}</strong>
        </div>
      ) : null}
      {cardDisplay?.last4 ? (
        <div className="kyro-billing-fact">
          <span>Saved card</span>
          <strong>
            {cardBrand} ending {cardDisplay.last4}
            {cardExpiry ? ` - ${cardExpiry}` : ""}
          </strong>
        </div>
      ) : billingReady ? (
        <div className="kyro-billing-fact">
          <span>Saved card</span>
          <strong>Ready</strong>
        </div>
      ) : null}
      {!billingOverview.configured ? (
        <p className="form-alert error compact-alert">
          Stripe is not configured for Kyro billing yet.
        </p>
      ) : null}
      {!billingOverview.webhookConfigured ? (
        <p className="form-alert error compact-alert">
          Stripe webhook confirmation is not configured yet.
        </p>
      ) : null}
      {!billingOverview.appUrlConfigured ? (
        <p className="form-alert error compact-alert">
          NEXT_PUBLIC_APP_URL is needed before starting billing setup.
        </p>
      ) : null}
      <form
        action={
          billingReady
            ? openKyroBillingPortalAction
            : startKyroBillingSetupAction
        }
        className="kyro-billing-actions"
      >
        <SettingsSubmitButton
          className="usage-ledger-open-button"
          disabled={billingBlocked}
          pendingLabel="Opening..."
        >
          {billingReady ? "Change payment method" : "Add card for free trial"}
        </SettingsSubmitButton>
      </form>
      <div className="kyro-billing-engine-panel">
        <div className="panel-heading compact-panel-heading">
          <div>
            <p className="eyebrow">Billing engine</p>
            <h3>Kyro invoices</h3>
          </div>
          <span
            className={
              billingEngineOverview.pastDueInvoiceCount > 0
                ? "settings-status-pill warning"
                : "settings-status-pill ready"
            }
          >
            {billingEngineOverview.pastDueInvoiceCount > 0
              ? "Past due"
              : "Current"}
          </span>
        </div>
        <div className="detail-list compact-detail-list">
          <div>
            <span>Open invoices</span>
            <strong>{billingEngineOverview.openInvoiceCount}</strong>
          </div>
          <div>
            <span>Past due</span>
            <strong>{billingEngineOverview.pastDueInvoiceCount}</strong>
          </div>
          <div>
            <span>Latest invoice</span>
            <strong>
              {billingEngineOverview.latestInvoice
                ? `${billingEngineOverview.latestInvoice.invoiceNumber} - ${formatDisplayMoney(
                    billingEngineOverview.latestInvoice.totalAmount,
                    billingEngineOverview.latestInvoice.currency,
                    invoiceDisplayCurrencySettings(
                      billingEngineOverview.latestInvoice.currency,
                    ),
                  )}`
                : "None yet"}
            </strong>
          </div>
        </div>
        {billingEngineOverview.latestInvoice?.lastError ? (
          <p className="form-alert error compact-alert">
            {billingEngineOverview.latestInvoice.lastError}
          </p>
        ) : null}
        {billingEngineOverview.invoices.length > 0 ? (
          <div className="usage-table kyro-invoice-table">
            <div
              className="usage-row usage-row-three heading"
              aria-hidden="true"
            >
              <span>Invoice</span>
              <span>Status</span>
              <span>Total</span>
            </div>
            {billingEngineOverview.invoices.slice(0, 5).map((invoice) => (
              <div className="usage-row usage-row-three" key={invoice.id}>
                <div>
                  <strong>{invoice.invoiceNumber}</strong>
                  <span>
                    {invoice.issuedAt ? formatDate(invoice.issuedAt) : "Draft"}
                  </span>
                </div>
                <span>{formatLabel(invoice.status)}</span>
                <span>
                  {formatDisplayMoney(invoice.totalAmount, invoice.currency, {
                    ...invoiceDisplayCurrencySettings(invoice.currency),
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-copy">
            No Kyro invoices have been generated yet. The billing runner creates
            monthly invoices from metered usage after each period closes.
          </p>
        )}
      </div>
    </section>
  );
}
