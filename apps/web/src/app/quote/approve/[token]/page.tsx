import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  approveQuoteFromCustomerAction,
  requestQuoteChangesFromCustomerAction,
} from "../actions";
import {
  getQuoteApprovalPortalByToken,
  isQuoteApprovalLinkExpired,
  recordQuoteApprovalView,
} from "../../../../lib/documents/approval";
import { buildQuoteDocumentHtml } from "../../../../lib/documents/render";
import {
  documentTemplateDesignSettingsForQuote,
  getDocumentTemplateSettings,
} from "../../../../lib/documents/settings";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Review quote | Kyro",
};

type QuoteApprovalPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams?: Promise<{
    error?: string;
    status?: string;
  }>;
};

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusCopy(status: string | undefined) {
  if (status === "approved") {
    return "Thanks, this quote is approved. The business has been notified in Kyro.";
  }

  if (status === "changes_requested") {
    return "Thanks, your requested changes have been sent back to the business.";
  }

  if (status === "expired") {
    return "This approval link has expired. Please ask the business to send a fresh quote link.";
  }

  if (status === "revoked") {
    return "This approval link has been replaced. Please use the newest quote link you were sent.";
  }

  return null;
}

export default async function QuoteApprovalPage({
  params,
  searchParams,
}: QuoteApprovalPageProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const supabase = createServiceSupabaseClient();
  const portal = await getQuoteApprovalPortalByToken(supabase, token).catch(
    (error: unknown) => {
      console.error("Unable to load quote approval portal.", error);
      return null;
    },
  );

  if (!portal) {
    notFound();
  }

  const approvalLink =
    portal.approvalLink.status === "active" &&
    !isQuoteApprovalLinkExpired(portal.approvalLink)
      ? await recordQuoteApprovalView(supabase, portal)
      : portal.approvalLink;
  const documentTemplateSettings = await getDocumentTemplateSettings(
    supabase,
    portal.workspace.id,
  );
  const quoteHtml = buildQuoteDocumentHtml({
    businessProfile: portal.businessProfile,
    chrome: "preview",
    profile: portal.profile,
    settings: documentTemplateDesignSettingsForQuote(
      portal.profile.quoteDraft.metadata,
      documentTemplateSettings,
    ),
    workspace: portal.workspace,
  });
  const isExpired = isQuoteApprovalLinkExpired(approvalLink);
  const isActionable = approvalLink.status === "active" && !isExpired;
  const responseMessage =
    query?.error ??
    statusCopy(query?.status) ??
    (approvalLink.status === "approved"
      ? statusCopy("approved")
      : approvalLink.status === "changes_requested"
        ? statusCopy("changes_requested")
        : isExpired
          ? statusCopy("expired")
          : null);
  const businessName =
    portal.businessProfile?.businessName ?? portal.workspace.name;

  return (
    <main className="public-approval-shell">
      <section className="public-approval-frame">
        <header className="public-approval-header">
          <div>
            <p className="eyebrow">{businessName}</p>
            <h1>Review your quote</h1>
            <p>
              Check the attached quote, then approve it or ask for changes. This
              sends your response straight back into the business workflow.
            </p>
          </div>
          <div className="public-approval-status">
            <span>Quote status</span>
            <strong>
              {isExpired ? "Expired" : approvalLink.status.replace(/_/g, " ")}
            </strong>
            <span>Valid until {formatDate(approvalLink.expiresAt)}</span>
          </div>
        </header>

        {responseMessage ? (
          <p className={query?.error ? "form-alert error" : "form-alert"}>
            {responseMessage}
          </p>
        ) : null}

        <section className="public-approval-grid">
          <article className="public-quote-preview">
            <iframe
              srcDoc={quoteHtml}
              title={`${portal.profile.quoteDraft.title} quote preview`}
            />
          </article>

          <aside className="public-approval-actions">
            <div className="public-approval-card">
              <p className="eyebrow">Decision</p>
              <h2>{portal.profile.quoteDraft.title}</h2>
              <p>
                Your response is logged against this quote, so the business can
                see exactly when it was approved or what needs changing.
              </p>

              {isActionable ? (
                <form action={approveQuoteFromCustomerAction}>
                  <input name="token" type="hidden" value={token} />
                  <button className="primary-button full-width" type="submit">
                    Approve quote
                  </button>
                </form>
              ) : null}
            </div>

            <form
              action={requestQuoteChangesFromCustomerAction}
              className="public-approval-card"
            >
              <input name="token" type="hidden" value={token} />
              <label>
                Request changes
                <textarea
                  disabled={!isActionable}
                  name="message"
                  placeholder="Tell us what you would like adjusted..."
                />
              </label>
              <button
                className="secondary-button full-width"
                disabled={!isActionable}
                type="submit"
              >
                Send change request
              </button>
            </form>
          </aside>
        </section>
      </section>
    </main>
  );
}
