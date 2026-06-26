import { AppFrame } from "../components/app-frame";
import { AddressAutocompleteField } from "../components/address-autocomplete-field";
import { runContactLifecycleReviewAction } from "../contacts/actions";
import { createManualInboundAction } from "../inbound/actions";
import { getTwilioTelephonyOverview } from "../../lib/integrations/twilio";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import Link from "next/link";

export const dynamic = "force-dynamic";

type DeveloperPageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
  }>;
};

export default async function DeveloperPage({
  searchParams,
}: DeveloperPageProps) {
  const [query, { supabase, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const twilioOverview = await getTwilioTelephonyOverview(
    supabase,
    workspace.id,
  );
  const submissionKey = crypto.randomUUID();

  return (
    <AppFrame active="Developer">
      <header className="topbar">
        <div>
          <p className="eyebrow">Kyro internal</p>
          <h1>Developer</h1>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}

      <section className="content-grid developer-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inbound</p>
              <h2>Mock inquiry</h2>
            </div>
            <span className="pill">Dev tool</span>
          </div>

          <form action={createManualInboundAction} className="developer-form">
            <input name="redirectTo" type="hidden" value="/developer" />
            <input name="submissionKey" type="hidden" value={submissionKey} />

            <div className="document-form-grid">
              <label>
                Contact name
                <input
                  name="contactName"
                  placeholder="Jamie Redknapp"
                  required
                  type="text"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  placeholder="customer@example.com"
                  type="email"
                />
              </label>
              <label>
                Phone
                <input name="phone" placeholder="0400 000 000" type="text" />
              </label>
              <label>
                Company
                <input name="company" placeholder="Optional" type="text" />
              </label>
              <label>
                Contact type
                <select defaultValue="client" name="contactType">
                  <option value="client">Client</option>
                  <option value="supplier">Supplier</option>
                  <option value="contractor">Contractor</option>
                  <option value="builder">Builder</option>
                  <option value="property_manager">Property manager</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Service type
                <input
                  name="serviceType"
                  placeholder="Bathroom quote, blocked drain, hot water..."
                  type="text"
                />
              </label>
              <AddressAutocompleteField
                className="full-row"
                label="Address"
                name="address"
                placeholder="Site or contact address"
              />
              <label className="full-row">
                Inquiry message
                <textarea
                  name="message"
                  placeholder="Paste or type the inbound inquiry here..."
                  required
                />
              </label>
            </div>

            <div className="settings-footer">
              <span>
                Creates the contact/profile, lead, conversation, message, AI
                triage, actions, audit, and usage rows.
              </span>
              <button className="primary-button compact" type="submit">
                Ingest mock inquiry
              </button>
            </div>
          </form>
        </article>

        <aside className="side-stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Scope</p>
                <h2>Developer tools</h2>
              </div>
            </div>
            <div className="detail-list">
              <div>
                <span>Mock inbound</span>
                <strong>Manual inquiry ingestion</strong>
              </div>
              <div>
                <span>Outbound</span>
                <strong>
                  <Link href="/developer/outbox">Open outbox operations</Link>
                </strong>
              </div>
              <div>
                <span>Health</span>
                <strong>
                  <Link href="/developer/system-health">
                    Open system health
                  </Link>
                </strong>
              </div>
              <div>
                <span>Smoke tests</span>
                <strong>
                  <Link href="/developer/smoke-tests">
                    Open smoke checklist
                  </Link>
                </strong>
              </div>
              <div>
                <span>Assistant</span>
                <strong>
                  <Link href="/developer/assistant-tools">
                    Open tool registry
                  </Link>
                </strong>
              </div>
              <div>
                <span>External email</span>
                <strong>Gmail and Outlook</strong>
              </div>
            </div>
          </article>
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Phone/SMS</p>
                <h2>Twilio test sender</h2>
              </div>
              <span
                className={`pill ${
                  twilioOverview.configured ? "success" : "warning"
                }`}
              >
                {twilioOverview.configured ? "Configured" : "Keys needed"}
              </span>
            </div>
            <p className="empty-copy">
              Internal readout for the fallback sender used while testing
              outbound SMS before a workspace-owned number is assigned.
            </p>
            <div className="detail-list">
              <div>
                <span>Configured sender</span>
                <strong>
                  {twilioOverview.defaultFromNumber ?? "Not configured"}
                </strong>
              </div>
              <div>
                <span>Workspace numbers</span>
                <strong>{twilioOverview.numbers.length}</strong>
              </div>
              <div>
                <span>Messaging service</span>
                <strong>
                  {twilioOverview.messagingServiceSidConfigured
                    ? "Configured"
                    : "Not configured"}
                </strong>
              </div>
              <div>
                <span>Inbound SMS webhook</span>
                <strong>
                  {twilioOverview.inboundSmsWebhookUrl
                    ? "Ready"
                    : "App URL needed"}
                </strong>
              </div>
            </div>
            {twilioOverview.error ? (
              <p className="form-alert error">{twilioOverview.error}</p>
            ) : null}
          </article>
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CRM maintenance</p>
                <h2>Lifecycle review</h2>
              </div>
              <span className="pill">Manual scan</span>
            </div>
            <p className="empty-copy">
              Runs Kyro&apos;s CRM lifecycle pass across the workspace. It checks
              whether contacts look like they should move between lead/client
              states from quote, booking, work, and communication evidence, then
              creates review suggestions rather than applying changes silently.
            </p>
            <form action={runContactLifecycleReviewAction}>
              <input name="redirectTo" type="hidden" value="/developer" />
              <button className="secondary-button compact" type="submit">
                Review lifecycle
              </button>
            </form>
          </article>
        </aside>
      </section>
    </AppFrame>
  );
}
