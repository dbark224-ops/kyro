"use client";

import Link from "next/link";
import {
  applyLifecycleSuggestionAction,
  clearLifecycleManualOverrideAction,
  dismissLifecycleSuggestionAction,
  mergeContactProfilesAction,
  resolveProfileReviewAction,
  updateContactProfileAction,
} from "../contacts/actions";
import { AddressAutocompleteField } from "./address-autocomplete-field";
import {
  CONTACT_TYPE_OPTIONS,
  formatContactType,
} from "../../lib/crm/contact-types";
import {
  CONTACT_LIFECYCLE_OPTIONS,
  CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE,
  formatContactLifecycleSource,
  formatContactLifecycleStage,
} from "../../lib/crm/lifecycle";
import type { ContactProfile } from "../../lib/crm/queries";

type ContactProfilePanelProps = Readonly<{
  className?: string;
  closeHref?: string;
  engineError?: string;
  engineMessage?: string;
  onClose?: () => void;
  profile: ContactProfile;
  profileHref?: (contactId: string) => string;
  redirectTo?: string;
  successHref?: (contactId: string) => string;
  titleEyebrow?: string;
}>;

export function ContactProfilePanel({
  className,
  closeHref,
  engineError,
  engineMessage,
  onClose,
  profile,
  profileHref,
  redirectTo,
  successHref,
  titleEyebrow = "Profile",
}: ContactProfilePanelProps) {
  const displayName = contactTitle(profile.contact);
  const currentRedirectTo =
    redirectTo ?? `/contacts?contactId=${encodeURIComponent(profile.contact.id)}`;
  const contactHref =
    profileHref ??
    ((contactId: string) => `/contacts?contactId=${encodeURIComponent(contactId)}`);
  const mergeSuccessHref = successHref ?? contactHref;
  const pendingLifecycleSuggestions = lifecycleSuggestions(profile);
  const rootClassName = ["panel", "crm-profile-panel", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={rootClassName}>
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">{titleEyebrow}</p>
          <h2>{displayName}</h2>
        </div>
        <div className="action-row">
          {onClose ? (
            <button
              className="secondary-button compact"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          ) : closeHref ? (
            <Link className="secondary-button compact" href={closeHref}>
              Close
            </Link>
          ) : null}
        </div>
      </header>

      <div className="crm-profile-body">
        {engineError ? <p className="form-alert error">{engineError}</p> : null}
        {engineMessage ? <p className="form-alert">{engineMessage}</p> : null}

        <section
          className="compact-metrics"
          aria-label="Contact profile metrics"
        >
          <span>
            <strong>{profile.counts.messages}</strong> messages
          </span>
          <span>
            <strong>{profile.counts.leads}</strong> leads
          </span>
          <span>
            <strong>{profile.counts.quoteDrafts}</strong> documents
          </span>
          <span>
            <strong>
              {formatContactLifecycleStage(profile.contact.lifecycleStage)}
            </strong>{" "}
            lifecycle
          </span>
        </section>

        {profile.contact.lifecycleSource === "manual" ? (
          <section className="assistant-preview-panel profile-warning-panel">
            <div className="assistant-preview-row">
              <div>
                <strong>Manual lifecycle override</strong>
                <span>
                  Automated review will skip this profile until the override is
                  cleared.
                </span>
              </div>
              <form action={clearLifecycleManualOverrideAction}>
                <input
                  name="contactId"
                  type="hidden"
                  value={profile.contact.id}
                />
                <input
                  name="redirectTo"
                  type="hidden"
                  value={currentRedirectTo}
                />
                <button className="secondary-button compact" type="submit">
                  Allow automated review
                </button>
              </form>
            </div>
          </section>
        ) : null}

        <ProfileResolutionPanel
          profile={profile}
          redirectTo={currentRedirectTo}
          successHref={mergeSuccessHref}
        />

        {pendingLifecycleSuggestions.length > 0 ? (
          <section className="assistant-preview-panel profile-warning-panel">
            <h3>Lifecycle suggestion</h3>
            <div className="assistant-preview-list compact">
              {pendingLifecycleSuggestions.map((action) => (
                <article className="assistant-preview-row" key={action.id}>
                  <div>
                    <strong>
                      Move to{" "}
                      {formatContactLifecycleStage(
                        textValue(action.input.recommendedStage),
                      )}
                    </strong>
                    <span>
                      {textValue(action.input.reason) ??
                        "Lifecycle review found stronger customer evidence."}
                    </span>
                  </div>
                  <div className="action-row">
                    <form action={applyLifecycleSuggestionAction}>
                      <input name="actionId" type="hidden" value={action.id} />
                      <input
                        name="contactId"
                        type="hidden"
                        value={profile.contact.id}
                      />
                      <input
                        name="redirectTo"
                        type="hidden"
                        value={currentRedirectTo}
                      />
                      <button className="primary-button compact" type="submit">
                        Apply
                      </button>
                    </form>
                    <form action={dismissLifecycleSuggestionAction}>
                      <input name="actionId" type="hidden" value={action.id} />
                      <input
                        name="contactId"
                        type="hidden"
                        value={profile.contact.id}
                      />
                      <input
                        name="redirectTo"
                        type="hidden"
                        value={currentRedirectTo}
                      />
                      <button
                        className="secondary-button compact"
                        type="submit"
                      >
                        Ignore
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="assistant-preview-panel">
          <h3>Edit contact</h3>
          <form
            className="profile-form crm-profile-form"
            action={updateContactProfileAction}
            key={profile.contact.id}
          >
            <input name="contactId" type="hidden" value={profile.contact.id} />
            <input
              name="redirectTo"
              type="hidden"
              value={currentRedirectTo}
            />
            <input
              name="originalLifecycleStage"
              type="hidden"
              value={profile.contact.lifecycleStage}
            />
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
              Lifecycle
              <select
                name="lifecycleStage"
                defaultValue={profile.contact.lifecycleStage}
              >
                {CONTACT_LIFECYCLE_OPTIONS.map((option) => (
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
            <AddressAutocompleteField
              defaultValue={profile.contact.address ?? ""}
              label="Address"
              name="address"
            />
            <label className="full-row">
              Notes
              <textarea
                name="notes"
                defaultValue={profile.contact.notes ?? ""}
                rows={4}
              />
            </label>
            <button
              className="primary-button compact profile-submit"
              type="submit"
            >
              Save profile
            </button>
          </form>
        </section>

        <section className="assistant-preview-panel">
          <h3>Snapshot</h3>
          <ProfileFacts
            facts={[
              ["Email", profile.contact.email],
              ["Phone", profile.contact.phone],
              ["Company", profile.contact.company],
              ["Address", profile.contact.address],
              ["Type", formatContactType(profile.contact.contactType)],
              [
                "Lifecycle",
                formatContactLifecycleStage(profile.contact.lifecycleStage),
              ],
              [
                "Lifecycle source",
                formatContactLifecycleSource(profile.contact.lifecycleSource),
              ],
              ["Lifecycle reason", profile.contact.lifecycleReason],
              ["Updated", formatDate(profile.contact.updatedAt)],
            ]}
          />
        </section>

        {profile.companyContacts.length > 0 ? (
          <section className="assistant-preview-panel">
            <h3>People at {profile.contact.company}</h3>
            <div className="assistant-preview-list compact">
              {profile.companyContacts.map((companyContact) => (
                <Link
                  className="assistant-preview-row plain-link"
                  href={contactHref(companyContact.id)}
                  key={companyContact.id}
                  prefetch={false}
                >
                  <div>
                    <strong>{contactTitle(companyContact)}</strong>
                    <span>
                      {[companyContact.email, companyContact.phone]
                        .filter(Boolean)
                        .join(" - ") || "No contact details yet"}
                    </span>
                  </div>
                  <span className="pill">
                    {formatContactType(companyContact.contactType)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="assistant-preview-panel">
          <h3>Leads</h3>
          {profile.leads.length > 0 ? (
            <div className="assistant-preview-list compact">
              {profile.leads.map((lead) => (
                <article className="assistant-preview-row" key={lead.id}>
                  <div>
                    <strong>{lead.title}</strong>
                    <span>
                      {formatLabel(lead.status)} -{" "}
                      {lead.serviceType ?? "No service type"}
                    </span>
                    {lead.nextStep ? <p>{lead.nextStep}</p> : null}
                  </div>
                  <span
                    className={
                      lead.priority === "high" ? "pill warning" : "pill"
                    }
                  >
                    {formatLabel(lead.priority)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-copy">No leads attached to this contact.</p>
          )}
        </section>

        <section className="assistant-preview-panel">
          <h3>Messages</h3>
          {profile.messages.length > 0 ? (
            <div className="assistant-preview-thread">
              {profile.messages.slice(0, 8).map((message) => {
                const content = (
                  <article
                    className={`preview-message ${
                      message.direction === "outbound" ? "outbound" : "inbound"
                    }`}
                  >
                    <div className="preview-message-meta">
                      <strong>{formatLabel(message.direction)}</strong>
                      <span>
                        {formatDate(
                          message.receivedAt ??
                            message.sentAt ??
                            message.createdAt,
                        )}
                      </span>
                    </div>
                    {message.subject ? <strong>{message.subject}</strong> : null}
                    <p>{message.bodyText ?? "No message body."}</p>
                  </article>
                );

                return message.conversationId ? (
                  <Link
                    className="plain-link"
                    href={`/inbox?conversationId=${message.conversationId}`}
                    key={message.id}
                    prefetch={false}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={message.id}>{content}</div>
                );
              })}
            </div>
          ) : (
            <p className="empty-copy">No messages linked to this contact.</p>
          )}
        </section>

        <section className="assistant-preview-panel">
          <h3>Documents and actions</h3>
          <div className="assistant-preview-list compact">
            {profile.quoteDrafts.slice(0, 4).map((quoteDraft) => (
              <Link
                className="assistant-preview-row plain-link"
                href={`/files/${quoteDraft.id}`}
                key={quoteDraft.id}
                prefetch={false}
              >
                <div>
                  <strong>{quoteDraft.title}</strong>
                  <span>
                    {formatLabel(quoteDraft.status)} -{" "}
                    {quoteDraft.lineItemCount} line items
                  </span>
                </div>
                <span>{formatDate(quoteDraft.updatedAt)}</span>
              </Link>
            ))}
            {profile.actions.slice(0, 4).map((action) => (
              <article className="assistant-preview-row" key={action.id}>
                <div>
                  <strong>{formatLabel(action.type)}</strong>
                  <span>
                    {formatLabel(action.status)} -{" "}
                    {formatDate(action.createdAt)}
                  </span>
                  {textValue(action.input.body) ? (
                    <p>{textValue(action.input.body)}</p>
                  ) : null}
                </div>
              </article>
            ))}
            {profile.quoteDrafts.length === 0 && profile.actions.length === 0 ? (
              <p className="empty-copy">No documents or actions linked yet.</p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function ProfileFacts({
  facts,
}: Readonly<{ facts: Array<[label: string, value: string | null]> }>) {
  return (
    <div className="assistant-preview-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value || "-"}</strong>
        </div>
      ))}
    </div>
  );
}

function ProfileResolutionPanel({
  profile,
  redirectTo,
  successHref,
}: Readonly<{
  profile: ContactProfile;
  redirectTo: string;
  successHref: (contactId: string) => string;
}>) {
  const hasWarnings = profile.identityWarnings.length > 0;
  const hasConflict =
    profile.contact.profileResolutionStatus === "needs_review";
  const hasMerged = profile.contact.profileResolutionStatus === "merged";
  const hasDuplicateReview =
    hasWarnings || profile.resolutionCandidates.length > 0;
  const shouldCollapseResolvedDuplicates =
    !hasConflict && !hasMerged && hasDuplicateReview;
  const needsPanel =
    hasConflict ||
    hasWarnings ||
    hasMerged ||
    profile.mergedSources.length > 0 ||
    profile.resolutionCandidates.length > 0;
  const shouldShowReviewAction = hasConflict || hasWarnings;
  const showReviewWithCandidate =
    shouldShowReviewAction && profile.resolutionCandidates.length === 1;

  if (!needsPanel) {
    return null;
  }

  if (shouldCollapseResolvedDuplicates) {
    return (
      <details className="profile-resolution-disclosure">
        <summary>Resolve duplicates</summary>
        <ProfileResolutionPanelBody
          hasConflict={hasConflict}
          hasMerged={hasMerged}
          hasWarnings={hasWarnings}
          profile={profile}
          redirectTo={redirectTo}
          shouldShowReviewAction={shouldShowReviewAction}
          showReviewWithCandidate={showReviewWithCandidate}
          successHref={successHref}
        />
      </details>
    );
  }

  return (
    <ProfileResolutionPanelBody
      hasConflict={hasConflict}
      hasMerged={hasMerged}
      hasWarnings={hasWarnings}
      profile={profile}
      redirectTo={redirectTo}
      shouldShowReviewAction={shouldShowReviewAction}
      showReviewWithCandidate={showReviewWithCandidate}
      successHref={successHref}
    />
  );
}

function ProfileResolutionPanelBody({
  hasConflict,
  hasMerged,
  hasWarnings,
  profile,
  redirectTo,
  shouldShowReviewAction,
  showReviewWithCandidate,
  successHref,
}: Readonly<{
  hasConflict: boolean;
  hasMerged: boolean;
  hasWarnings: boolean;
  profile: ContactProfile;
  redirectTo: string;
  shouldShowReviewAction: boolean;
  showReviewWithCandidate: boolean;
  successHref: (contactId: string) => string;
}>) {
  return (
    <section className="assistant-preview-panel profile-warning-panel profile-resolution-panel">
      {hasWarnings ? (
        <span className="pill warning profile-resolution-duplicate-pill">
          Duplicate
        </span>
      ) : null}
      <div className="panel-heading tight">
        <div>
          <h3>Profile resolution</h3>
          <p>
            Resolve profile conflicts and duplicates without losing messages,
            leads, quote drafts, or audit history.
          </p>
        </div>
        {hasConflict ? <span className="pill warning">Needs review</span> : null}
        {hasMerged ? <span className="pill">Merged</span> : null}
      </div>

      {profile.contact.profileResolutionReason ? (
        <p className="empty-copy">{profile.contact.profileResolutionReason}</p>
      ) : null}

      {hasWarnings ? (
        <div className="assistant-preview-list compact">
          {profile.identityWarnings.map((warning) => (
            <article
              className="profile-resolution-warning-row"
              key={`${warning.field}-${warning.value}`}
            >
              <div className="profile-resolution-copy">
                <strong>
                  Same {warning.field} appears on {warning.count} profiles
                </strong>
                <span>{warning.value}</span>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {profile.resolutionCandidates.length > 0 ? (
        <div className="assistant-preview-list compact">
          {profile.resolutionCandidates.map((candidate) => (
            <article
              className="profile-resolution-candidate-row"
              key={candidate.id}
            >
              <div className="profile-resolution-copy">
                <strong>{contactTitle(candidate)}</strong>
                <span>
                  {[candidate.company, candidate.email, candidate.phone]
                    .filter(Boolean)
                    .join(" - ") || "No contact details yet"}
                </span>
                <span>{formatResolutionMatchFields(candidate.matchFields)}</span>
              </div>
              <div className="profile-resolution-actions">
                <form action={mergeContactProfilesAction}>
                  <input
                    name="sourceContactId"
                    type="hidden"
                    value={profile.contact.id}
                  />
                  <input
                    name="targetContactId"
                    type="hidden"
                    value={candidate.id}
                  />
                  <input name="redirectTo" type="hidden" value={redirectTo} />
                  <input
                    name="successRedirectTo"
                    type="hidden"
                    value={successHref(candidate.id)}
                  />
                  <input
                    name="reason"
                    type="hidden"
                    value="Merged current profile into selected existing profile."
                  />
                  <button
                    className="primary-button compact profile-resolution-button"
                    type="submit"
                  >
                    Merge into this profile
                  </button>
                </form>
                {showReviewWithCandidate ? (
                  <ProfileResolutionReviewForm
                    contactId={profile.contact.id}
                    redirectTo={redirectTo}
                  />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {profile.mergedSources.length > 0 ? (
        <div className="assistant-preview-list compact">
          {profile.mergedSources.map((source) => (
            <article className="assistant-preview-row" key={source.id}>
              <div>
                <strong>{contactTitle(source)}</strong>
                <span>
                  {[source.company, source.email, source.phone]
                    .filter(Boolean)
                    .join(" - ") || "Previous duplicate profile"}
                </span>
              </div>
              <span className="pill">Merged source</span>
            </article>
          ))}
        </div>
      ) : null}

      {shouldShowReviewAction && !showReviewWithCandidate ? (
        <div className="profile-resolution-actions stand-alone">
          <ProfileResolutionReviewForm
            contactId={profile.contact.id}
            redirectTo={redirectTo}
          />
        </div>
      ) : null}
    </section>
  );
}

function ProfileResolutionReviewForm({
  contactId,
  redirectTo,
}: Readonly<{
  contactId: string;
  redirectTo: string;
}>) {
  return (
    <form
      action={resolveProfileReviewAction}
      className="profile-resolution-review-form"
    >
      <input name="contactId" type="hidden" value={contactId} />
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <input
        name="reason"
        type="hidden"
        value="Reviewed from CRM and kept as a separate profile."
      />
      <button
        className="secondary-button compact profile-resolution-button"
        type="submit"
      >
        Mark reviewed, keep separate
      </button>
    </form>
  );
}

function lifecycleSuggestions(profile: ContactProfile) {
  return profile.actions.filter(
    (action) =>
      action.type === CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE &&
      ["approved", "pending_approval", "requested"].includes(action.status),
  );
}

function formatResolutionMatchFields(
  fields: ContactProfile["resolutionCandidates"][number]["matchFields"],
) {
  if (fields.includes("profile_conflict")) {
    return "Email and phone point to different profiles";
  }

  if (fields.includes("email") && fields.includes("phone")) {
    return "Same email and phone";
  }

  if (fields.includes("email")) {
    return "Same email";
  }

  if (fields.includes("phone")) {
    return "Same phone";
  }

  return "Possible match";
}

function contactTitle(contact: {
  company?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
}) {
  return (
    contact.name ??
    contact.company ??
    contact.email ??
    contact.phone ??
    "Unknown contact"
  );
}

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

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
