import { AppFrame } from "../components/app-frame";
import { runContactLifecycleReviewAction } from "../contacts/actions";
import { developerAccessEnabled } from "../../lib/auth/developer-access";
import { getTwilioTelephonyOverview } from "../../lib/integrations/twilio";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DeveloperMockInquiryForms,
  type DeveloperMockMode,
} from "./mock-inquiry-forms";

export const dynamic = "force-dynamic";

type DeveloperPageProps = {
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
    mock?: string;
  }>;
};

function mockMode(value: string | undefined): DeveloperMockMode {
  return value === "email" || value === "sms" ? value : "manual";
}

export default async function DeveloperPage({
  searchParams,
}: DeveloperPageProps) {
  const [query, { supabase, user, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);

  if (!developerAccessEnabled(user)) {
    redirect("/");
  }

  const [twilioOverview, emailConnectionResult] = await Promise.all([
    getTwilioTelephonyOverview(supabase, workspace.id),
    supabase
      .from("integration_connections")
      .select("id,provider,account_email")
      .eq("workspace_id", workspace.id)
      .eq("status", "connected")
      .in("provider", ["google", "microsoft"])
      .order("last_connected_at", { ascending: false }),
  ]);
  const emailConnections = (emailConnectionResult.data ?? [])
    .filter(
      (connection) =>
        connection.provider === "google" || connection.provider === "microsoft",
    )
    .map((connection) => ({
      accountEmail: connection.account_email,
      id: String(connection.id),
      provider: connection.provider as "google" | "microsoft",
    }));
  const phoneNumbers = twilioOverview.numbers
    .filter((number) => number.status === "active")
    .map((number) => ({
      friendlyName: number.friendlyName,
      id: number.id,
      phoneNumber: number.phoneNumber,
    }));

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

          <DeveloperMockInquiryForms
            emailConnections={emailConnections}
            initialMode={mockMode(query?.mock)}
            phoneNumbers={phoneNumbers}
            submissionKeys={{
              email: crypto.randomUUID(),
              manual: crypto.randomUUID(),
              sms: crypto.randomUUID(),
            }}
          />
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
                <strong>Structured, email, and SMS ingestion</strong>
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
