import { updateContactProfileAction } from "../actions";
import { AppFrame } from "../../components/app-frame";
import {
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  formatDisplayMoney,
  type DisplayCurrencySettings,
} from "../../../lib/billing/display-currency";
import {
  CONTACT_TYPE_OPTIONS,
  formatContactType,
} from "../../../lib/crm/contact-types";
import { getContactProfile } from "../../../lib/crm/queries";
import { requireWorkspaceContext } from "../../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../../lib/workspace/general-settings";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type ContactProfilePageProps = {
  params: Promise<{
    contactId: string;
  }>;
  searchParams?: Promise<{
    engine_error?: string;
    engine_message?: string;
  }>;
};

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatMoney(
  value: string | null,
  sourceCurrency: string,
  displayCurrencySettings: DisplayCurrencySettings,
) {
  return formatDisplayMoney(value, sourceCurrency, displayCurrencySettings);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export default async function ContactProfilePage({
  params,
  searchParams,
}: ContactProfilePageProps) {
  const [{ contactId }, query] = await Promise.all([params, searchParams]);
  const { supabase, workspace } = await requireWorkspaceContext();
  const [profile, generalSettings] = await Promise.all([
    getContactProfile(supabase, workspace.id, contactId),
    getWorkspaceGeneralSettings(supabase, workspace.id).catch(
      () => DEFAULT_DISPLAY_CURRENCY_SETTINGS,
    ),
  ]);

  if (!profile) {
    notFound();
  }

  const displayName =
    profile.contact.name ??
    profile.contact.company ??
    profile.contact.email ??
    profile.contact.phone ??
    "Contact profile";

  return (
    <AppFrame active="CRM">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>{displayName}</h1>
        </div>
        <div className="topbar-actions">
          <Link
            className="secondary-button link-button"
            href="/contacts"
            prefetch
          >
            Back to contacts
          </Link>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}

      <section className="metric-grid" aria-label="Contact profile metrics">
        <article className="metric-card cyan">
          <p>Messages</p>
          <strong>{profile.counts.messages}</strong>
          <span>Linked communications</span>
        </article>
        <article className="metric-card purple">
          <p>Leads</p>
          <strong>{profile.counts.leads}</strong>
          <span>Attached opportunities</span>
        </article>
        <article className="metric-card pink">
          <p>Documents</p>
          <strong>{profile.counts.quoteDrafts}</strong>
          <span>Saved quote drafts</span>
        </article>
      </section>

      <section className="review-grid large-left">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Profile</p>
              <h2>Edit contact</h2>
            </div>
            <span className="pill">
              {formatContactType(profile.contact.contactType)}
            </span>
          </div>

          <form className="profile-form" action={updateContactProfileAction}>
            <input name="contactId" type="hidden" value={profile.contact.id} />
            <label>
              Name
              <input
                name="name"
                type="text"
                defaultValue={profile.contact.name ?? ""}
              />
            </label>
            <label>
              Contact type
              <select
                name="contactType"
                defaultValue={profile.contact.contactType}
              >
                {CONTACT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={profile.contact.email ?? ""}
              />
            </label>
            <label>
              Phone
              <input
                name="phone"
                type="tel"
                defaultValue={profile.contact.phone ?? ""}
              />
            </label>
            <label>
              Company
              <input
                name="company"
                type="text"
                defaultValue={profile.contact.company ?? ""}
              />
            </label>
            <label>
              Address
              <input
                name="address"
                type="text"
                defaultValue={profile.contact.address ?? ""}
              />
            </label>
            <label className="full-row">
              Notes
              <textarea
                name="notes"
                defaultValue={profile.contact.notes ?? ""}
                rows={5}
              />
            </label>
            <button className="primary-button profile-submit" type="submit">
              Save profile
            </button>
          </form>
        </article>

        <aside className="side-stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Details</p>
                <h2>Snapshot</h2>
              </div>
            </div>
            <div className="detail-list">
              <div>
                <span>Email</span>
                <strong>{profile.contact.email ?? "-"}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{profile.contact.phone ?? "-"}</strong>
              </div>
              <div>
                <span>Company</span>
                <strong>{profile.contact.company ?? "-"}</strong>
              </div>
              <div>
                <span>Address</span>
                <strong>{profile.contact.address ?? "-"}</strong>
              </div>
              <div>
                <span>Updated</span>
                <strong>{formatDate(profile.contact.updatedAt)}</strong>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">AI</p>
                <h2>Runs</h2>
              </div>
            </div>
            <div className="engine-list">
              {profile.aiRuns.length > 0 ? (
                profile.aiRuns.map((run) => (
                  <div className="engine-row" key={run.id}>
                    <div>
                      <strong>{run.taskType}</strong>
                      <span>
                        {run.status} - {run.provider}/{run.model}
                      </span>
                      {textValue(run.output.summary) ? (
                        <p className="body-preview">
                          {textValue(run.output.summary)}
                        </p>
                      ) : null}
                    </div>
                    <strong>
                      {formatMoney(run.actualCost, "USD", generalSettings)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="empty-copy">
                  No AI runs linked to this contact yet.
                </p>
              )}
            </div>
          </article>
        </aside>
      </section>

      <section className="review-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Comms</p>
              <h2>Conversations</h2>
            </div>
          </div>
          <div className="data-list">
            {profile.conversations.length > 0 ? (
              profile.conversations.map((conversation) => (
                <Link
                  className="data-row compact-row"
                  href={`/inbox/${conversation.id}`}
                  key={conversation.id}
                  prefetch={false}
                >
                  <div className="data-main">
                    <strong>{conversation.leadTitle ?? "Conversation"}</strong>
                    <span>{conversation.status}</span>
                  </div>
                  <div className="data-meta">
                    <span>{formatDate(conversation.lastMessageAt)}</span>
                  </div>
                </Link>
              ))
            ) : (
              <p className="empty-copy">
                No conversations linked to this contact.
              </p>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pipeline</p>
              <h2>Leads</h2>
            </div>
          </div>
          <div className="engine-list">
            {profile.leads.length > 0 ? (
              profile.leads.map((lead) => (
                <div className="engine-row" key={lead.id}>
                  <div>
                    <strong>{lead.title}</strong>
                    <span>
                      {lead.status} - {lead.serviceType ?? "No service type"} -{" "}
                      {formatDate(lead.updatedAt)}
                    </span>
                    {lead.nextStep ? (
                      <p className="body-preview">{lead.nextStep}</p>
                    ) : null}
                  </div>
                  <span
                    className={
                      lead.priority === "high" ? "pill warning" : "pill"
                    }
                  >
                    {lead.priority}
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-copy">No leads attached to this contact.</p>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Documents</p>
              <h2>Quote drafts</h2>
            </div>
          </div>
          <div className="data-list">
            {profile.quoteDrafts.length > 0 ? (
              profile.quoteDrafts.map((quoteDraft) => (
                <Link
                  className="data-row compact-row"
                  href={`/documents/${quoteDraft.id}`}
                  key={quoteDraft.id}
                  prefetch={false}
                >
                  <div className="data-main">
                    <strong>{quoteDraft.title}</strong>
                    <span>
                      {quoteDraft.leadTitle ?? "No linked lead"} -{" "}
                      {quoteDraft.lineItemCount} line items
                    </span>
                    {quoteDraft.notes ? (
                      <p className="body-preview">{quoteDraft.notes}</p>
                    ) : null}
                  </div>
                  <div className="data-meta">
                    <span className="pill">
                      {formatLabel(quoteDraft.status)}
                    </span>
                    {quoteDraft.conversationId ? (
                      <span>Linked inquiry</span>
                    ) : null}
                    <span>{formatDate(quoteDraft.updatedAt)}</span>
                  </div>
                </Link>
              ))
            ) : (
              <p className="empty-copy">
                No quote drafts linked to this contact.
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="review-grid large-left">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Messages</p>
              <h2>Communication history</h2>
            </div>
          </div>
          <div className="message-list">
            {profile.messages.length > 0 ? (
              profile.messages.map((message) => {
                const content = (
                  <div
                    className={
                      message.direction === "outbound"
                        ? "message-row outbound"
                        : "message-row inbound"
                    }
                  >
                    <div className="message-meta">
                      <strong>{message.direction}</strong>
                      <span>
                        {formatDate(
                          message.receivedAt ??
                            message.sentAt ??
                            message.createdAt,
                        )}
                      </span>
                    </div>
                    {message.subject ? <h3>{message.subject}</h3> : null}
                    <p>{message.bodyText ?? "No message body."}</p>
                  </div>
                );

                return message.conversationId ? (
                  <Link
                    className="plain-link"
                    href={`/inbox/${message.conversationId}`}
                    key={message.id}
                    prefetch={false}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={message.id}>{content}</div>
                );
              })
            ) : (
              <p className="empty-copy">No messages linked to this contact.</p>
            )}
          </div>
        </article>

        <aside className="side-stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Actions</p>
                <h2>Attached work</h2>
              </div>
            </div>
            <div className="engine-list">
              {profile.actions.length > 0 ? (
                profile.actions.map((action) => (
                  <div className="engine-row" key={action.id}>
                    <div>
                      <strong>{action.type}</strong>
                      <span>
                        {action.status} - {formatDate(action.createdAt)}
                      </span>
                      {textValue(action.input.body) ? (
                        <p className="body-preview">
                          {textValue(action.input.body)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-copy">
                  No actions linked to this contact yet.
                </p>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Audit</p>
                <h2>History</h2>
              </div>
            </div>
            <div className="engine-list">
              {profile.auditLogs.length > 0 ? (
                profile.auditLogs.map((log) => (
                  <div className="engine-row" key={log.id}>
                    <div>
                      <strong>{log.action}</strong>
                      <span>
                        {log.actorType} - {log.entityType} -{" "}
                        {formatDate(log.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-copy">
                  No audit history linked to this contact yet.
                </p>
              )}
            </div>
          </article>
        </aside>
      </section>
    </AppFrame>
  );
}
