import { AppFrame } from "../components/app-frame";
import {
  getConversationList,
  getConversationMailboxCounts,
  getConversationReview,
  getSkippedEmailSummaries,
  getSkippedEmailSummaryCounts,
  type ConversationReview,
  type SkippedEmailSummaryItem,
} from "../../lib/crm/queries";
import {
  OUTBOUND_CHANNELS,
  getCommunicationSettings,
} from "../../lib/communication/settings";
import {
  formatLeadTitle,
  formatServiceType,
  titleCaseBusinessText,
} from "../../lib/crm/display";
import {
  findInboundEmailSenderRule,
  type InboundEmailSenderRule,
} from "../../lib/integrations/inbound-email-settings";
import { formatWorkspaceDateTime } from "../../lib/time/format";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import {
  createMockOutboundMessageAction,
  createConversationAppointmentAction,
  deleteConversationAction,
  ignoreConversationNotificationAction,
  promoteSkippedEmailToWorkItemAction,
  restoreConversationAction,
  sendDraftReplyAction,
  updateDraftReplyAction,
} from "./actions";
import { ConversationWorkflowPanel } from "./conversation-workflow-panel";
import { ConversationHistory } from "./conversation-history";
import { ConversationMessageThread } from "./conversation-message-thread";
import {
  InboxConversationLink,
  InboxPreviewCloseLink,
  InboxPreviewTransitionShell,
} from "./inbox-preview-loading";
import { InboxSubmitButton } from "./inbox-submit-button";
import { InboxRefreshButton } from "./inbox-refresh-button";
import { InboxMailboxTransition } from "./inbox-mailbox-transition";
import { ManualReplyChannelFields } from "./manual-reply-channel-fields";
import { ReplyGenerator } from "./reply-generator";
import { ReplyComposerDisclosure } from "./reply-composer-disclosure";
import { RoutePreloader } from "../components/route-preloader";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";
import { SkippedEmailMoreMenu } from "./skipped-email-more-menu";
import { SkippedEmailCloseLink } from "./skipped-email-dialog-transition";
import { SkippedEmailReplyDetails } from "./skipped-email-reply-details";
import { SkippedEmailSenderRuleControls } from "./skipped-email-sender-rule-controls";
import {
  approveAndExecuteDashboardAction,
  approveDashboardAction,
  executeDashboardAction,
} from "../engine/actions";
import { MessageAttachmentList } from "../components/message-attachments";
import type { ReactNode } from "react";
import { textValue } from "@kyro/core";

type CommunicationSettings = Awaited<
  ReturnType<typeof getCommunicationSettings>
>;

function TrashIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function OpenFullScreenIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}

export const dynamic = "force-dynamic";

type InboxPageProps = {
  searchParams?: Promise<{
    filter?: string;
    conversationId?: string;
    junkId?: string;
    mailbox?: string;
    page?: string;
    q?: string;
    skippedQ?: string;
    sort?: string;
    skipped?: string;
    engine_error?: string;
    engine_message?: string;
  }>;
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "needs_reply", label: "Needs reply" },
  { value: "follow_up_due", label: "Follow-up due" },
  { value: "awaiting_customer", label: "Awaiting customer" },
  { value: "resolved", label: "Resolved" },
] as const;

const SORT_OPTIONS = [
  { value: "recent", label: "Most recent" },
  { value: "urgent", label: "Urgent first" },
  { value: "action", label: "Next action" },
  { value: "customer", label: "Customer" },
] as const;
const INBOX_PAGE_SIZE = 10;
const MAILBOXES = ["inbox", "junk", "deleted"] as const;
type Mailbox = (typeof MAILBOXES)[number];

const WORKFLOW_RANK: Record<string, number> = {
  needs_reply: 1,
  missing_info: 2,
  follow_up_due: 3,
  site_visit_needed: 4,
  ready_to_quote: 5,
  needs_review: 6,
  awaiting_customer: 7,
  open: 8,
  resolved: 9,
};

function formatDate(value: string | null, timeZone?: string | null) {
  return formatWorkspaceDateTime({
    emptyLabel: "No messages",
    timeZone,
    value,
  });
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

function isFilter(
  value: string | undefined,
): value is (typeof FILTERS)[number]["value"] {
  return FILTERS.some((filter) => filter.value === value);
}

function isSort(
  value: string | undefined,
): value is (typeof SORT_OPTIONS)[number]["value"] {
  return SORT_OPTIONS.some((sort) => sort.value === value);
}

function isMailbox(value: string | undefined): value is Mailbox {
  return MAILBOXES.includes(value as Mailbox);
}

function normalizePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function inboxHref({
  conversationId,
  filter,
  junkId,
  mailbox = "inbox",
  page,
  query,
  showSkippedEmail = false,
  sort,
}: {
  conversationId?: string | null;
  filter: string;
  junkId?: string | null;
  mailbox?: Mailbox;
  page?: number;
  query: string;
  showSkippedEmail?: boolean;
  sort: string;
}) {
  const params = new URLSearchParams();

  if (filter !== "all") {
    params.set("filter", filter);
  }

  if (conversationId) {
    params.set("conversationId", conversationId);
  }

  if (junkId) {
    params.set("junkId", junkId);
  }

  if (mailbox !== "inbox") {
    params.set("mailbox", mailbox);
  }

  if (query) {
    params.set("q", query);
  }

  if (sort !== "recent") {
    params.set("sort", sort);
  }

  if (showSkippedEmail) {
    params.set("mailbox", "junk");
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const nextQuery = params.toString();

  return nextQuery ? `/inbox?${nextQuery}` : "/inbox";
}

function dateValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function conversationSearchText(
  conversation: Awaited<ReturnType<typeof getConversationList>>[number],
) {
  return [
    conversation.contactName,
    conversation.leadTitle,
    conversation.leadNextStep,
    conversation.leadServiceType,
    conversation.latestSubject,
    conversation.latestBody,
    conversation.originalInquiryBody,
    conversation.nextActionLabel,
    conversation.followUpIsDue ? "follow-up due" : null,
    conversation.followUpDueAt,
    conversation.status,
    conversation.workflowBucket,
    conversation.inquiryFacts?.jobType,
    conversation.inquiryFacts?.address,
    conversation.inquiryFacts?.preferredTime,
    conversation.inquiryFacts?.urgency,
    conversation.inquiryFacts?.fit,
    conversation.inquiryFacts?.missingInfo.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function skippedEmailSearchText(email: SkippedEmailSummaryItem) {
  return [
    email.accountEmail,
    email.category,
    email.classificationProvider,
    email.fromEmail,
    email.reason,
    email.source,
    email.subject,
    email.summary,
    email.attachmentNames.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function workflowRank(value: string) {
  return WORKFLOW_RANK[value] ?? 99;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValues(value: unknown) {
  return arrayValue(value)
    .map((item) => textValue(item))
    .filter((item): item is string => Boolean(item));
}

function confidenceLabel(value: number | null) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : null;
}

function defaultSkippedReplySubject(subject: string) {
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function SkippedEmailDialog({
  closeHref,
  emails,
  filter,
  inboxSearchQuery,
  last24HoursCount,
  replyRedirectHref,
  selectedConversationId,
  senderRules,
  skippedSearchQuery,
  sort,
}: Readonly<{
  closeHref: string;
  emails: SkippedEmailSummaryItem[];
  filter: string;
  inboxSearchQuery: string;
  last24HoursCount: number;
  replyRedirectHref: string;
  selectedConversationId?: string | null;
  senderRules: InboundEmailSenderRule[];
  skippedSearchQuery: string;
  sort: string;
}>) {
  return (
    <div className="skipped-email-backdrop" role="presentation">
      <section
        aria-labelledby="skipped-email-dialog-title"
        aria-modal="true"
        className="skipped-email-dialog"
        role="dialog"
      >
        <div className="skipped-email-panel-heading">
          <div>
            <p className="eyebrow">Filtered-out emails</p>
            <h3 id="skipped-email-dialog-title">Emails Kyro skipped</h3>
            <p>
              Emails Kyro noticed but did not turn into CRM work. This stays
              separate from the main Inbox queue so personal/newsletter noise
              stays out of the work list.
            </p>
          </div>
          <div className="skipped-email-dialog-actions">
            <span className="pill">{last24HoursCount} last 24h</span>
            <SkippedEmailCloseLink className="text-button" href={closeHref}>
              Close
            </SkippedEmailCloseLink>
          </div>
        </div>

        <form action="/inbox" className="skipped-email-search-form">
          <input name="skipped" type="hidden" value="1" />
          {filter !== "all" ? (
            <input name="filter" type="hidden" value={filter} />
          ) : null}
          {sort !== "recent" ? (
            <input name="sort" type="hidden" value={sort} />
          ) : null}
          {inboxSearchQuery ? (
            <input name="q" type="hidden" value={inboxSearchQuery} />
          ) : null}
          {selectedConversationId ? (
            <input
              name="conversationId"
              type="hidden"
              value={selectedConversationId}
            />
          ) : null}
          <label>
            Search skipped mail
            <input
              defaultValue={skippedSearchQuery}
              name="skippedQ"
              placeholder="Sender, subject, reason..."
              type="search"
            />
          </label>
          <button className="secondary-button compact" type="submit">
            Apply
          </button>
        </form>

        <div className="skipped-email-list">
          {emails.length > 0 ? (
            emails.map((email) => {
              const confidence = confidenceLabel(email.confidence);
              const hasReply = email.replyCount > 0;
              const senderRule = findInboundEmailSenderRule(
                senderRules,
                email.fromEmail,
              );
              const rowClassName = [
                "skipped-email-row",
                "has-actions",
                email.fromEmail ? "has-reply" : null,
                hasReply ? "is-replied has-expand" : null,
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <article className={rowClassName} key={email.id}>
                  <div className="skipped-email-main">
                    <div className="skipped-email-card-meta">
                      {email.fromEmail ? (
                        <span>{email.fromEmail}</span>
                      ) : (
                        <span className="pill subtle">No reply address</span>
                      )}
                      <time
                        dateTime={email.receivedAt ?? email.processedAt ?? ""}
                      >
                        {formatDate(email.receivedAt ?? email.processedAt)}
                      </time>
                      <span className="skipped-email-meta-pill">
                        {formatLabel(email.category)}
                      </span>
                      {hasReply ? (
                        <span className="skipped-email-meta-pill replied">
                          Replied
                        </span>
                      ) : null}
                      {email.attachmentCount > 0 ? (
                        <span className="skipped-email-meta-pill attachment">
                          {email.attachmentCount} attachment
                          {email.attachmentCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    <div className="skipped-email-title">
                      <strong>{email.subject}</strong>
                    </div>
                    {hasReply ? null : (
                      <p>
                        {email.summary ??
                          "No skipped-mail summary was stored for this email."}
                      </p>
                    )}
                  </div>
                  {hasReply ? (
                    <details className="skipped-email-expand">
                      <summary aria-label="Show skipped email preview">
                        <span aria-hidden="true">⌄</span>
                      </summary>
                      <p>
                        {email.summary ??
                          "No skipped-mail summary was stored for this email."}
                      </p>
                    </details>
                  ) : null}
                  <form
                    action={promoteSkippedEmailToWorkItemAction}
                    className="skipped-email-promote-form"
                  >
                    <input name="eventId" type="hidden" value={email.id} />
                    <button className="primary-button compact" type="submit">
                      Promote to work queue
                    </button>
                  </form>
                  {email.fromEmail ? (
                    <SkippedEmailReplyDetails
                      defaultSubject={defaultSkippedReplySubject(email.subject)}
                      emailId={email.id}
                      replyRedirectHref={replyRedirectHref}
                    />
                  ) : null}
                  <SkippedEmailMoreMenu>
                    <div className="skipped-email-more-panel">
                      {email.fromEmail ? (
                        <SkippedEmailSenderRuleControls
                          emailId={email.id}
                          initialRuleAction={senderRule?.action ?? null}
                          key={`${email.id}:${senderRule?.action ?? "unset"}`}
                          redirectTo={replyRedirectHref}
                        />
                      ) : null}
                      <div className="skipped-email-decision-card">
                        <strong>Kyro decision details</strong>
                        <dl>
                          <div>
                            <dt>Category</dt>
                            <dd>{formatLabel(email.category)}</dd>
                          </div>
                          <div>
                            <dt>Confidence</dt>
                            <dd>{confidence ?? "Not recorded"}</dd>
                          </div>
                          <div>
                            <dt>Classifier</dt>
                            <dd>
                              {email.classificationProvider
                                ? formatLabel(email.classificationProvider)
                                : "Not recorded"}
                            </dd>
                          </div>
                          <div>
                            <dt>Reason</dt>
                            <dd>{email.reason ?? "No reason was stored."}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </SkippedEmailMoreMenu>
                </article>
              );
            })
          ) : (
            <p className="empty-copy">
              No filtered-out emails yet. Once inbound sync observes skipped
              emails, they will appear here.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

void SkippedEmailDialog;

function previewActionTitle(action: ConversationReview["actions"][number]) {
  if (action.type === "draft_reply") {
    return "Draft Reply";
  }

  if (action.type === "send_outbound_message") {
    return "Outbound Reply";
  }

  if (action.type === "create_quote_draft") {
    return "Quote Draft";
  }

  if (action.type === "book_site_visit") {
    return "Site Visit";
  }

  if (action.type === "mark_not_fit") {
    return "Mark Not Fit";
  }

  return formatLabel(action.type);
}

function previewActionSummary(action: ConversationReview["actions"][number]) {
  const body =
    textValue(action.input.body) ??
    textValue(action.input.replyBody) ??
    textValue(action.input.message);
  const subject = textValue(action.input.subject);
  const missingInfo = stringValues(action.input.missingInfo);
  const quoteDraft = action.input.quoteDraft;
  const quoteTitle =
    quoteDraft && typeof quoteDraft === "object" && !Array.isArray(quoteDraft)
      ? textValue((quoteDraft as Record<string, unknown>).title)
      : null;

  if (subject && body) {
    return `${subject}: ${body}`;
  }

  if (body) {
    return body;
  }

  if (quoteTitle) {
    return quoteTitle;
  }

  if (missingInfo.length > 0) {
    return `Missing: ${missingInfo.join(", ")}`;
  }

  return "Ready for review.";
}

function previewActionExecuteLabel(
  action: ConversationReview["actions"][number],
) {
  if (action.type === "draft_reply") {
    return "Send generated reply";
  }

  if (action.type === "send_outbound_message") {
    return "Send reply";
  }

  if (action.type === "create_quote_draft") {
    return "Create draft";
  }

  return "Execute";
}

function canIgnoreConversation(status: string) {
  return status !== "resolved" && status !== "replied";
}

function IgnoreConversationNotificationButton({
  conversationId,
  redirectTo,
}: {
  conversationId: string;
  redirectTo: string;
}) {
  return (
    <form
      action={ignoreConversationNotificationAction}
      className="inbox-ignore-notification-form"
    >
      <input name="conversationId" type="hidden" value={conversationId} />
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <button className="secondary-button compact subtle" type="submit">
        Ignore
      </button>
    </form>
  );
}

function isReplySendAction(action: ConversationReview["actions"][number]) {
  return (
    action.type === "draft_reply" || action.type === "send_outbound_message"
  );
}

function shouldShowPreviewAction(
  action: ConversationReview["actions"][number],
) {
  return !["ask_missing_info", "schedule_follow_up"].includes(action.type);
}

function isActionablePreviewAction(
  action: ConversationReview["actions"][number],
) {
  return (
    shouldShowPreviewAction(action) &&
    ["approved", "pending_approval"].includes(action.status)
  );
}

function InboxActionControls({
  action,
  conversationId,
  redirectTo,
}: {
  action: ConversationReview["actions"][number];
  conversationId: string;
  redirectTo: string;
}) {
  if (
    action.type === "book_site_visit" &&
    ["approved", "pending_approval"].includes(action.status)
  ) {
    return (
      <form
        action={createConversationAppointmentAction}
        className="action-button-row"
      >
        <input name="conversationId" type="hidden" value={conversationId} />
        <input name="sourceActionId" type="hidden" value={action.id} />
        <input name="redirectTo" type="hidden" value={redirectTo} />
        <input
          name="title"
          type="hidden"
          value={
            textValue(action.input.title) ??
            textValue(action.input.jobType) ??
            "Site visit"
          }
        />
        <input
          name="location"
          type="hidden"
          value={textValue(action.input.address) ?? ""}
        />
        <input
          name="description"
          type="hidden"
          value={
            textValue(action.input.preferredTime)
              ? `Customer preferred time: ${textValue(action.input.preferredTime)}`
              : "Site visit suggested by Kyro."
          }
        />
        <button className="primary-button compact" type="submit">
          Save appointment
        </button>
      </form>
    );
  }

  return (
    <div className="action-button-row">
      {action.status === "pending_approval" ? (
        <form
          action={
            isReplySendAction(action)
              ? approveAndExecuteDashboardAction
              : approveDashboardAction
          }
        >
          <input name="actionId" type="hidden" value={action.id} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <button
            className={
              isReplySendAction(action)
                ? "primary-button compact"
                : "secondary-button compact"
            }
            type="submit"
          >
            {isReplySendAction(action)
              ? previewActionExecuteLabel(action)
              : "Approve"}
          </button>
        </form>
      ) : null}
      {action.status === "approved" ? (
        <form action={executeDashboardAction}>
          <input name="actionId" type="hidden" value={action.id} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <button className="secondary-button compact" type="submit">
            {previewActionExecuteLabel(action)}
          </button>
        </form>
      ) : null}
      {action.status === "completed" ? (
        <span className="pill">Completed</span>
      ) : null}
      {action.status === "cancelled" ? (
        <span className="pill warning">Cancelled</span>
      ) : null}
    </div>
  );
}

function InboxDraftReplyAction({
  action,
  conversationId,
  quoteDrafts,
  redirectTo,
}: {
  action: ConversationReview["actions"][number];
  conversationId: string;
  quoteDrafts: ConversationReview["quoteDrafts"];
  redirectTo: string;
}) {
  const canEdit = action.status === "pending_approval";
  const draftSubject =
    textValue(action.input.subject) ?? "Thanks for reaching out";
  const draftBody = textValue(action.input.body) ?? "";
  const draftAttachmentId =
    textValue(action.input.attachmentQuoteDraftId) ?? "";

  return (
    <div className="draft-reply-inline-card unified-reply-draft">
      <form
        action={canEdit ? sendDraftReplyAction : executeDashboardAction}
        className="draft-reply-form"
        encType="multipart/form-data"
      >
        <input name="actionId" type="hidden" value={action.id} />
        <input name="conversationId" type="hidden" value={conversationId} />
        <input name="redirectTo" type="hidden" value={redirectTo} />
        <div className="draft-reply-header compact-header inbox-draft-reply-header">
          <div className="inbox-draft-reply-heading">
            <span className="inbox-draft-reply-meta">
              {formatLabel(action.status)} - {formatDate(action.createdAt)}
            </span>
            <div className="inbox-draft-reply-title-row">
              <strong>Generated reply</strong>
              <span className="pill">
                {textValue(action.input.attachmentQuoteDraftId)
                  ? "PDF attached"
                  : "AI draft"}
              </span>
            </div>
          </div>
        </div>
        <div className="draft-reply-field-row">
          <label>
            Subject
            <input
              defaultValue={draftSubject}
              name="subject"
              readOnly={!canEdit}
              type="text"
            />
          </label>
          <label>
            Attach
            <div className="attachment-control-row attachment-control-row-wide">
              <select
                defaultValue={draftAttachmentId}
                disabled={!canEdit}
                name="attachmentQuoteDraftId"
              >
                <option value="">No Kyro file</option>
                {quoteDrafts.map((quoteDraft) => (
                  <option key={quoteDraft.id} value={quoteDraft.id}>
                    {quoteDraft.title}
                  </option>
                ))}
              </select>
              <label
                className={
                  canEdit
                    ? "local-attachment-button local-attachment-upload-box"
                    : "local-attachment-button local-attachment-upload-box disabled"
                }
                title="Attach local files, up to 5 files and 10 MB total"
              >
                <input
                  aria-label="Attach local files"
                  disabled={!canEdit}
                  multiple
                  name="localAttachments"
                  type="file"
                />
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="18"
                  viewBox="0 0 24 24"
                  width="18"
                >
                  <path
                    d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span>Upload files</span>
              </label>
            </div>
          </label>
        </div>
        <label>
          Reply
          <textarea defaultValue={draftBody} name="body" readOnly={!canEdit} />
        </label>
        {canEdit ? <ReplyGenerator conversationId={conversationId} /> : null}
        <div className="action-button-row">
          {canEdit ? (
            <button
              className="secondary-button compact"
              formAction={updateDraftReplyAction}
              type="submit"
            >
              Save edits
            </button>
          ) : null}
          {action.status === "pending_approval" ||
          action.status === "approved" ? (
            <InboxSubmitButton
              label="Send generated reply"
              pendingLabel="Sending reply..."
            />
          ) : null}
          {action.status === "completed" ? (
            <span className="pill">Sent</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function InboxPreviewFacts({
  facts,
}: {
  facts: Array<[label: string, value: string | null]>;
}) {
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

function InboxPreviewPanel({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="assistant-preview-panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function preferredReplyChannel(
  profile: ConversationReview,
  settings: CommunicationSettings,
) {
  if (profile.contact?.email && settings.allowedChannels.includes("email")) {
    return "email";
  }

  if (profile.contact?.phone && settings.allowedChannels.includes("sms")) {
    return "sms";
  }

  return settings.allowedChannels.includes("sms") ? "sms" : "email";
}

function defaultReplySubject(profile: ConversationReview) {
  const messageSubject = profile.messages.find((message) =>
    Boolean(message.subject),
  )?.subject;
  const subject =
    messageSubject ?? profile.lead?.title ?? "Thanks for reaching out";

  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function InboxReplyComposer({
  draftAction,
  profile,
  redirectTo,
  settings,
}: {
  draftAction?: ConversationReview["actions"][number];
  profile: ConversationReview;
  redirectTo: string;
  settings: CommunicationSettings;
}) {
  const defaultChannel = preferredReplyChannel(profile, settings);
  const defaultSubject = defaultReplySubject(profile);
  const submissionKey = crypto.randomUUID();
  const channelOptions = OUTBOUND_CHANNELS.filter(
    (channel) => channel === "email" || channel === "sms",
  ).map((channel) => ({
    label: channel === "sms" ? "SMS" : formatLabel(channel),
    value: channel,
  }));

  return (
    <ReplyComposerDisclosure label={draftAction ? "Reply drafted" : "Reply"}>
      <>
        {draftAction ? (
          <InboxDraftReplyAction
            action={draftAction}
            conversationId={profile.conversation.id}
            quoteDrafts={profile.quoteDrafts}
            redirectTo={redirectTo}
          />
        ) : (
          <form
            action={createMockOutboundMessageAction}
            className="outbound-composer-form inbox-preview-composer"
            encType="multipart/form-data"
          >
            <input
              name="conversationId"
              type="hidden"
              value={profile.conversation.id}
            />
            <input name="submissionKey" type="hidden" value={submissionKey} />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <div className="mini-facts-grid reply-channel-attachment-grid">
              <ManualReplyChannelFields
                allowedChannels={settings.allowedChannels}
                defaultChannel={defaultChannel}
                defaultSubject={defaultSubject}
                options={channelOptions}
              />
              <div className="attachment-field">
                <strong>Attach</strong>
                <div className="attachment-control-row">
                  <select
                    aria-label="Attach Kyro hosted file"
                    defaultValue=""
                    name="attachmentQuoteDraftId"
                  >
                    <option value="">No attachment</option>
                    {profile.quoteDrafts.map((quoteDraft) => (
                      <option key={quoteDraft.id} value={quoteDraft.id}>
                        {quoteDraft.title}
                      </option>
                    ))}
                  </select>
                  <label
                    className="local-attachment-button"
                    title="Attach local files, up to 5 files and 10 MB total"
                  >
                    <input
                      aria-label="Attach local files"
                      multiple
                      name="localAttachments"
                      type="file"
                    />
                    <svg
                      aria-hidden="true"
                      fill="none"
                      height="18"
                      viewBox="0 0 24 24"
                      width="18"
                    >
                      <path
                        d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </label>
                </div>
              </div>
            </div>
            <label>
              Reply
              <textarea
                name="body"
                placeholder="Type the reply you want recorded in this conversation..."
                required
              />
            </label>
            <ReplyGenerator conversationId={profile.conversation.id} />
            <div className="outbound-policy-strip">
              <div className="email-signature-control">
                <label className="signature-include-control">
                  <input
                    defaultChecked
                    name="includeSignature"
                    type="checkbox"
                  />
                  <span>Signature</span>
                </label>
                <select
                  aria-label="Email signature"
                  defaultValue="manual"
                  name="signatureVariant"
                >
                  <option value="manual">User signature</option>
                  <option value="ai_generated">Assistant signature</option>
                </select>
              </div>
            </div>
            <button className="primary-button compact" type="submit">
              Send reply
            </button>
          </form>
        )}
      </>
    </ReplyComposerDisclosure>
  );
}

function InboxSplitPreview({
  closeHref,
  communicationSettings,
  profile,
  redirectTo,
  timeZone,
}: {
  closeHref: string;
  communicationSettings: CommunicationSettings;
  profile: ConversationReview;
  redirectTo: string;
  timeZone: string;
}) {
  const title =
    formatLeadTitle(profile.lead?.title, profile.contact?.name) ??
    profile.contact?.name ??
    profile.messages[0]?.subject ??
    "Conversation";
  const draftReplyAction = profile.actions
    .filter(
      (action) =>
        action.type === "draft_reply" &&
        (action.status === "pending_approval" || action.status === "approved"),
    )
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )[0];
  const visibleActions = profile.actions
    .filter(
      (action) =>
        action.type !== "draft_reply" && isActionablePreviewAction(action),
    )
    .sort((left, right) => {
      if (left.type === "draft_reply" && right.type !== "draft_reply") {
        return -1;
      }

      if (right.type === "draft_reply" && left.type !== "draft_reply") {
        return 1;
      }

      return (
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    });
  const latestMessage = [...profile.messages].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0];
  const isAwaitingCustomer =
    profile.conversation.status === "replied" ||
    latestMessage?.direction === "outbound";
  const leadNextStep = isAwaitingCustomer
    ? "Awaiting customer"
    : profile.lead?.nextStep;

  return (
    <section
      className="panel assistant-inline-preview inbox-inline-preview"
      data-conversation-detail-panel
    >
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2>{title}</h2>
        </div>
        <div className="button-row inbox-preview-actions">
          <SmartPrefetchLink
            aria-label="Open conversation full screen"
            className="secondary-button compact inbox-preview-fullscreen-button"
            href={`/inbox/${profile.conversation.id}`}
            title="Open full screen"
          >
            <OpenFullScreenIcon />
            <span className="sr-only">Open conversation full screen</span>
          </SmartPrefetchLink>
          <form action={deleteConversationAction}>
            <input
              name="conversationId"
              type="hidden"
              value={profile.conversation.id}
            />
            <input name="redirectTo" type="hidden" value={closeHref} />
            <button
              aria-label="Move conversation to Deleted"
              className="inbox-preview-delete-button"
              title="Move to Deleted"
              type="submit"
            >
              <TrashIcon />
            </button>
          </form>
          <InboxPreviewCloseLink
            className="secondary-button compact inbox-preview-close-button"
            href={closeHref}
          >
            <CloseIcon />
            <span className="sr-only">Close conversation</span>
          </InboxPreviewCloseLink>
        </div>
      </header>

      <div className="assistant-preview-body">
        <div className="assistant-preview-status-row">
          <div className="assistant-preview-status-copy">
            <span className="pill">
              {formatLabel(profile.conversation.status)}
            </span>
            <span>
              Last message{" "}
              {formatDate(profile.conversation.lastMessageAt, timeZone)}
            </span>
          </div>
          {canIgnoreConversation(profile.conversation.status) ? (
            <IgnoreConversationNotificationButton
              conversationId={profile.conversation.id}
              redirectTo={redirectTo}
            />
          ) : null}
        </div>

        <div className="assistant-preview-grid two-column">
          <InboxPreviewPanel title="Contact">
            <InboxPreviewFacts
              facts={[
                ["Name", profile.contact?.name ?? null],
                ["Email", profile.contact?.email ?? null],
                ["Phone", profile.contact?.phone ?? null],
                ["Address", profile.contact?.address ?? null],
                ["Type", formatLabel(profile.contact?.contactType ?? null)],
                ["Company", profile.contact?.company ?? null],
              ]}
            />
          </InboxPreviewPanel>

          <InboxPreviewPanel title="Lead">
            <InboxPreviewFacts
              facts={[
                [
                  "Title",
                  formatLeadTitle(profile.lead?.title, profile.contact?.name),
                ],
                ["Service", formatServiceType(profile.lead?.serviceType)],
                ["Status", formatLabel(profile.lead?.status ?? null)],
                ["Priority", formatLabel(profile.lead?.priority ?? null)],
                ["Next step", leadNextStep ?? null],
                ["Value", profile.lead?.estimatedValue ?? null],
              ]}
            />
          </InboxPreviewPanel>
        </div>

        <section className="assistant-preview-panel conversation-messages-panel">
          <h3>Messages</h3>
          <InboxReplyComposer
            draftAction={draftReplyAction}
            profile={profile}
            redirectTo={redirectTo}
            settings={communicationSettings}
          />
          <ConversationMessageThread
            messages={profile.messages}
            timeZone={timeZone}
          />
        </section>

        {visibleActions.length > 0 ? (
          <InboxPreviewPanel title="Action queue">
            <div className="assistant-preview-list compact">
              {visibleActions.map((action) => (
                <article className="assistant-preview-row" key={action.id}>
                  <div>
                    <strong>{previewActionTitle(action)}</strong>
                    <span>
                      {formatLabel(action.status)} -{" "}
                      {formatDate(action.createdAt, timeZone)}
                    </span>
                    <p>{previewActionSummary(action)}</p>
                  </div>
                  <InboxActionControls
                    action={action}
                    conversationId={profile.conversation.id}
                    redirectTo={redirectTo}
                  />
                </article>
              ))}
            </div>
          </InboxPreviewPanel>
        ) : null}

        <ConversationWorkflowPanel
          compact
          redirectTo={redirectTo}
          review={profile}
        />

        <ConversationHistory profile={profile} timeZone={timeZone} />
      </div>
    </section>
  );
}

function ConversationDeleteButton({
  conversationId,
  redirectTo,
}: {
  conversationId: string;
  redirectTo: string;
}) {
  return (
    <form
      action={deleteConversationAction}
      className="conversation-delete-form"
    >
      <input name="conversationId" type="hidden" value={conversationId} />
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <button
        aria-label="Move conversation to Deleted"
        className="conversation-delete-button"
        title="Move to Deleted"
        type="submit"
      >
        <TrashIcon />
      </button>
    </form>
  );
}

function DeletedConversationSplitPreview({
  closeHref,
  profile,
  redirectTo,
  timeZone,
}: {
  closeHref: string;
  profile: ConversationReview;
  redirectTo: string;
  timeZone: string;
}) {
  const title =
    formatLeadTitle(profile.lead?.title, profile.contact?.name) ??
    profile.contact?.name ??
    profile.messages[0]?.subject ??
    "Deleted conversation";

  return (
    <section className="panel assistant-inline-preview inbox-inline-preview mailbox-simple-preview">
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">Deleted</p>
          <h2>{title}</h2>
        </div>
        <div className="button-row inbox-preview-actions">
          <form action={restoreConversationAction}>
            <input
              name="conversationId"
              type="hidden"
              value={profile.conversation.id}
            />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <button className="primary-button compact" type="submit">
              Restore to Inbox
            </button>
          </form>
          <InboxPreviewCloseLink
            className="secondary-button compact inbox-preview-close-button"
            href={closeHref}
          >
            <CloseIcon />
            <span className="sr-only">Close conversation</span>
          </InboxPreviewCloseLink>
        </div>
      </header>
      <div className="assistant-preview-body">
        <InboxPreviewPanel title="Sender">
          <InboxPreviewFacts
            facts={[
              ["Name", profile.contact?.name ?? null],
              ["Email", profile.contact?.email ?? null],
              ["Phone", profile.contact?.phone ?? null],
              ["Company", profile.contact?.company ?? null],
            ]}
          />
        </InboxPreviewPanel>
        <InboxPreviewPanel title="Messages">
          <div className="assistant-preview-thread">
            {profile.messages.map((message) => (
              <article className="preview-message" key={message.id}>
                <div className="preview-message-meta">
                  <strong>{formatLabel(message.direction)}</strong>
                  <span>
                    {formatDate(
                      message.receivedAt ?? message.sentAt ?? message.createdAt,
                      timeZone,
                    )}
                  </span>
                </div>
                {message.subject ? <strong>{message.subject}</strong> : null}
                <p>{message.bodyText ?? "No message body recorded."}</p>
                <MessageAttachmentList metadata={message.metadata} />
              </article>
            ))}
          </div>
        </InboxPreviewPanel>
      </div>
    </section>
  );
}

function JunkEmailSplitPreview({
  closeHref,
  email,
  redirectTo,
  timeZone,
}: {
  closeHref: string;
  email: SkippedEmailSummaryItem;
  redirectTo: string;
  timeZone: string;
}) {
  return (
    <section className="panel assistant-inline-preview inbox-inline-preview mailbox-simple-preview">
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">Junk</p>
          <h2>{email.subject}</h2>
        </div>
        <div className="button-row inbox-preview-actions">
          <form action={promoteSkippedEmailToWorkItemAction}>
            <input name="eventId" type="hidden" value={email.id} />
            <button className="primary-button compact" type="submit">
              Promote to work queue
            </button>
          </form>
          <InboxPreviewCloseLink
            className="secondary-button compact inbox-preview-close-button"
            href={closeHref}
          >
            <CloseIcon />
            <span className="sr-only">Close message</span>
          </InboxPreviewCloseLink>
        </div>
      </header>
      <div className="assistant-preview-body">
        <InboxPreviewPanel title="Sender">
          <InboxPreviewFacts
            facts={[
              ["From", email.fromEmail],
              ["Account", email.accountEmail],
              ["Received", formatDate(email.receivedAt, timeZone)],
              ["Category", formatLabel(email.category)],
            ]}
          />
        </InboxPreviewPanel>
        <InboxPreviewPanel title="Message">
          <article className="junk-message-body">
            <strong>{email.subject}</strong>
            <p>
              {email.bodyText ??
                email.summary ??
                "No message body was stored for this email."}
            </p>
          </article>
        </InboxPreviewPanel>
        {email.fromEmail ? (
          <SkippedEmailReplyDetails
            defaultSubject={defaultSkippedReplySubject(email.subject)}
            emailId={email.id}
            replyRedirectHref={redirectTo}
          />
        ) : null}
      </div>
    </section>
  );
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const query = await searchParams;
  const { supabase, workspace } = await requireWorkspaceContext();
  const activeFilter = isFilter(query?.filter) ? query.filter : "all";
  const activeSort = isSort(query?.sort) ? query.sort : "recent";
  const requestedPage = normalizePage(query?.page);
  const searchQuery = query?.q?.trim() ?? "";
  const selectedConversationId = query?.conversationId?.trim() ?? "";
  const selectedJunkId = query?.junkId?.trim() ?? "";
  const activeMailbox = isMailbox(query?.mailbox) ? query.mailbox : "inbox";
  const [
    inboxConversations,
    deletedConversations,
    conversationMailboxCounts,
    selectedConversationReview,
    communicationSettings,
    generalSettings,
    skippedEmailSummaries,
  ] = await Promise.all([
    getConversationList(supabase, workspace.id),
    activeMailbox === "deleted"
      ? getConversationList(supabase, workspace.id, { mailbox: "deleted" })
      : Promise.resolve([]),
    getConversationMailboxCounts(supabase, workspace.id),
    selectedConversationId && activeMailbox !== "junk"
      ? getConversationReview(supabase, workspace.id, selectedConversationId)
      : Promise.resolve(null),
    selectedConversationId && activeMailbox === "inbox"
      ? getCommunicationSettings(supabase, workspace.id)
      : Promise.resolve(null),
    getWorkspaceGeneralSettings(supabase, workspace.id),
    activeMailbox === "junk"
      ? getSkippedEmailSummaries(supabase, workspace.id)
      : getSkippedEmailSummaryCounts(supabase, workspace.id).then(
          (summaryCounts) => ({
            items: [],
            ...summaryCounts,
          }),
        ),
  ]);
  const conversations =
    activeMailbox === "deleted" ? deletedConversations : inboxConversations;
  const validSelectedConversationReview =
    selectedConversationReview &&
    ((activeMailbox === "deleted" &&
      Boolean(selectedConversationReview.conversation.deletedAt)) ||
      (activeMailbox === "inbox" &&
        !selectedConversationReview.conversation.deletedAt))
      ? selectedConversationReview
      : null;
  const skippedEmailSummaryItems = searchQuery
    ? skippedEmailSummaries.items.filter((email) =>
        skippedEmailSearchText(email).includes(searchQuery.toLowerCase()),
      )
    : skippedEmailSummaries.items;
  const skippedEmailLast24HoursCount = skippedEmailSummaries.last24HoursCount;
  const selectedJunkEmail =
    activeMailbox === "junk"
      ? (skippedEmailSummaries.items.find(
          (email) => email.id === selectedJunkId,
        ) ?? null)
      : null;
  const closePreviewHref = inboxHref({
    filter: activeFilter,
    mailbox: activeMailbox,
    query: searchQuery,
    sort: activeSort,
  });
  const selectedRedirectHref = validSelectedConversationReview
    ? inboxHref({
        conversationId: validSelectedConversationReview.conversation.id,
        filter: activeFilter,
        mailbox: activeMailbox,
        query: searchQuery,
        sort: activeSort,
      })
    : closePreviewHref;
  const selectedJunkRedirectHref = selectedJunkEmail
    ? inboxHref({
        filter: activeFilter,
        junkId: selectedJunkEmail.id,
        mailbox: "junk",
        query: searchQuery,
        sort: activeSort,
      })
    : closePreviewHref;
  const deleteRedirectHref = inboxHref({
    filter: activeFilter,
    mailbox: "inbox",
    query: searchQuery,
    sort: activeSort,
  });
  const searchedConversations = searchQuery
    ? conversations.filter((conversation) =>
        conversationSearchText(conversation).includes(
          searchQuery.toLowerCase(),
        ),
      )
    : conversations;
  const filteredConversations = searchedConversations.filter((conversation) => {
    if (activeFilter === "all") {
      return true;
    }

    return conversation.workflowBucket === activeFilter;
  });
  const sortedConversations = [...filteredConversations].sort((left, right) => {
    if (activeSort === "urgent") {
      const urgencyScore = (conversation: (typeof conversations)[number]) =>
        (conversation.inquiryFacts?.urgency === "urgent" ? 0 : 10) +
        (conversation.leadPriority === "high" ? 0 : 2) +
        workflowRank(conversation.workflowBucket);

      return (
        urgencyScore(left) - urgencyScore(right) ||
        dateValue(right.lastMessageAt) - dateValue(left.lastMessageAt)
      );
    }

    if (activeSort === "action") {
      return (
        workflowRank(left.workflowBucket) -
          workflowRank(right.workflowBucket) ||
        dateValue(right.lastMessageAt) - dateValue(left.lastMessageAt)
      );
    }

    if (activeSort === "customer") {
      return (
        (left.contactName ?? "").localeCompare(right.contactName ?? "") ||
        dateValue(right.lastMessageAt) - dateValue(left.lastMessageAt)
      );
    }

    return dateValue(right.lastMessageAt) - dateValue(left.lastMessageAt);
  });
  const totalPages = Math.max(
    1,
    Math.ceil(sortedConversations.length / INBOX_PAGE_SIZE),
  );
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * INBOX_PAGE_SIZE;
  const paginatedConversations = sortedConversations.slice(
    pageStart,
    pageStart + INBOX_PAGE_SIZE,
  );
  // Warmed on idle, once this screen has painted, so working down the list is
  // instant instead of only the row you happened to hover. Four covers the top
  // of the visible list without turning one page view into five.
  const conversationPreloadHrefs = paginatedConversations
    .slice(0, 4)
    .map((conversation) =>
      inboxHref({
        conversationId: conversation.id,
        filter: activeFilter,
        mailbox: activeMailbox,
        page: currentPage,
        query: searchQuery,
        sort: activeSort,
      }),
    );
  const filterCounts = new Map<string, number>(
    FILTERS.map((filter) => [
      filter.value,
      filter.value === "all"
        ? conversations.length
        : conversations.filter(
            (conversation) => conversation.workflowBucket === filter.value,
          ).length,
    ]),
  );
  const needsReplyCount = inboxConversations.filter(
    (conversation) => conversation.workflowBucket === "needs_reply",
  ).length;
  const readyToQuoteCount = inboxConversations.filter(
    (conversation) => conversation.workflowBucket === "ready_to_quote",
  ).length;
  const awaitingCustomerCount = inboxConversations.filter(
    (conversation) => conversation.workflowBucket === "awaiting_customer",
  ).length;
  const followUpDueCount = inboxConversations.filter(
    (conversation) => conversation.workflowBucket === "follow_up_due",
  ).length;

  return (
    <AppFrame active="Inbox">
      <RoutePreloader
        activeHref={selectedConversationId ? undefined : "/inbox"}
        limit={4}
        routes={conversationPreloadHrefs}
      />
      <header className="topbar inbox-topbar page-topbar-tight">
        <div>
          <h1>Inbox</h1>
        </div>
        <div className="topbar-right">
          <section className="metric-grid" aria-label="Inbox metrics">
            <article className="metric-card cyan">
              <p>Needs reply</p>
              <strong>{needsReplyCount}</strong>
              <span>Drafts or inbound threads</span>
            </article>
            <article className="metric-card purple">
              <p>Ready to quote</p>
              <strong>{readyToQuoteCount}</strong>
              <span>Quote draft work</span>
            </article>
            <article className="metric-card pink">
              <p>Awaiting customer</p>
              <strong>{awaitingCustomerCount}</strong>
              <span>{followUpDueCount} follow-ups due</span>
            </article>
          </section>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error inbox-page-alert">
          {query.engine_error}
        </p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert inbox-page-alert">{query.engine_message}</p>
      ) : null}

      <section
        className={
          validSelectedConversationReview || selectedJunkEmail
            ? "inbox-workspace has-preview"
            : "inbox-workspace"
        }
      >
        <section className="panel page-panel inbox-work-queue-panel">
          <div className="panel-heading mailbox-panel-heading">
            <div>
              <p className="eyebrow">Messages</p>
              <h2>
                {activeMailbox === "junk"
                  ? "Junk"
                  : activeMailbox === "deleted"
                    ? "Deleted"
                    : "Work queue"}
              </h2>
            </div>
            <div className="inbox-work-queue-actions">
              <InboxRefreshButton />
              {activeMailbox === "junk" ? (
                <span className="pill">
                  {skippedEmailLast24HoursCount} last 24h
                </span>
              ) : (
                <span className="pill">
                  {sortedConversations.length === 0
                    ? "0 shown"
                    : `${pageStart + 1}-${Math.min(
                        pageStart + INBOX_PAGE_SIZE,
                        sortedConversations.length,
                      )} of ${sortedConversations.length}`}
                </span>
              )}
            </div>
          </div>

          <InboxMailboxTransition activeMailbox={activeMailbox}>
            <nav aria-label="Mailbox" className="mailbox-switcher">
              <SmartPrefetchLink
                className={activeMailbox === "inbox" ? "active" : ""}
                data-mailbox-target="inbox"
                href={inboxHref({
                  filter: "all",
                  mailbox: "inbox",
                  query: "",
                  sort: "recent",
                })}
                preload
              >
                Inbox <span>{conversationMailboxCounts.inbox}</span>
              </SmartPrefetchLink>
              <SmartPrefetchLink
                className={activeMailbox === "junk" ? "active" : ""}
                data-mailbox-target="junk"
                href={inboxHref({
                  filter: "all",
                  mailbox: "junk",
                  query: "",
                  sort: "recent",
                })}
                preload
              >
                Junk <span>{skippedEmailSummaries.totalCount}</span>
              </SmartPrefetchLink>
              <SmartPrefetchLink
                className={activeMailbox === "deleted" ? "active" : ""}
                data-mailbox-target="deleted"
                href={inboxHref({
                  filter: "all",
                  mailbox: "deleted",
                  query: "",
                  sort: "recent",
                })}
                preload
              >
                Deleted <span>{conversationMailboxCounts.deleted}</span>
              </SmartPrefetchLink>
            </nav>
          </InboxMailboxTransition>

          {activeMailbox === "inbox" ? (
            <nav className="filter-bar" aria-label="Inbox filters">
              {FILTERS.map((filter) => (
                <SmartPrefetchLink
                  className={
                    activeFilter === filter.value
                      ? "filter-pill active"
                      : "filter-pill"
                  }
                  href={inboxHref({
                    conversationId:
                      validSelectedConversationReview?.conversation.id,
                    filter: filter.value,
                    mailbox: "inbox",
                    query: searchQuery,
                    sort: activeSort,
                  })}
                  key={filter.value}
                >
                  {filter.label}
                  <span>{filterCounts.get(filter.value) ?? 0}</span>
                </SmartPrefetchLink>
              ))}
            </nav>
          ) : null}

          <form
            action="/inbox"
            className={
              activeMailbox === "inbox"
                ? "inbox-toolbar"
                : "inbox-toolbar mailbox-search-toolbar"
            }
            method="get"
          >
            <input name="mailbox" type="hidden" value={activeMailbox} />
            {activeMailbox === "inbox" && activeFilter !== "all" ? (
              <input name="filter" type="hidden" value={activeFilter} />
            ) : null}
            {activeMailbox === "inbox" ? (
              <label>
                Search
                <input
                  defaultValue={searchQuery}
                  name="q"
                  placeholder="Customer, sender, subject..."
                  type="search"
                />
              </label>
            ) : (
              <label className="mailbox-search-field">
                <span className="sr-only">
                  Search{" "}
                  {activeMailbox === "junk" ? "junk" : "deleted messages"}
                </span>
                <span className="mailbox-search-input-wrap">
                  <input
                    defaultValue={searchQuery}
                    name="q"
                    placeholder={
                      activeMailbox === "junk"
                        ? "Search sender, subject, or reason..."
                        : "Search deleted messages..."
                    }
                    type="search"
                  />
                  <button
                    aria-label={`Search ${
                      activeMailbox === "junk" ? "junk" : "deleted messages"
                    }`}
                    className="mailbox-search-submit"
                    title="Search"
                    type="submit"
                  >
                    <SearchIcon />
                  </button>
                </span>
              </label>
            )}
            {activeMailbox !== "junk" ? (
              <label>
                Sort
                <select defaultValue={activeSort} name="sort">
                  {SORT_OPTIONS.map((sort) => (
                    <option key={sort.value} value={sort.value}>
                      {sort.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {activeMailbox === "inbox" ? (
              <button className="secondary-button compact" type="submit">
                Apply
              </button>
            ) : null}
          </form>

          <div className="data-list">
            {activeMailbox === "junk" ? (
              skippedEmailSummaryItems.length > 0 ? (
                skippedEmailSummaryItems.map((email, emailIndex) => {
                  const isSelected = selectedJunkEmail?.id === email.id;
                  return (
                    <InboxConversationLink
                      className={[
                        "data-row conversation-row",
                        "junk-conversation-row",
                        isSelected ? "active" : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      conversationId={`junk:${email.id}`}
                      href={inboxHref({
                        filter: "all",
                        junkId: email.id,
                        mailbox: "junk",
                        query: searchQuery,
                        sort: "recent",
                      })}
                      key={email.id}
                      label={email.subject}
                      preload={emailIndex === 0}
                      selected={isSelected}
                    >
                      <time className="conversation-row-time">
                        {formatDate(
                          email.receivedAt ?? email.processedAt,
                          generalSettings.timeZone,
                        )}
                      </time>
                      <span
                        className="conversation-row-from"
                        title={email.fromEmail ?? undefined}
                      >
                        {email.fromEmail ?? "Unknown sender"}
                      </span>
                      <div className="conversation-row-title">
                        <strong>{email.subject}</strong>
                      </div>
                      <span className="conversation-message-preview">
                        {email.summary ??
                          email.bodyText ??
                          "No message preview."}
                      </span>
                      <span className="conversation-row-extra">
                        {email.replyCount > 0
                          ? `${email.replyCount} replies`
                          : ""}
                      </span>
                      <span className="pill conversation-row-status junk-category-pill">
                        {formatLabel(email.category)}
                      </span>
                    </InboxConversationLink>
                  );
                })
              ) : (
                <p className="empty-copy">No junk messages match this view.</p>
              )
            ) : paginatedConversations.length > 0 ? (
              paginatedConversations.map((conversation, conversationIndex) => {
                const jobType =
                  titleCaseBusinessText(conversation.inquiryFacts?.jobType) ??
                  formatServiceType(conversation.leadServiceType) ??
                  formatLeadTitle(
                    conversation.leadTitle,
                    conversation.contactName,
                  ) ??
                  "Unclassified inquiry";
                const isSelected =
                  validSelectedConversationReview?.conversation.id ===
                  conversation.id;
                const messagePreview =
                  conversation.originalInquiryBody ??
                  conversation.latestBody ??
                  "No message body recorded.";
                const rowMeta = conversation.followUpIsDue
                  ? "Follow-up due"
                  : conversation.pendingApprovalCount > 0
                    ? `${conversation.pendingApprovalCount} approvals`
                    : conversation.quoteDraftCount > 0
                      ? `${conversation.quoteDraftCount} quote drafts`
                      : "";
                const conversationHref = inboxHref({
                  conversationId: conversation.id,
                  filter: activeFilter,
                  mailbox: activeMailbox,
                  page: currentPage,
                  query: searchQuery,
                  sort: activeSort,
                });
                const link = (
                  <InboxConversationLink
                    className={[
                      "data-row conversation-row",
                      conversation.leadPriority === "high" ||
                      conversation.workflowBucket === "needs_review" ||
                      conversation.followUpIsDue
                        ? "flagged"
                        : null,
                      isSelected ? "active" : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    conversationId={conversation.id}
                    href={conversationHref}
                    label={jobType}
                    preload={conversationIndex === 0}
                    selected={isSelected}
                  >
                    <time className="conversation-row-time">
                      {formatDate(
                        conversation.originalInquiryAt,
                        generalSettings.timeZone,
                      )}
                    </time>
                    <span
                      className="conversation-row-from"
                      title={conversation.senderAddress ?? undefined}
                    >
                      {conversation.senderAddress ?? "Unknown sender"}
                    </span>
                    <div className="conversation-row-title">
                      <strong>{jobType}</strong>
                    </div>
                    <span className="conversation-message-preview">
                      {messagePreview}
                    </span>
                    <span className="conversation-row-extra">{rowMeta}</span>
                    <span
                      className={
                        conversation.leadPriority === "high" ||
                        conversation.followUpIsDue
                          ? "pill warning conversation-row-status"
                          : "pill conversation-row-status"
                      }
                    >
                      {activeMailbox === "deleted"
                        ? "Deleted"
                        : conversation.nextActionLabel}
                    </span>
                  </InboxConversationLink>
                );

                return activeMailbox === "inbox" ? (
                  <div className="conversation-row-shell" key={conversation.id}>
                    {link}
                    <ConversationDeleteButton
                      conversationId={conversation.id}
                      redirectTo={deleteRedirectHref}
                    />
                  </div>
                ) : (
                  <div
                    className="conversation-row-shell deleted"
                    key={conversation.id}
                  >
                    {link}
                  </div>
                );
              })
            ) : (
              <p className="empty-copy">
                {conversations.length > 0
                  ? "No conversations match this view."
                  : activeMailbox === "deleted"
                    ? "Deleted conversations will appear here."
                    : "No conversations yet."}
              </p>
            )}
          </div>

          {activeMailbox !== "junk" && totalPages > 1 ? (
            <nav aria-label="Inbox pagination" className="pagination-bar">
              <SmartPrefetchLink
                aria-disabled={currentPage === 1}
                className={
                  currentPage === 1
                    ? "secondary-button compact disabled"
                    : "secondary-button compact"
                }
                href={inboxHref({
                  filter: activeFilter,
                  mailbox: activeMailbox,
                  page: currentPage - 1,
                  query: searchQuery,
                  sort: activeSort,
                })}
              >
                Previous
              </SmartPrefetchLink>
              <span className="pagination-label">
                Page {currentPage} of {totalPages}
              </span>
              <SmartPrefetchLink
                aria-disabled={currentPage === totalPages}
                className={
                  currentPage === totalPages
                    ? "secondary-button compact disabled"
                    : "secondary-button compact"
                }
                href={inboxHref({
                  filter: activeFilter,
                  mailbox: activeMailbox,
                  page: currentPage + 1,
                  query: searchQuery,
                  sort: activeSort,
                })}
              >
                Next
              </SmartPrefetchLink>
            </nav>
          ) : null}
        </section>

        <InboxPreviewTransitionShell
          selectedConversationId={
            selectedJunkEmail
              ? `junk:${selectedJunkEmail.id}`
              : validSelectedConversationReview?.conversation.id
          }
        >
          {selectedJunkEmail ? (
            <JunkEmailSplitPreview
              closeHref={closePreviewHref}
              email={selectedJunkEmail}
              redirectTo={selectedJunkRedirectHref}
              timeZone={generalSettings.timeZone}
            />
          ) : validSelectedConversationReview && activeMailbox === "deleted" ? (
            <DeletedConversationSplitPreview
              closeHref={closePreviewHref}
              profile={validSelectedConversationReview}
              redirectTo={closePreviewHref}
              timeZone={generalSettings.timeZone}
            />
          ) : validSelectedConversationReview ? (
            <InboxSplitPreview
              closeHref={closePreviewHref}
              communicationSettings={communicationSettings!}
              profile={validSelectedConversationReview}
              redirectTo={selectedRedirectHref}
              timeZone={generalSettings.timeZone}
            />
          ) : null}
        </InboxPreviewTransitionShell>
      </section>
    </AppFrame>
  );
}
