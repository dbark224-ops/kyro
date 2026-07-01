import {
  applyLifecycleSuggestionAction,
  clearLifecycleManualOverrideAction,
  dismissLifecycleSuggestionAction,
  mergeContactProfilesAction,
  resolveProfileReviewAction,
  updateContactProfileAction,
} from "./actions";
import { AppFrame } from "../components/app-frame";
import { AddressAutocompleteField } from "../components/address-autocomplete-field";
import { AutoSubmitSelect } from "../components/auto-submit-select";
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
import {
  getContactList,
  getContactProfile,
  getLeadList,
  type ContactListItem,
  type ContactProfile,
  type LeadListItem,
} from "../../lib/crm/queries";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";
import Link from "next/link";
import { ManualLeadModal } from "./manual-lead-modal";

export const dynamic = "force-dynamic";

type ContactsPageProps = {
  searchParams?: Promise<{
    address?: string;
    contactId?: string;
    email?: string;
    engine_error?: string;
    engine_message?: string;
    filter?: string;
    page?: string;
    phone?: string;
    q?: string;
    sort?: string;
  }>;
};

const CRM_FILTERS = [
  { label: "All", value: "all" },
  { label: "Leads", value: "leads" },
  { label: "Profile review", value: "profile_review" },
  { label: "Clients", value: "client" },
  { label: "Suppliers", value: "supplier" },
  { label: "Contractors", value: "contractor" },
  { label: "Builders", value: "builder" },
  { label: "Property managers", value: "property_manager" },
  { label: "Other", value: "other" },
] as const;

const CRM_SORT_OPTIONS = [
  { label: "Last interacted", value: "recent" },
  { label: "Alphabetical", value: "alphabetical" },
  { label: "Most messages", value: "messages" },
  { label: "Most leads", value: "lead_count" },
] as const;

type CrmFilter = (typeof CRM_FILTERS)[number]["value"];
type CrmSort = (typeof CRM_SORT_OPTIONS)[number]["value"];
const CRM_PAGE_SIZE = 10;
type CrmSearchState = {
  address: string;
  email: string;
  phone: string;
  q: string;
};

function isCrmFilter(value: string | undefined): value is CrmFilter {
  return CRM_FILTERS.some((filter) => filter.value === value);
}

function isCrmSort(value: string | undefined): value is CrmSort {
  return CRM_SORT_OPTIONS.some((sort) => sort.value === value);
}

function normalizePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function crmHref({
  contactId,
  filter,
  page,
  search,
  sort,
}: {
  contactId?: string | null;
  filter: CrmFilter;
  page?: number;
  search?: CrmSearchState;
  sort?: CrmSort;
}) {
  const params = new URLSearchParams();

  if (filter !== "all") {
    params.set("filter", filter);
  }

  if (sort && sort !== "recent") {
    params.set("sort", sort);
  }

  if (search?.q) {
    params.set("q", search.q);
  }

  if (search?.email) {
    params.set("email", search.email);
  }

  if (search?.phone) {
    params.set("phone", search.phone);
  }

  if (search?.address) {
    params.set("address", search.address);
  }

  if (contactId) {
    params.set("contactId", contactId);
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();

  return query ? `/contacts?${query}` : "/contacts";
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

function normalizeSearch(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function includesNeedle(value: string | null | undefined, needle: string) {
  return !needle || Boolean(value?.toLowerCase().includes(needle));
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

function duplicateWarningLabel(warnings: ContactListItem["duplicateWarnings"]) {
  if (warnings.length === 0) {
    return null;
  }

  const fields = warnings.map((warning) => warning.field);

  if (fields.includes("email") && fields.includes("phone")) {
    return "Duplicate email + phone";
  }

  return fields.includes("email") ? "Duplicate email" : "Duplicate phone";
}

function contactNeedsProfileReview(contact: ContactListItem) {
  return (
    contact.profileResolutionStatus === "needs_review" ||
    contact.duplicateWarnings.length > 0
  );
}

function profileResolutionLabel(contact: ContactListItem) {
  if (contact.profileResolutionStatus === "needs_review") {
    return "Profile conflict";
  }

  if (contact.profileResolutionStatus === "merged") {
    return "Merged";
  }

  return duplicateWarningLabel(contact.duplicateWarnings);
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

function contactSearchText(contact: ContactListItem) {
  return [
    contact.name,
    contact.company,
    contact.email,
    contact.phone,
    contact.address,
    contact.source,
    contact.notes,
    contact.contactType,
    contact.lifecycleStage,
    contact.lifecycleSource,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function leadSearchText(lead: LeadListItem) {
  return [
    lead.title,
    lead.description,
    lead.source,
    lead.status,
    lead.priority,
    lead.followUpIsDue ? "follow-up due" : null,
    lead.followUpDueAt,
    lead.serviceType,
    lead.nextStep,
    lead.estimatedValue,
    lead.contact?.name,
    lead.contact?.company,
    lead.contact?.email,
    lead.contact?.phone,
    lead.contact?.address,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function contactMatchesSearch(
  contact: ContactListItem,
  search: CrmSearchState,
) {
  return (
    (!search.q || contactSearchText(contact).includes(search.q)) &&
    includesNeedle(contact.email, search.email) &&
    includesNeedle(contact.phone, search.phone) &&
    includesNeedle(contact.address, search.address)
  );
}

function leadMatchesSearch(lead: LeadListItem, search: CrmSearchState) {
  return (
    (!search.q || leadSearchText(lead).includes(search.q)) &&
    includesNeedle(lead.contact?.email, search.email) &&
    includesNeedle(lead.contact?.phone, search.phone) &&
    includesNeedle(lead.contact?.address, search.address)
  );
}

function contactRecency(contact: ContactListItem) {
  return new Date(contact.lastMessageAt ?? contact.updatedAt).getTime();
}

function sortContacts(
  contacts: ContactListItem[],
  sort: CrmSort,
  leadCountsByContact: Map<string, number>,
) {
  return [...contacts].sort((left, right) => {
    if (sort === "alphabetical") {
      return contactTitle(left).localeCompare(contactTitle(right));
    }

    if (sort === "messages") {
      return (
        right.messageCount - left.messageCount ||
        contactRecency(right) - contactRecency(left)
      );
    }

    if (sort === "lead_count") {
      return (
        (leadCountsByContact.get(right.id) ?? 0) -
          (leadCountsByContact.get(left.id) ?? 0) ||
        contactRecency(right) - contactRecency(left)
      );
    }

    return contactRecency(right) - contactRecency(left);
  });
}

function sortLeads(
  leads: LeadListItem[],
  sort: CrmSort,
  contactsById: Map<string, ContactListItem>,
  leadCountsByContact: Map<string, number>,
) {
  return [...leads].sort((left, right) => {
    if (sort === "alphabetical") {
      return left.title.localeCompare(right.title);
    }

    if (sort === "messages") {
      return (
        (contactsById.get(right.contactId ?? "")?.messageCount ?? 0) -
          (contactsById.get(left.contactId ?? "")?.messageCount ?? 0) ||
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    }

    if (sort === "lead_count") {
      return (
        (leadCountsByContact.get(right.contactId ?? "") ?? 0) -
          (leadCountsByContact.get(left.contactId ?? "") ?? 0) ||
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    }

    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
}

function ContactRow({
  activeFilter,
  contact,
  isSelected,
  page,
  search,
  sort,
}: Readonly<{
  activeFilter: CrmFilter;
  contact: ContactListItem;
  isSelected: boolean;
  page: number;
  search: CrmSearchState;
  sort: CrmSort;
}>) {
  const warningLabel = profileResolutionLabel(contact);

  return (
    <SmartPrefetchLink
      className={[
        "crm-row",
        isSelected ? "active" : "",
        contactNeedsProfileReview(contact) ? "identity-warning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      href={crmHref({
        contactId: contact.id,
        filter: activeFilter,
        page,
        search,
        sort,
      })}
    >
      <div className="crm-row-main">
        <strong>{contactTitle(contact)}</strong>
        <span>
          {[contact.company, contact.email, contact.phone]
            .filter(Boolean)
            .join(" - ") ||
            contact.source ||
            "No contact details yet"}
        </span>
      </div>
      <div className="crm-row-meta">
        {warningLabel ? (
          <span className="pill warning">{warningLabel}</span>
        ) : null}
        <span>{contact.messageCount} messages</span>
        <span>{formatDate(contact.lastMessageAt ?? contact.updatedAt)}</span>
        <span className="pill">
          {formatContactLifecycleStage(contact.lifecycleStage)}
        </span>
        <span className="pill">{formatContactType(contact.contactType)}</span>
      </div>
    </SmartPrefetchLink>
  );
}

function LeadRow({
  activeFilter,
  isSelected,
  lead,
  page,
  search,
  sort,
}: Readonly<{
  activeFilter: CrmFilter;
  isSelected: boolean;
  lead: LeadListItem;
  page: number;
  search: CrmSearchState;
  sort: CrmSort;
}>) {
  const href = lead.contactId
    ? crmHref({
        contactId: lead.contactId,
        filter: activeFilter,
        page,
        search,
        sort,
      })
    : lead.conversationId
      ? `/inbox?conversationId=${lead.conversationId}`
      : "/inbox";
  const leadDetails =
    [
      lead.contact?.name ?? lead.contact?.company,
      lead.contact?.email,
      lead.contact?.phone,
    ]
      .filter(Boolean)
      .join(" - ") || lead.source;

  return (
    <SmartPrefetchLink
      className={[
        "crm-row",
        isSelected ? "active" : null,
        lead.followUpIsDue ? "identity-warning" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      href={href}
    >
      <div className="crm-row-main">
        <strong>{lead.title}</strong>
        <span>{leadDetails || "No contact details yet"}</span>
      </div>
      <div className="crm-row-meta">
        {lead.followUpIsDue ? (
          <span className="pill warning">Follow-up due</span>
        ) : null}
        <span>{formatLabel(lead.status)}</span>
        <span>{formatDate(lead.updatedAt)}</span>
        <span className={lead.priority === "high" ? "pill warning" : "pill"}>
          Lead
        </span>
      </div>
    </SmartPrefetchLink>
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
  successHref,
}: Readonly<{
  hasConflict: boolean;
  hasMerged: boolean;
  hasWarnings: boolean;
  profile: ContactProfile;
  redirectTo: string;
  successHref: (contactId: string) => string;
}>) {
  const shouldShowReviewAction = hasConflict || hasWarnings;
  const showReviewWithCandidate =
    shouldShowReviewAction && profile.resolutionCandidates.length === 1;

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
        {hasConflict ? (
          <span className="pill warning">Needs review</span>
        ) : null}
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
                <span>
                  {formatResolutionMatchFields(candidate.matchFields)}
                </span>
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

function ProfilePanel({
  activeFilter,
  engineError,
  engineMessage,
  profile,
  search,
  sort,
}: Readonly<{
  activeFilter: CrmFilter;
  engineError?: string;
  engineMessage?: string;
  profile: ContactProfile;
  search: CrmSearchState;
  sort: CrmSort;
}>) {
  const displayName = contactTitle(profile.contact);
  const redirectTo = crmHref({
    contactId: profile.contact.id,
    filter: activeFilter,
    search,
    sort,
  });
  const pendingLifecycleSuggestions = lifecycleSuggestions(profile);

  return (
    <section className="panel crm-profile-panel">
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h2>{displayName}</h2>
        </div>
        <div className="action-row">
          <Link
            className="secondary-button compact"
            href={crmHref({ filter: activeFilter, search, sort })}
          >
            Close
          </Link>
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
                <input name="redirectTo" type="hidden" value={redirectTo} />
                <button className="secondary-button compact" type="submit">
                  Allow automated review
                </button>
              </form>
            </div>
          </section>
        ) : null}

        <ProfileResolutionPanel
          profile={profile}
          redirectTo={redirectTo}
          successHref={(contactId) =>
            crmHref({
              contactId,
              filter: activeFilter,
              search,
              sort,
            })
          }
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
                        value={redirectTo}
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
                        value={redirectTo}
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
            <input name="redirectTo" type="hidden" value={redirectTo} />
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
                  href={crmHref({
                    contactId: companyContact.id,
                    filter: activeFilter,
                    search,
                    sort,
                  })}
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
                    {message.subject ? (
                      <strong>{message.subject}</strong>
                    ) : null}
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
            {profile.quoteDrafts.length === 0 &&
            profile.actions.length === 0 ? (
              <p className="empty-copy">No documents or actions linked yet.</p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function EmptyProfilePanel() {
  return (
    <section className="panel crm-profile-panel crm-placeholder">
      <div>
        <p className="eyebrow">Profile</p>
        <h2>Select a contact</h2>
        <p>
          Choose a customer, supplier, contractor, builder, property manager, or
          lead from the CRM list to view and edit their profile here.
        </p>
      </div>
    </section>
  );
}

export default async function ContactsPage({
  searchParams,
}: ContactsPageProps) {
  const query = await searchParams;
  const { supabase, workspace } = await requireWorkspaceContext();
  const activeFilter = isCrmFilter(query?.filter) ? query.filter : "all";
  const activeSort = isCrmSort(query?.sort) ? query.sort : "recent";
  const requestedPage = normalizePage(query?.page);
  const searchState = {
    address: normalizeSearch(query?.address),
    email: normalizeSearch(query?.email),
    phone: normalizeSearch(query?.phone),
    q: normalizeSearch(query?.q),
  };
  const hasAdvancedSearch =
    Boolean(searchState.email) ||
    Boolean(searchState.phone) ||
    Boolean(searchState.address);
  const hasSearch = Boolean(searchState.q) || hasAdvancedSearch;
  const selectedContactId = query?.contactId?.trim() ?? "";
  const [contacts, leads, selectedProfile] = await Promise.all([
    getContactList(supabase, workspace.id),
    getLeadList(supabase, workspace.id),
    selectedContactId
      ? getContactProfile(supabase, workspace.id, selectedContactId)
      : Promise.resolve(null),
  ]);
  const withAddress = contacts.filter((contact) => contact.address).length;
  const totalMessages = contacts.reduce(
    (sum, contact) => sum + contact.messageCount,
    0,
  );
  const newLeads = leads.filter((lead) => lead.status === "new").length;
  const contactsById = new Map(
    contacts.map((contact) => [contact.id, contact]),
  );
  const leadCountsByContact = new Map<string, number>();

  for (const lead of leads) {
    if (lead.contactId) {
      leadCountsByContact.set(
        lead.contactId,
        (leadCountsByContact.get(lead.contactId) ?? 0) + 1,
      );
    }
  }

  const searchedContacts = contacts.filter((contact) =>
    contactMatchesSearch(contact, searchState),
  );
  const searchedLeads = leads.filter((lead) =>
    leadMatchesSearch(lead, searchState),
  );
  const filterCounts = new Map<CrmFilter, number>(
    CRM_FILTERS.map((filter) => [
      filter.value,
      filter.value === "all"
        ? searchedContacts.length
        : filter.value === "leads"
          ? searchedLeads.length
          : filter.value === "profile_review"
            ? searchedContacts.filter(contactNeedsProfileReview).length
            : searchedContacts.filter(
                (contact) => contact.contactType === filter.value,
              ).length,
    ]),
  );
  const filteredContacts =
    activeFilter === "all"
      ? searchedContacts
      : activeFilter === "leads"
        ? []
        : activeFilter === "profile_review"
          ? searchedContacts.filter(contactNeedsProfileReview)
          : searchedContacts.filter(
              (contact) => contact.contactType === activeFilter,
            );
  const sortedContacts = sortContacts(
    filteredContacts,
    activeSort,
    leadCountsByContact,
  );
  const sortedLeads = sortLeads(
    searchedLeads,
    activeSort,
    contactsById,
    leadCountsByContact,
  );
  const totalItems =
    activeFilter === "leads" ? sortedLeads.length : sortedContacts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / CRM_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * CRM_PAGE_SIZE;
  const paginatedContacts = sortedContacts.slice(
    pageStart,
    pageStart + CRM_PAGE_SIZE,
  );
  const paginatedLeads = sortedLeads.slice(pageStart, pageStart + CRM_PAGE_SIZE);
  const selectedLeadContactIds = new Set(
    searchedLeads
      .filter((lead) => lead.contactId)
      .map((lead) => lead.contactId as string),
  );

  return (
    <AppFrame active="CRM">
      <header className="topbar page-topbar-tight">
        <div>
          <h1>CRM</h1>
        </div>
        <div className="topbar-right">
          <section className="metric-grid" aria-label="CRM metrics">
            <article className="metric-card cyan">
              <p>Contacts</p>
              <strong>{contacts.length}</strong>
              <span>Contact records</span>
            </article>
            <article className="metric-card purple">
              <p>Leads</p>
              <strong>{leads.length}</strong>
              <span>{newLeads} new</span>
            </article>
            <article className="metric-card pink">
              <p>Messages</p>
              <strong>{totalMessages}</strong>
              <span>{withAddress} profiles with address</span>
            </article>
          </section>
        </div>
      </header>

      <section className="crm-workspace">
        <section className="panel crm-list-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CRM</p>
              <h2>People, companies and leads</h2>
            </div>
            <div className="action-row">
              <ManualLeadModal />
              <span className="pill">
                {totalItems === 0
                  ? "0 shown"
                  : `${pageStart + 1}-${Math.min(
                      pageStart + CRM_PAGE_SIZE,
                      totalItems,
                    )} of ${totalItems}`}
              </span>
            </div>
          </div>

          <nav className="filter-bar" aria-label="CRM filters">
            {CRM_FILTERS.map((filter) => (
              <Link
                className={
                  activeFilter === filter.value
                    ? "filter-pill active"
                    : "filter-pill"
                }
                href={crmHref({
                  contactId: selectedProfile?.contact.id,
                  filter: filter.value,
                  search: searchState,
                  sort: activeSort,
                })}
                key={filter.value}
                prefetch={false}
              >
                {filter.label}
                <span>{filterCounts.get(filter.value) ?? 0}</span>
              </Link>
            ))}
          </nav>

          <form action="/contacts" className="crm-toolbar" method="get">
            {activeFilter !== "all" ? (
              <input name="filter" type="hidden" value={activeFilter} />
            ) : null}
            {selectedProfile ? (
              <input
                name="contactId"
                type="hidden"
                value={selectedProfile.contact.id}
              />
            ) : null}
            <div className="crm-search-field">
              <label htmlFor="crm-search-input">Search</label>
              <input
                defaultValue={searchState.q}
                id="crm-search-input"
                name="q"
                placeholder="Name, company, job type..."
                type="search"
              />
            </div>
            <AutoSubmitSelect
              className="crm-sort-field"
              defaultValue={activeSort}
              id="crm-sort-select"
              label="Sort"
              name="sort"
              options={CRM_SORT_OPTIONS}
            />
            {hasSearch ? (
              <Link
                className="secondary-button compact"
                href={crmHref({
                  contactId: selectedProfile?.contact.id,
                  filter: activeFilter,
                  sort: activeSort,
                })}
                prefetch={false}
              >
                Clear
              </Link>
            ) : null}
            <details className="crm-advanced-search" open={hasAdvancedSearch}>
              <summary>Advanced search</summary>
              <div className="crm-advanced-grid">
                <label>
                  Email
                  <input
                    defaultValue={searchState.email}
                    name="email"
                    placeholder="name@example.com"
                    type="search"
                  />
                </label>
                <label>
                  Phone
                  <input
                    defaultValue={searchState.phone}
                    name="phone"
                    placeholder="0400..."
                    type="search"
                  />
                </label>
                <label>
                  Address
                  <input
                    defaultValue={searchState.address}
                    name="address"
                    placeholder="Street, suburb, site..."
                    type="search"
                  />
                </label>
              </div>
            </details>
          </form>

          <div className="crm-list">
            {activeFilter === "leads" ? (
              sortedLeads.length > 0 ? (
                paginatedLeads.map((lead) => (
                  <LeadRow
                    activeFilter={activeFilter}
                    isSelected={Boolean(
                      selectedProfile &&
                      selectedProfile.contact.id === lead.contactId,
                    )}
                    key={lead.id}
                    lead={lead}
                    page={currentPage}
                    search={searchState}
                    sort={activeSort}
                  />
                ))
              ) : (
                <p className="empty-copy">No leads match this view yet.</p>
              )
            ) : sortedContacts.length > 0 ? (
              paginatedContacts.map((contact) => (
                <ContactRow
                  activeFilter={activeFilter}
                  contact={contact}
                  isSelected={selectedProfile?.contact.id === contact.id}
                  key={contact.id}
                  page={currentPage}
                  search={searchState}
                  sort={activeSort}
                />
              ))
            ) : (
              <p className="empty-copy">No CRM records match this view yet.</p>
            )}
          </div>

          {activeFilter !== "leads" && selectedLeadContactIds.size > 0 ? (
            <div className="crm-list-note">
              <span className="pill">
                {selectedLeadContactIds.size} contacts have leads
              </span>
            </div>
          ) : null}

          {totalPages > 1 ? (
            <nav aria-label="CRM pagination" className="pagination-bar">
              <Link
                aria-disabled={currentPage === 1}
                className={
                  currentPage === 1
                    ? "secondary-button compact disabled"
                    : "secondary-button compact"
                }
                href={crmHref({
                  contactId: selectedProfile?.contact.id,
                  filter: activeFilter,
                  page: currentPage - 1,
                  search: searchState,
                  sort: activeSort,
                })}
                prefetch={false}
              >
                Previous
              </Link>
              <span className="pagination-label">
                Page {currentPage} of {totalPages}
              </span>
              <Link
                aria-disabled={currentPage === totalPages}
                className={
                  currentPage === totalPages
                    ? "secondary-button compact disabled"
                    : "secondary-button compact"
                }
                href={crmHref({
                  contactId: selectedProfile?.contact.id,
                  filter: activeFilter,
                  page: currentPage + 1,
                  search: searchState,
                  sort: activeSort,
                })}
                prefetch={false}
              >
                Next
              </Link>
            </nav>
          ) : null}
        </section>

        {selectedProfile ? (
          <ProfilePanel
            activeFilter={activeFilter}
            engineError={query?.engine_error}
            engineMessage={query?.engine_message}
            key={selectedProfile.contact.id}
            profile={selectedProfile}
            search={searchState}
            sort={activeSort}
          />
        ) : (
          <EmptyProfilePanel />
        )}
      </section>
    </AppFrame>
  );
}
