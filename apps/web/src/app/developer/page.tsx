import { AppFrame } from "../components/app-frame";
import { createManualInboundAction } from "../inbound/actions";

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
  const query = await searchParams;
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
                <input name="email" placeholder="customer@example.com" type="email" />
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
              <label className="full-row">
                Address
                <input
                  name="address"
                  placeholder="Site or contact address"
                  type="text"
                />
              </label>
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
              <span>Creates the contact/profile, lead, conversation, message, AI triage, actions, audit, and usage rows.</span>
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
                <strong>Test from Inbox or Assistant</strong>
              </div>
              <div>
                <span>External email</span>
                <strong>Gmail only for now</strong>
              </div>
            </div>
          </article>
        </aside>
      </section>
    </AppFrame>
  );
}
