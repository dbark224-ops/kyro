import { AppFrame } from "../components/app-frame";
import {
  getConversationList,
  getConversationReview,
  getSkippedEmailLast24HoursCount,
  getSkippedEmailSummaries,
  type ConversationReview,
  type SkippedEmailSummaryItem,
} from "../../lib/crm/queries";
import {
  OUTBOUND_CHANNELS,
  getCommunicationSettings,
} from "../../lib/communication/settings";
import {
  findInboundEmailSenderRule,
  getInboundEmailSettings,
  type InboundEmailSenderRule,
} from "../../lib/integrations/inbound-email-settings";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import {
  createMockOutboundMessageAction,
  createConversationAppointmentAction,
  promoteSkippedEmailToWorkItemAction,
  retryOutboundDeliveryAction,
  sendDraftReplyAction,
  updateDraftReplyAction,
} from "./actions";
import { ConversationWorkflowPanel } from "./conversation-workflow-panel";
import { MessageWorkflowControls } from "./message-workflow-controls";
import { ManualReplyChannelFields } from "./manual-reply-channel-fields";
import { ReplyGenerator } from "./reply-generator";
import { SkippedEmailMoreMenu } from "./skipped-email-more-menu";
import { SkippedEmailReplyDetails } from "./skipped-email-reply-details";
import { SkippedEmailSenderRuleControls } from "./skipped-email-sender-rule-controls";
import {
  approveAndExecuteDashboardAction,
  approveDashboardAction,
  executeDashboardAction,
} from "../engine/actions";
import { SmartPrefetchLink } from "../components/smart-prefetch-link";
import Link from "next/link";
import { MessageAttachmentList } from "../components/message-attachments";
import type { ReactNode } from "react";

type CommunicationSettings = Awaited<
  ReturnType<typeof getCommunicationSettings>
>;

export const dynamic = "force-dynamic";

type InboxPageProps = {
  searchParams?: Promise<{
    filter?: string;
    conversationId?: string;
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
  { value: "missing_info", label: "Missing info" },
  { value: "follow_up_due", label: "Follow-up due" },
  { value: "ready_to_quote", label: "Ready to quote" },
  { value: "site_visit_needed", label: "Site visit needed" },
  { value: "awaiting_customer", label: "Awaiting customer" },
  { value: "resolved", label: "Resolved" },
  { value: "needs_review", label: "Needs review" },
  { value: "needs_approval", label: "Needs approval" },
] as const;

const SORT_OPTIONS = [
  { value: "recent", label: "Most recent" },
  { value: "urgent", label: "Urgent first" },
  { value: "action", label: "Next action" },
  { value: "customer", label: "Customer" },
] as const;
const INBOX_PAGE_SIZE = 10;

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

function formatDate(value: string | null) {
  if (!value) {
    return "No messages";
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

function normalizePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function inboxHref({
  conversationId,
  filter,
  page,
  query,
  showSkippedEmail = false,
  sort,
}: {
  conversationId?: string | null;
  filter: string;
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

  if (query) {
    params.set("q", query);
  }

  if (sort !== "recent") {
    params.set("sort", sort);
  }

  if (showSkippedEmail) {
    params.set("skipped", "1");
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const nextQuery = params.toString();

  return nextQuery ? `/inbox?${nextQuery}` : "/inbox";
}

function filterHref(
  filter: string,
  page: number | undefined,
  query: string,
  sort: string,
  showSkippedEmail: boolean,
  conversationId?: string | null,
) {
  return inboxHref({
    conversationId,
    filter,
    page,
    query,
    showSkippedEmail,
    sort,
  });
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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValues(value: unknown) {
  return arrayValue(value)
    .map((item) => textValue(item))
    .filter((item): item is string => Boolean(item));
}

function channelLabel(
  channelType: string | null,
  channelDisplayName: string | null,
) {
  if (channelType === "manual_inbound") {
    return "Manual";
  }

  if (channelType === "sms") {
    return "SMS";
  }

  if (channelType === "phone") {
    return "Phone";
  }

  if (channelType === "email") {
    return "Email";
  }

  return channelDisplayName ?? formatLabel(channelType);
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
            <Link className="text-button" href={closeHref} prefetch={false}>
              Close
            </Link>
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
  redirectTo,
}: {
  action: ConversationReview["actions"][number];
  conversationId: string;
  redirectTo: string;
}) {
  const canEdit = action.status === "pending_approval";
  const draftSubject =
    textValue(action.input.subject) ?? "Thanks for reaching out";
  const draftBody = textValue(action.input.body) ?? "";

  return (
    <article className="assistant-preview-row draft-reply-inline-card">
      <form
        action={canEdit ? sendDraftReplyAction : executeDashboardAction}
        className="draft-reply-form"
      >
        <input name="actionId" type="hidden" value={action.id} />
        <input name="conversationId" type="hidden" value={conversationId} />
        <input name="redirectTo" type="hidden" value={redirectTo} />
        <div className="draft-reply-header compact-header">
          <div>
            <strong>Generated reply</strong>
            <span>
              {formatLabel(action.status)} - {formatDate(action.createdAt)}
            </span>
          </div>
          <span className="pill">
            {textValue(action.input.attachmentQuoteDraftId)
              ? "PDF attached"
              : "AI draft"}
          </span>
        </div>
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
          Reply
          <textarea defaultValue={draftBody} name="body" readOnly={!canEdit} />
        </label>
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
          <button className="primary-button compact" type="submit">
            {action.status === "completed"
              ? "Completed"
              : "Send generated reply"}
          </button>
        </div>
      </form>
    </article>
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

  return settings.allowedChannels[0] ?? "email";
}

function defaultReplySubject(profile: ConversationReview) {
  const messageSubject = profile.messages.find((message) =>
    Boolean(message.subject),
  )?.subject;
  const subject =
    messageSubject ?? profile.lead?.title ?? "Thanks for reaching out";

  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function InboxManualReplyComposer({
  profile,
  redirectTo,
  settings,
}: {
  profile: ConversationReview;
  redirectTo: string;
  settings: CommunicationSettings;
}) {
  const defaultChannel = preferredReplyChannel(profile, settings);
  const defaultSubject = defaultReplySubject(profile);
  const submissionKey = crypto.randomUUID();
  const channelOptions = OUTBOUND_CHANNELS.map((channel) => ({
    label: formatLabel(channel),
    value: channel,
  }));

  return (
    <InboxPreviewPanel title="Manual reply">
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
        <div className="mini-facts-grid">
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
              <input defaultChecked name="includeSignature" type="checkbox" />
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
    </InboxPreviewPanel>
  );
}

function deliveryStatusLabel(status: string) {
  if (status === "retry_scheduled") {
    return "Retry scheduled";
  }

  return formatLabel(status);
}

function deliveryStatusClass(status: string) {
  if (status === "sent") {
    return "pill success";
  }

  if (status === "failed" || status === "retry_scheduled") {
    return "pill warning";
  }

  return "pill subtle";
}

function OutboundDeliveryPanel({
  deliveries,
  conversationId,
  redirectTo,
}: {
  deliveries: ConversationReview["outboundMessages"];
  conversationId: string;
  redirectTo: string;
}) {
  if (deliveries.length === 0) {
    return null;
  }

  return (
    <InboxPreviewPanel title="Outbound delivery">
      <div className="assistant-preview-list compact outbound-delivery-list">
        {deliveries.map((delivery) => (
          <article className="assistant-preview-row" key={delivery.id}>
            <div>
              <strong>{delivery.subject ?? "Outbound message"}</strong>
              <span>
                {formatLabel(delivery.channelType)}
                {delivery.provider
                  ? ` - ${formatLabel(delivery.provider)}`
                  : ""}
                {" - "}
                {delivery.sentAt
                  ? `Sent ${formatDate(delivery.sentAt)}`
                  : `Attempt ${delivery.attemptCount}/${delivery.maxAttempts}`}
              </span>
              <p>
                {delivery.lastError ??
                  (delivery.recipient
                    ? `To ${delivery.recipient}`
                    : "Delivery is recorded against this conversation.")}
              </p>
            </div>
            <div className="delivery-actions">
              <span className={deliveryStatusClass(delivery.status)}>
                {deliveryStatusLabel(delivery.status)}
              </span>
              {delivery.status === "failed" ||
              delivery.status === "retry_scheduled" ? (
                <form action={retryOutboundDeliveryAction}>
                  <input
                    name="conversationId"
                    type="hidden"
                    value={conversationId}
                  />
                  <input
                    name="outboundQueueId"
                    type="hidden"
                    value={delivery.id}
                  />
                  <input name="redirectTo" type="hidden" value={redirectTo} />
                  <button className="secondary-button compact" type="submit">
                    Retry
                  </button>
                </form>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </InboxPreviewPanel>
  );
}

function InboxSplitPreview({
  closeHref,
  communicationSettings,
  profile,
  redirectTo,
}: {
  closeHref: string;
  communicationSettings: CommunicationSettings;
  profile: ConversationReview;
  redirectTo: string;
}) {
  const title =
    profile.lead?.title ??
    profile.contact?.name ??
    profile.messages[0]?.subject ??
    "Conversation";
  const visibleActions = profile.actions.filter(isActionablePreviewAction);
  const recentMessages = profile.messages.slice(-6);
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
    <section className="panel assistant-inline-preview inbox-inline-preview">
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2>{title}</h2>
        </div>
        <div className="button-row inbox-preview-actions">
          <Link
            className="secondary-button compact"
            href={`/inbox/${profile.conversation.id}`}
            prefetch={false}
          >
            Open full screen
          </Link>
          <Link
            className="secondary-button compact inbox-preview-close-button"
            href={closeHref}
            prefetch={false}
          >
            Close
          </Link>
        </div>
      </header>

      <div className="assistant-preview-body">
        <div className="assistant-preview-status-row">
          <span className="pill">
            {formatLabel(profile.conversation.status)}
          </span>
          <span>
            Last message {formatDate(profile.conversation.lastMessageAt)}
          </span>
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
                ["Title", profile.lead?.title ?? null],
                ["Service", profile.lead?.serviceType ?? null],
                ["Status", formatLabel(profile.lead?.status ?? null)],
                ["Priority", formatLabel(profile.lead?.priority ?? null)],
                ["Next step", leadNextStep ?? null],
                ["Value", profile.lead?.estimatedValue ?? null],
              ]}
            />
          </InboxPreviewPanel>
        </div>

        <InboxPreviewPanel title="Messages">
          {recentMessages.length > 0 ? (
            <div className="assistant-preview-thread">
              {recentMessages.map((message) => (
                <article
                  className={`preview-message ${
                    message.direction === "outbound" ? "outbound" : "inbound"
                  }`}
                  key={message.id}
                >
                  <div className="preview-message-meta">
                    <strong>{formatLabel(message.direction)}</strong>
                    <span>
                      {channelLabel(
                        message.channelType,
                        message.channelDisplayName,
                      )}
                    </span>
                    <span>{formatDate(message.createdAt)}</span>
                  </div>
                  {message.subject ? <strong>{message.subject}</strong> : null}
                  <p>{message.bodyText ?? "No message body recorded."}</p>
                  <MessageAttachmentList metadata={message.metadata} />
                  <MessageWorkflowControls
                    conversationId={profile.conversation.id}
                    message={message}
                    notes={profile.notes}
                    redirectTo={redirectTo}
                    tasks={profile.tasks}
                  />
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-copy">No messages recorded yet.</p>
          )}
        </InboxPreviewPanel>

        <InboxManualReplyComposer
          profile={profile}
          redirectTo={redirectTo}
          settings={communicationSettings}
        />

        <ConversationWorkflowPanel
          compact
          redirectTo={redirectTo}
          review={profile}
        />

        <OutboundDeliveryPanel
          conversationId={profile.conversation.id}
          deliveries={profile.outboundMessages}
          redirectTo={redirectTo}
        />

        {visibleActions.length > 0 ? (
          <InboxPreviewPanel title="Action queue">
            <div className="assistant-preview-list compact">
              {visibleActions.map((action) =>
                action.type === "draft_reply" ? (
                  <InboxDraftReplyAction
                    action={action}
                    conversationId={profile.conversation.id}
                    key={action.id}
                    redirectTo={redirectTo}
                  />
                ) : (
                  <article className="assistant-preview-row" key={action.id}>
                    <div>
                      <strong>{previewActionTitle(action)}</strong>
                      <span>
                        {formatLabel(action.status)} -{" "}
                        {formatDate(action.createdAt)}
                      </span>
                      <p>{previewActionSummary(action)}</p>
                    </div>
                    <InboxActionControls
                      action={action}
                      conversationId={profile.conversation.id}
                      redirectTo={redirectTo}
                    />
                  </article>
                ),
              )}
            </div>
          </InboxPreviewPanel>
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
  const skippedSearchQuery = query?.skippedQ?.trim() ?? "";
  const selectedConversationId = query?.conversationId?.trim() ?? "";
  const showSkippedEmail = query?.skipped === "1";
  const [
    conversations,
    selectedConversationReview,
    communicationSettings,
    inboundEmailSettings,
    skippedEmailSummaries,
  ] = await Promise.all([
    getConversationList(supabase, workspace.id),
    selectedConversationId
      ? getConversationReview(supabase, workspace.id, selectedConversationId)
      : Promise.resolve(null),
    selectedConversationId
      ? getCommunicationSettings(supabase, workspace.id)
      : Promise.resolve(null),
    showSkippedEmail
      ? getInboundEmailSettings(supabase, workspace.id)
      : Promise.resolve(null),
    showSkippedEmail
      ? getSkippedEmailSummaries(supabase, workspace.id)
      : getSkippedEmailLast24HoursCount(supabase, workspace.id).then(
          (last24HoursCount) => ({
            items: [],
            last24HoursCount,
          }),
        ),
  ]);
  const skippedEmailSummaryItems = skippedSearchQuery
    ? skippedEmailSummaries.items.filter((email) =>
        skippedEmailSearchText(email).includes(
          skippedSearchQuery.toLowerCase(),
        ),
      )
    : skippedEmailSummaries.items;
  const skippedEmailLast24HoursCount = skippedEmailSummaries.last24HoursCount;
  const closePreviewHref = inboxHref({
    filter: activeFilter,
    query: searchQuery,
    showSkippedEmail,
    sort: activeSort,
  });
  const selectedRedirectHref = selectedConversationReview
    ? inboxHref({
        conversationId: selectedConversationReview.conversation.id,
        filter: activeFilter,
        query: searchQuery,
        showSkippedEmail,
        sort: activeSort,
      })
    : closePreviewHref;
  const skippedEmailOpenHref = inboxHref({
    conversationId: selectedConversationReview?.conversation.id,
    filter: activeFilter,
    query: searchQuery,
    showSkippedEmail: true,
    sort: activeSort,
  });
  const skippedEmailCloseHref = inboxHref({
    conversationId: selectedConversationReview?.conversation.id,
    filter: activeFilter,
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

    if (activeFilter === "needs_approval") {
      return conversation.pendingApprovalCount > 0;
    }

    if (activeFilter === "needs_reply") {
      return conversation.workflowBucket === "needs_reply";
    }

    if (activeFilter === "missing_info") {
      return Boolean(conversation.inquiryFacts?.missingInfo.length);
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
  const filterCounts = new Map<string, number>(
    FILTERS.map((filter) => [
      filter.value,
      filter.value === "all"
        ? conversations.length
        : filter.value === "needs_approval"
          ? conversations.filter(
              (conversation) => conversation.pendingApprovalCount > 0,
            ).length
          : filter.value === "needs_reply"
            ? conversations.filter(
                (conversation) => conversation.workflowBucket === "needs_reply",
              ).length
            : filter.value === "missing_info"
              ? conversations.filter((conversation) =>
                  Boolean(conversation.inquiryFacts?.missingInfo.length),
                ).length
              : conversations.filter(
                  (conversation) =>
                    conversation.workflowBucket === filter.value,
                ).length,
    ]),
  );
  const needsReplyCount = conversations.filter(
    (conversation) => conversation.workflowBucket === "needs_reply",
  ).length;
  const readyToQuoteCount = conversations.filter(
    (conversation) => conversation.workflowBucket === "ready_to_quote",
  ).length;
  const awaitingCustomerCount = conversations.filter(
    (conversation) => conversation.workflowBucket === "awaiting_customer",
  ).length;
  const followUpDueCount = conversations.filter(
    (conversation) => conversation.workflowBucket === "follow_up_due",
  ).length;

  return (
    <AppFrame active="Inbox">
      <header className="topbar inbox-topbar page-topbar-tight">
        <div>
          <p className="eyebrow">{workspace.name}</p>
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
          selectedConversationReview
            ? "inbox-workspace has-preview"
            : "inbox-workspace"
        }
      >
        <section className="panel page-panel inbox-work-queue-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Messages</p>
              <h2>Work queue</h2>
            </div>
            <div className="inbox-work-queue-actions">
              <span className="pill">
                {sortedConversations.length === 0
                  ? "0 shown"
                  : `${pageStart + 1}-${Math.min(
                      pageStart + INBOX_PAGE_SIZE,
                      sortedConversations.length,
                    )} of ${sortedConversations.length}`}
              </span>
              <Link
                aria-label={`Filtered-out emails, ${skippedEmailLast24HoursCount} from the last 24 hours`}
                className={
                  showSkippedEmail
                    ? "secondary-button compact link-button active"
                    : "secondary-button compact link-button"
                }
                href={
                  showSkippedEmail
                    ? skippedEmailCloseHref
                    : skippedEmailOpenHref
                }
                prefetch={false}
              >
                Filtered-out emails{" "}
                <span>{skippedEmailLast24HoursCount} last 24h</span>
              </Link>
            </div>
          </div>

          <nav className="filter-bar" aria-label="Inbox filters">
            {FILTERS.map((filter) => (
              <Link
                className={
                  activeFilter === filter.value
                    ? "filter-pill active"
                    : "filter-pill"
                }
                href={filterHref(
                  filter.value,
                  undefined,
                  searchQuery,
                  activeSort,
                  showSkippedEmail,
                  selectedConversationReview?.conversation.id,
                )}
                key={filter.value}
                prefetch={false}
              >
                {filter.label}
                <span>{filterCounts.get(filter.value) ?? 0}</span>
              </Link>
            ))}
          </nav>

          <form action="/inbox" className="inbox-toolbar" method="get">
            {activeFilter !== "all" ? (
              <input name="filter" type="hidden" value={activeFilter} />
            ) : null}
            {showSkippedEmail ? (
              <input name="skipped" type="hidden" value="1" />
            ) : null}
            {selectedConversationReview ? (
              <input
                name="conversationId"
                type="hidden"
                value={selectedConversationReview.conversation.id}
              />
            ) : null}
            <label>
              Search
              <input
                defaultValue={searchQuery}
                name="q"
                placeholder="Customer, job type, urgent, bathroom..."
                type="search"
              />
            </label>
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
            <button className="secondary-button compact" type="submit">
              Apply
            </button>
          </form>

          <div className="data-list">
            {paginatedConversations.length > 0 ? (
              paginatedConversations.map((conversation) => {
                const jobType =
                  conversation.inquiryFacts?.jobType ??
                  conversation.leadServiceType ??
                  conversation.leadTitle ??
                  "Unclassified inquiry";
                const isSelected =
                  selectedConversationReview?.conversation.id ===
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

                return (
                  <SmartPrefetchLink
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
                    href={inboxHref({
                      conversationId: conversation.id,
                      filter: activeFilter,
                      page: currentPage,
                      query: searchQuery,
                      showSkippedEmail,
                      sort: activeSort,
                    })}
                    key={conversation.id}
                  >
                    <div className="data-main">
                      <div className="conversation-row-title">
                        <strong>{jobType}</strong>
                      </div>
                      <span className="conversation-message-preview">
                        {messagePreview}
                      </span>
                    </div>
                    <div className="data-meta">
                      <span
                        aria-hidden={rowMeta ? undefined : "true"}
                        className="conversation-row-extra"
                      >
                        {rowMeta}
                      </span>
                      <time>{formatDate(conversation.originalInquiryAt)}</time>
                      <span
                        className={
                          conversation.leadPriority === "high" ||
                          conversation.followUpIsDue
                            ? "pill warning"
                            : "pill"
                        }
                      >
                        {conversation.nextActionLabel}
                      </span>
                    </div>
                  </SmartPrefetchLink>
                );
              })
            ) : (
              <p className="empty-copy">
                {conversations.length > 0
                  ? "No conversations match this view."
                  : "No conversations yet."}
              </p>
            )}
          </div>

          {totalPages > 1 ? (
            <nav aria-label="Inbox pagination" className="pagination-bar">
              <Link
                aria-disabled={currentPage === 1}
                className={
                  currentPage === 1
                    ? "secondary-button compact disabled"
                    : "secondary-button compact"
                }
                href={inboxHref({
                  conversationId: selectedConversationReview?.conversation.id,
                  filter: activeFilter,
                  page: currentPage - 1,
                  query: searchQuery,
                  showSkippedEmail,
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
                href={inboxHref({
                  conversationId: selectedConversationReview?.conversation.id,
                  filter: activeFilter,
                  page: currentPage + 1,
                  query: searchQuery,
                  showSkippedEmail,
                  sort: activeSort,
                })}
                prefetch={false}
              >
                Next
              </Link>
            </nav>
          ) : null}
        </section>
        {showSkippedEmail ? (
          <SkippedEmailDialog
            closeHref={skippedEmailCloseHref}
            emails={skippedEmailSummaryItems}
            filter={activeFilter}
            inboxSearchQuery={searchQuery}
            last24HoursCount={skippedEmailLast24HoursCount}
            replyRedirectHref={skippedEmailOpenHref}
            selectedConversationId={selectedConversationReview?.conversation.id}
            senderRules={inboundEmailSettings?.senderRules ?? []}
            skippedSearchQuery={skippedSearchQuery}
            sort={activeSort}
          />
        ) : null}
        {selectedConversationReview ? (
          <InboxSplitPreview
            closeHref={closePreviewHref}
            communicationSettings={communicationSettings!}
            profile={selectedConversationReview}
            redirectTo={selectedRedirectHref}
          />
        ) : null}
      </section>
    </AppFrame>
  );
}
