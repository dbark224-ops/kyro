import {
  mergeContactProfilesAction,
  resolveProfileReviewAction,
  updateContactProfileAction,
} from "./actions";
import type { ReactNode } from "react";
import { AppFrame } from "../components/app-frame";
import { AddressAutocompleteField } from "../components/address-autocomplete-field";
import { AddressWithVerification } from "../components/address-verification-badge";
import {
  CrmProfileLink,
  CrmProfileTransitionShell,
} from "./crm-profile-loading";
import { AutoSubmitSelect } from "../components/auto-submit-select";
import {
  CONTACT_TYPE_OPTIONS,
  formatContactType,
} from "../../lib/crm/contact-types";
import { profileResolutionNotice } from "../../lib/crm/profile-resolution-notice";
import { InfoBubble } from "../settings/info-bubble";
import {
  getContactList,
  getContactProfile,
  getLeadList,
  type ContactListItem,
  type ContactProfile,
  type LeadListItem,
} from "../../lib/crm/queries";
import { formatWorkspaceDateTime } from "../../lib/time/format";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import { PendingSmartPrefetchLink } from "../components/pending-smart-prefetch-link";
import { ListPager } from "../components/list-pager";
import { RoutePreloader } from "../components/route-preloader";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";
import { ManualLeadModal } from "./manual-lead-modal";
import { textValue } from "@kyro/core";

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

/**
 * One pill per contact type, plus two that are not types at all.
 *
 * "opportunities" lists the `leads` table -- job enquiries with a value and a
 * status -- which is a different thing from a contact whose type is "lead".
 * They were both called "Leads", which is half of why the counts never added
 * up: 28 opportunities and 24 clients across 25 people. It keeps its own pill
 * under an honest name because /leads only redirects here, so this is the only
 * place that list can be browsed.
 *
 * "profile_review" is a work queue, not a category. It follows the same
 * hide-when-empty rule as the rest, so it only appears when there is something
 * in it.
 */
const CRM_FILTERS = [
  { label: "All", value: "all" },
  { label: "Leads", value: "lead" },
  { label: "Clients", value: "client" },
  { label: "Suppliers", value: "supplier" },
  { label: "Contractors", value: "contractor" },
  { label: "Staff", value: "staff" },
  { label: "Property managers", value: "property_manager" },
  { label: "Other", value: "other" },
  { label: "Opportunities", value: "opportunities" },
  { label: "Profile review", value: "profile_review" },
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

function formatDate(value: string | null, timeZone?: string | null) {
  return formatWorkspaceDateTime({ timeZone, value });
}

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

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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
  const notice = profileResolutionNotice(contact);

  if (notice) {
    return notice.label;
  }

  if (contact.profileResolutionStatus === "merged") {
    return "Merged";
  }

  return duplicateWarningLabel(contact.duplicateWarnings);
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
  timeZone,
  activeFilter,
  contact,
  isFirst,
  isSelected,
  page,
  search,
  sort,
}: Readonly<{
  timeZone: string;
  activeFilter: CrmFilter;
  contact: ContactListItem;
  isFirst: boolean;
  isSelected: boolean;
  page: number;
  search: CrmSearchState;
  sort: CrmSort;
}>) {
  const warningLabel = profileResolutionLabel(contact);
  // A native title rather than the InfoBubble used in the panel: the whole row
  // is a link, and a focusable tooltip inside it would swallow the click.
  const warningExplanation = profileResolutionNotice(contact)?.explanation;
  const contactType = formatContactType(contact.contactType);
  const title = contactTitle(contact);

  return (
    <CrmProfileLink
      className={[
        "crm-row",
        isSelected ? "active" : "",
        contactNeedsProfileReview(contact) ? "identity-warning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      contactId={contact.id}
      href={crmHref({
        contactId: contact.id,
        filter: activeFilter,
        page,
        search,
        sort,
      })}
      label={title}
      // Matches the inbox: the top row is the one most likely to be opened, so
      // it is fetched on mount. The rest fetch on hover or focus.
      preload={isFirst}
      selected={isSelected}
    >
      <div className="crm-row-main">
        <strong>{title}</strong>
        <span>
          {[contact.company, contact.email, contact.phone]
            .filter(Boolean)
            .join(" - ") ||
            contact.source ||
            "No contact details yet"}
        </span>
      </div>
      {/* Fixed-width columns, and the flag cell is always present even when
          empty. Laid out as a right-packed flex row, one contact with a long
          type pill shifted every count and timestamp above and below it. */}
      <div className="crm-row-meta crm-row-meta-contact">
        <div className="crm-row-meta-flag">
          {warningLabel ? (
            <span className="pill warning" title={warningExplanation}>
              {warningLabel}
            </span>
          ) : null}
        </div>
        <span>
          {contact.messageCount}{" "}
          {contact.messageCount === 1 ? "message" : "messages"}
        </span>
        <span>
          {formatDate(contact.lastMessageAt ?? contact.updatedAt, timeZone)}
        </span>
        <span className="pill" title={contactType}>
          {contactType}
        </span>
      </div>
    </CrmProfileLink>
  );
}

function LeadRow({
  timeZone,
  activeFilter,
  isSelected,
  lead,
  page,
  search,
  sort,
}: Readonly<{
  timeZone: string;
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
    <PendingSmartPrefetchLink
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
      <div className="crm-row-meta crm-row-meta-lead">
        <div className="crm-row-meta-flag">
          {lead.followUpIsDue ? (
            <span className="pill warning">Follow-up due</span>
          ) : null}
        </div>
        <span>{formatLabel(lead.status)}</span>
        <span>{formatDate(lead.updatedAt, timeZone)}</span>
        <span className={lead.priority === "high" ? "pill warning" : "pill"}>
          Lead
        </span>
      </div>
    </PendingSmartPrefetchLink>
  );
}

function ProfileFacts({
  facts,
}: Readonly<{ facts: Array<[label: string, value: ReactNode]> }>) {
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
  const resolutionNotice = profileResolutionNotice(profile.contact);

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
        {resolutionNotice ? (
          <span className="pill warning">
            {resolutionNotice.label}
            <InfoBubble label={resolutionNotice.label}>
              {resolutionNotice.explanation}
            </InfoBubble>
          </span>
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
  timeZone,
  activeFilter,
  engineError,
  engineMessage,
  profile,
  search,
  sort,
}: Readonly<{
  timeZone: string;
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

  return (
    <section className="panel crm-profile-panel">
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h2>{displayName}</h2>
        </div>
        <div className="action-row">
          <SmartPrefetchLink
            className="secondary-button compact"
            href={crmHref({ filter: activeFilter, search, sort })}
          >
            Close
          </SmartPrefetchLink>
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
        </section>

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

        <section className="assistant-preview-panel">
          <h3>Edit contact</h3>
          <form
            className="profile-form crm-profile-form"
            action={updateContactProfileAction}
            key={profile.contact.id}
          >
            <input name="contactId" type="hidden" value={profile.contact.id} />
            <input name="redirectTo" type="hidden" value={redirectTo} />
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
            <AddressAutocompleteField
              defaultValue={profile.contact.address ?? ""}
              label="Address"
              name="address"
              verificationStatus={profile.contact.addressValidationStatus}
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
              [
                "Address",
                <AddressWithVerification
                  address={profile.contact.address}
                  key="address"
                  status={profile.contact.addressValidationStatus}
                />,
              ],
              ["Type", formatContactType(profile.contact.contactType)],

              ["Updated", formatDate(profile.contact.updatedAt, timeZone)],
            ]}
          />
        </section>

        {profile.companyContacts.length > 0 ? (
          <section className="assistant-preview-panel">
            <h3>People at {profile.contact.company}</h3>
            <div className="assistant-preview-list compact">
              {profile.companyContacts.map((companyContact) => (
                <SmartPrefetchLink
                  className="assistant-preview-row plain-link"
                  href={crmHref({
                    contactId: companyContact.id,
                    filter: activeFilter,
                    search,
                    sort,
                  })}
                  key={companyContact.id}
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
                </SmartPrefetchLink>
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
                          timeZone,
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
                  <SmartPrefetchLink
                    className="plain-link"
                    href={`/inbox?conversationId=${message.conversationId}`}
                    key={message.id}
                  >
                    {content}
                  </SmartPrefetchLink>
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
              <SmartPrefetchLink
                className="assistant-preview-row plain-link"
                href={`/files/${quoteDraft.id}`}
                key={quoteDraft.id}
              >
                <div>
                  <strong>{quoteDraft.title}</strong>
                  <span>
                    {formatLabel(quoteDraft.status)} -{" "}
                    {quoteDraft.lineItemCount} line items
                  </span>
                </div>
                <span>{formatDate(quoteDraft.updatedAt, timeZone)}</span>
              </SmartPrefetchLink>
            ))}
            {profile.actions.slice(0, 4).map((action) => (
              <article className="assistant-preview-row" key={action.id}>
                <div>
                  <strong>{formatLabel(action.type)}</strong>
                  <span>
                    {formatLabel(action.status)} -{" "}
                    {formatDate(action.createdAt, timeZone)}
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
  const [contacts, leads, selectedProfile, generalSettings] = await Promise.all(
    [
      getContactList(supabase, workspace.id),
      getLeadList(supabase, workspace.id),
      selectedContactId
        ? getContactProfile(supabase, workspace.id, selectedContactId)
        : Promise.resolve(null),
      getWorkspaceGeneralSettings(supabase, workspace.id),
    ],
  );
  const timeZone = generalSettings.timeZone;
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
        : filter.value === "opportunities"
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
      : activeFilter === "opportunities"
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
    activeFilter === "opportunities"
      ? sortedLeads.length
      : sortedContacts.length;
  // Only categories that have someone in them. Nine pills, five of them
  // reading zero, made the bar noise rather than navigation. "All" always
  // shows, and so does whatever is currently selected -- otherwise
  // narrowing a search to nothing would remove the pill you are standing on
  // and leave no way back.
  const visibleFilters = CRM_FILTERS.filter(
    (filter) =>
      filter.value === "all" ||
      filter.value === activeFilter ||
      (filterCounts.get(filter.value) ?? 0) > 0,
  );
  const totalPages = Math.max(1, Math.ceil(totalItems / CRM_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * CRM_PAGE_SIZE;
  const paginatedContacts = sortedContacts.slice(
    pageStart,
    pageStart + CRM_PAGE_SIZE,
  );
  // Warmed on idle, after this page has painted, so clicking down the list is
  // instant rather than only the row you happened to hover first. Four is
  // enough to cover the top of the visible list without turning a page view
  // into five page views.
  const contactPreloadHrefs = paginatedContacts.slice(0, 4).map((contact) =>
    crmHref({
      contactId: contact.id,
      filter: activeFilter,
      page: currentPage,
      search: searchState,
      sort: activeSort,
    }),
  );
  const paginatedLeads = sortedLeads.slice(
    pageStart,
    pageStart + CRM_PAGE_SIZE,
  );
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

      {/* Two columns only when a contact is open. This was always a split pane,
          so landing on the CRM showed a half-width list beside a "Select a
          contact" placeholder -- and because that placeholder's header also
          read "Profile", pressing Close looked like it had done nothing. */}
      <RoutePreloader
        activeHref={selectedProfile ? undefined : "/contacts"}
        limit={4}
        routes={contactPreloadHrefs}
      />

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
            {visibleFilters.map((filter) => (
              <SmartPrefetchLink
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
              >
                {filter.label}
                <span>{filterCounts.get(filter.value) ?? 0}</span>
              </SmartPrefetchLink>
            ))}
          </nav>

          <div className="list-controls-row">
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
                <SmartPrefetchLink
                  className="secondary-button compact"
                  href={crmHref({
                    contactId: selectedProfile?.contact.id,
                    filter: activeFilter,
                    sort: activeSort,
                  })}
                >
                  Clear
                </SmartPrefetchLink>
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
            <ListPager
              currentPage={currentPage}
              hrefForPage={(page) =>
                crmHref({
                  contactId: selectedProfile?.contact.id,
                  filter: activeFilter,
                  page,
                  search: searchState,
                  sort: activeSort,
                })
              }
              label="CRM"
              totalPages={totalPages}
            />
          </div>

          <div className="crm-list">
            {activeFilter === "opportunities" ? (
              sortedLeads.length > 0 ? (
                paginatedLeads.map((lead) => (
                  <LeadRow
                    timeZone={timeZone}
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
              paginatedContacts.map((contact, contactIndex) => (
                <ContactRow
                  timeZone={timeZone}
                  activeFilter={activeFilter}
                  contact={contact}
                  isFirst={contactIndex === 0}
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

          {activeFilter !== "opportunities" &&
          selectedLeadContactIds.size > 0 ? (
            <div className="crm-list-note">
              <span className="pill">
                {selectedLeadContactIds.size} contacts have leads
              </span>
            </div>
          ) : null}
        </section>

        <CrmProfileTransitionShell
          selectedContactId={selectedProfile?.contact.id ?? null}
        >
          {selectedProfile ? (
            <ProfilePanel
              timeZone={timeZone}
              activeFilter={activeFilter}
              engineError={query?.engine_error}
              engineMessage={query?.engine_message}
              key={selectedProfile.contact.id}
              profile={selectedProfile}
              search={searchState}
              sort={activeSort}
            />
          ) : null}
        </CrmProfileTransitionShell>
      </section>
    </AppFrame>
  );
}
