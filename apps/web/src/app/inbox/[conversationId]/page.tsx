import {
  createMockOutboundMessageAction,
  createManualFollowUpAction,
  regenerateAiPlanAction,
  sendDraftReplyAction,
  updateInquiryFactsAction,
  updateConversationStatusAction,
  updateDraftReplyAction,
} from "../actions";
import { ReplyGenerator } from "../reply-generator";
import {
  approveAndExecuteDashboardAction,
  approveDashboardAction,
  executeDashboardAction,
} from "../../engine/actions";
import { AppFrame } from "../../components/app-frame";
import {
  getConversationReview,
  type ConversationReview,
} from "../../../lib/crm/queries";
import {
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  formatDisplayMoney,
  type DisplayCurrencySettings,
} from "../../../lib/billing/display-currency";
import {
  OUTBOUND_CHANNELS,
  getCommunicationSettings,
} from "../../../lib/communication/settings";
import { quoteDocumentHistory } from "../../../lib/documents/history";
import {
  quoteRevisionLabel,
  quoteRevisionState,
} from "../../../lib/documents/revisions";
import { requireWorkspaceContext } from "../../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../../lib/workspace/general-settings";
import { prepareQuoteDraftSendAction } from "../../documents/actions";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type ConversationReviewPageProps = {
  params: Promise<{
    conversationId: string;
  }>;
  searchParams?: Promise<{
    attachQuoteDraftId?: string;
    engine_error?: string;
    engine_message?: string;
  }>;
};

type TimelineItem = {
  id: string;
  at: string;
  title: string;
  detail: string;
  tone: "action" | "ai" | "inbound" | "outbound" | "system";
};

const CONVERSATION_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "reply_drafted", label: "Reply drafted" },
  { value: "replied", label: "Replied" },
  { value: "resolved", label: "Resolved" },
] as const;

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

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValues(value: unknown) {
  return arrayValue(value)
    .map((item) => textValue(item))
    .filter((item): item is string => Boolean(item));
}

function displayValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return textValue(value) ?? "-";
}

function titleCaseLabel(value: unknown) {
  const text = textValue(value);

  if (!text) {
    return "-";
  }

  return text.replace(/[a-zA-Z][a-zA-Z'/-]*/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) {
      return word;
    }

    return word
      .split(/([/-])/)
      .map((part) =>
        part === "/" || part === "-"
          ? part
          : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
      )
      .join("");
  });
}

function previewText(value: string | null, maxLength = 140) {
  if (!value) {
    return "No detail recorded.";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function safeConversationStatus(status: string) {
  return CONVERSATION_STATUS_OPTIONS.some((option) => option.value === status)
    ? status
    : "open";
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

function quoteLineItemLabel(item: unknown) {
  const row = objectRecord(item);
  const description = textValue(row.description)
    ? titleCaseLabel(row.description)
    : "Draft Line Item";
  const quantity =
    row.quantity === null || row.quantity === undefined
      ? null
      : String(row.quantity);
  const unit = textValue(row.unit);

  return [
    description,
    quantity && unit ? `${quantity} ${unit}` : (quantity ?? unit),
  ]
    .filter(Boolean)
    .join(" - ");
}

function ActionControls({
  action,
  executeLabel,
  redirectTo,
}: {
  action: ConversationReview["actions"][number];
  executeLabel?: string;
  redirectTo: string;
}) {
  return (
    <div className="action-button-row">
      {action.status === "pending_approval" ? (
        <form
          action={
            action.type === "send_outbound_message"
              ? approveAndExecuteDashboardAction
              : approveDashboardAction
          }
        >
          <input name="actionId" type="hidden" value={action.id} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <button
            className={
              action.type === "send_outbound_message"
                ? "primary-button compact"
                : "secondary-button compact"
            }
            type="submit"
          >
            {action.type === "send_outbound_message" ? "Send reply" : "Approve"}
          </button>
        </form>
      ) : null}
      {action.status === "approved" ? (
        <form action={executeDashboardAction}>
          <input name="actionId" type="hidden" value={action.id} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <button className="secondary-button compact" type="submit">
            {executeLabel ?? "Execute"}
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

function ProposedActionCard({
  action,
  redirectTo,
}: {
  action: ConversationReview["actions"][number];
  redirectTo: string;
}) {
  const quoteDraft = objectRecord(action.input.quoteDraft);
  const inquiryFacts = objectRecord(action.input.inquiryFacts);
  const lineItems = arrayValue(quoteDraft.lineItems);
  const notes = Array.isArray(quoteDraft.notes)
    ? stringValues(quoteDraft.notes)
    : textValue(quoteDraft.notes)
      ? [String(quoteDraft.notes)]
      : [];
  const resultQuoteDraftId = textValue(action.result.quoteDraftId);
  const executeLabel =
    action.type === "draft_reply"
      ? "Send generated reply"
      : action.type === "create_quote_draft"
        ? "Create draft"
        : action.type === "book_site_visit"
          ? "Record booking plan"
          : action.type === "mark_not_fit"
            ? "Mark not fit"
            : action.type === "send_outbound_message"
              ? "Send reply"
              : "Execute";

  return (
    <article className="action-card">
      <div className="action-card-header">
        <div>
          <strong>{formatLabel(action.type)}</strong>
          <span>
            {formatLabel(action.status)} - {formatDate(action.createdAt)}
          </span>
        </div>
        <span className="pill">{formatLabel(action.status)}</span>
      </div>

      <div className="action-card-body">
        {action.type === "ask_missing_info" ? (
          <>
            <p>
              {textValue(action.input.prompt) ??
                "Ask the customer for missing details."}
            </p>
            <div className="missing-info-list">
              {stringValues(action.input.missingInfo).map((item) => (
                <span className="pill" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </>
        ) : null}

        {action.type === "book_site_visit" ? (
          <div className="mini-facts-grid">
            <span>
              <strong>Address</strong>
              {displayValue(action.input.address)}
            </span>
            <span>
              <strong>Target time</strong>
              {displayValue(action.input.preferredTime)}
            </span>
          </div>
        ) : null}

        {action.type === "create_quote_draft" ? (
          <>
            <p>{displayValue(quoteDraft.title)}</p>
            <div className="quote-line-list">
              {lineItems.length > 0 ? (
                lineItems.map((item, index) => (
                  <span key={`${action.id}-${index}`}>
                    {quoteLineItemLabel(item)}
                  </span>
                ))
              ) : (
                <span>No line items proposed yet.</span>
              )}
            </div>
            {notes.length > 0 ? (
              <ul className="plain-note-list">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
            {resultQuoteDraftId ? (
              <span className="pill">Draft saved</span>
            ) : null}
          </>
        ) : null}

        {action.type === "mark_not_fit" ? (
          <p>
            {textValue(action.input.reason) ?? "Close this lead as not a fit."}
          </p>
        ) : null}

        {action.type === "schedule_follow_up" ? (
          <div className="mini-facts-grid">
            <span>
              <strong>Window</strong>
              {displayValue(action.input.followUpWindow)}
            </span>
            <span>
              <strong>Reason</strong>
              {displayValue(action.input.reason)}
            </span>
          </div>
        ) : null}

        {action.type === "send_outbound_message" ? (
          <>
            <div className="mini-facts-grid">
              <span>
                <strong>Channel</strong>
                {formatLabel(textValue(action.input.channelType))}
              </span>
              <span>
                <strong>Attachment</strong>
                {textValue(action.input.attachmentQuoteDraftId)
                  ? "Quote draft attached"
                  : "No attachment"}
              </span>
            </div>
            {textValue(action.input.subject) ? (
              <p>
                <strong>Subject:</strong> {textValue(action.input.subject)}
              </p>
            ) : null}
            <p>
              {textValue(action.input.body) ?? "No outbound body recorded."}
            </p>
            <span className="pill warning">
              Email sends through Gmail after approval
            </span>
          </>
        ) : null}

        {![
          "ask_missing_info",
          "book_site_visit",
          "create_quote_draft",
          "mark_not_fit",
          "send_outbound_message",
          "schedule_follow_up",
        ].includes(action.type) ? (
          <p>
            {textValue(action.input.body) ??
              textValue(action.input.prompt) ??
              textValue(inquiryFacts.jobType) ??
              "No action detail recorded."}
          </p>
        ) : null}
      </div>

      <ActionControls
        action={action}
        executeLabel={executeLabel}
        redirectTo={redirectTo}
      />
    </article>
  );
}

function buildTimeline(review: ConversationReview) {
  const items: TimelineItem[] = [];

  for (const message of review.messages) {
    const isOutbound = message.direction === "outbound";

    items.push({
      id: `message-${message.id}`,
      at: message.receivedAt ?? message.sentAt ?? message.createdAt,
      title: isOutbound
        ? "Outbound message recorded"
        : "Inbound message received",
      detail: `${channelLabel(message.channelType, message.channelDisplayName)} - ${previewText(
        message.subject ?? message.bodyText,
      )}`,
      tone: isOutbound ? "outbound" : "inbound",
    });
  }

  for (const run of review.aiRuns) {
    const route = review.routeDecisions.find(
      (decision) => decision.aiRunId === run.id,
    );

    items.push({
      id: `ai-${run.id}`,
      at: run.completedAt ?? run.createdAt,
      title: "AI triage completed",
      detail: `${run.provider}/${route?.selectedModel ?? run.model} - ${run.status}`,
      tone: "ai",
    });
  }

  for (const action of review.actions) {
    items.push({
      id: `action-${action.id}`,
      at: action.createdAt,
      title:
        action.type === "draft_reply"
          ? "Draft reply proposed"
          : `Action proposed: ${formatLabel(action.type)}`,
      detail: formatLabel(action.status),
      tone: "action",
    });

    if (action.approvedAt) {
      items.push({
        id: `action-${action.id}-approved`,
        at: action.approvedAt,
        title:
          action.type === "draft_reply"
            ? "Draft reply approved"
            : `${formatLabel(action.type)} approved`,
        detail: "User approval recorded.",
        tone: "system",
      });
    }

    if (action.executedAt) {
      items.push({
        id: `action-${action.id}-executed`,
        at: action.executedAt,
        title:
          action.type === "create_quote_draft"
            ? "Quote draft created"
            : "Outbound action executed",
        detail:
          action.type === "draft_reply"
            ? "Outbound message sent or recorded according to channel settings."
            : "Action completed inside Kyro.",
        tone: "system",
      });
    }
  }

  for (const quoteDraft of review.quoteDrafts) {
    for (const event of quoteDocumentHistory(quoteDraft.metadata).slice(0, 6)) {
      if (
        event.kind !== "customer_approved" &&
        event.kind !== "customer_changes_requested" &&
        event.kind !== "customer_viewed" &&
        event.kind !== "email_sent"
      ) {
        continue;
      }

      items.push({
        id: `quote-${quoteDraft.id}-${event.id}`,
        at: event.occurredAt,
        title:
          event.kind === "customer_approved"
            ? "Quote approved"
            : event.kind === "customer_changes_requested"
              ? "Quote changes requested"
              : event.kind === "customer_viewed"
                ? "Quote viewed"
                : "Quote email sent",
        detail: `${quoteDraft.title}${event.quoteVersion ? ` v${event.quoteVersion}` : ""}`,
        tone:
          event.kind === "customer_changes_requested"
            ? "inbound"
            : event.kind === "email_sent"
              ? "outbound"
              : "system",
      });
    }
  }

  return items.sort(
    (first, second) =>
      new Date(first.at).getTime() - new Date(second.at).getTime(),
  );
}

export default async function ConversationReviewPage({
  params,
  searchParams,
}: ConversationReviewPageProps) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  const { supabase, workspace } = await requireWorkspaceContext();
  const [review, communicationSettings, generalSettings] = await Promise.all([
    getConversationReview(supabase, workspace.id, conversationId),
    getCommunicationSettings(supabase, workspace.id),
    getWorkspaceGeneralSettings(supabase, workspace.id).catch(
      () => DEFAULT_DISPLAY_CURRENCY_SETTINGS,
    ),
  ]);

  if (!review) {
    notFound();
  }

  const profileNeedsReview = review.lead?.priority === "high";
  const latestAiRun = review.aiRuns[0] ?? null;
  const aiInquiryFacts = objectRecord(latestAiRun?.output.inquiryFacts);
  const currentInquiryFacts = review.inquiryFacts
    ? {
        address: review.inquiryFacts.address,
        budget: review.inquiryFacts.budget,
        fit: review.inquiryFacts.fit,
        jobType: review.inquiryFacts.jobType,
        missingInfo: review.inquiryFacts.missingInfo,
        preferredTime: review.inquiryFacts.preferredTime,
        urgency: review.inquiryFacts.urgency,
      }
    : aiInquiryFacts;
  const missingInfo =
    review.inquiryFacts?.missingInfo ??
    stringValues(currentInquiryFacts.missingInfo);
  const route = latestAiRun
    ? (review.routeDecisions.find(
        (decision) => decision.aiRunId === latestAiRun.id,
      ) ?? null)
    : null;
  const fallbackReason =
    textValue(latestAiRun?.output.fallbackReason) ??
    textValue(route?.budgetSnapshot.fallbackReason);
  const proposedActionTypes = stringValues(
    latestAiRun?.output.proposedActionTypes,
  );
  const debugPayload = latestAiRun
    ? {
        aiRun: {
          id: latestAiRun.id,
          provider: latestAiRun.provider,
          model: route?.selectedModel ?? latestAiRun.model,
          status: latestAiRun.status,
          usage: latestAiRun.usage,
          actualCost: latestAiRun.actualCost,
        },
        route: route
          ? {
              fallbackUsed: route.fallbackUsed,
              reason: route.decisionReason,
              budgetSnapshot: route.budgetSnapshot,
            }
          : null,
        currentInquiryFacts,
        rawAiOutput: latestAiRun.output,
      }
    : null;
  const usageTotal = review.usageEvents.reduce(
    (sum, usage) => sum + Number(usage.customerChargeSnapshot),
    0,
  );
  const redirectTo = `/inbox/${conversationId}`;
  const timeline = buildTimeline(review);
  const draftReplyActions = review.actions.filter(
    (action) => action.type === "draft_reply",
  );
  const otherActions = review.actions.filter(
    (action) =>
      action.type !== "draft_reply" &&
      action.type !== "ask_missing_info" &&
      action.type !== "schedule_follow_up",
  );
  const latestDraftReply = draftReplyActions[0] ?? null;
  const composerSubject =
    textValue(latestDraftReply?.input.subject) ?? "Thanks for reaching out";
  const composerBody = textValue(latestDraftReply?.input.body) ?? "";
  const followUpSubmissionKey = crypto.randomUUID();
  const attachedQuoteDraftId = review.quoteDrafts.some(
    (quoteDraft) => quoteDraft.id === query?.attachQuoteDraftId,
  )
    ? query?.attachQuoteDraftId
    : "";
  const attachedQuoteDraft = review.quoteDrafts.find(
    (quoteDraft) => quoteDraft.id === attachedQuoteDraftId,
  );
  const changeRequestedQuoteDrafts = review.quoteDrafts.filter(
    (quoteDraft) =>
      quoteDraft.status === "changes_requested" ||
      Boolean(quoteRevisionState(quoteDraft.metadata).pendingChangeRequest),
  );

  return (
    <AppFrame active="Inbox">
      <header className="topbar inquiry-topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>{review.lead?.title ?? "Inquiry review"}</h1>
        </div>
        <div className="topbar-actions inquiry-actions">
          <div className="compact-metrics" aria-label="Inquiry counters">
            <span>{review.messages.length} msg</span>
            <span>{review.aiRuns.length} AI</span>
            <span>{formatMoney(String(usageTotal), "USD", generalSettings)}</span>
          </div>
          <form action={updateConversationStatusAction} className="status-form">
            <input name="conversationId" type="hidden" value={conversationId} />
            <select
              aria-label="Conversation status"
              defaultValue={safeConversationStatus(review.conversation.status)}
              name="status"
            >
              {CONVERSATION_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="secondary-button compact" type="submit">
              Update
            </button>
          </form>
          <Link className="secondary-button link-button" href="/inbox" prefetch>
            Back to inbox
          </Link>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}
      {attachedQuoteDraft ? (
        <p className="form-alert">
          {attachedQuoteDraft.title} selected for the outbound composer.
        </p>
      ) : null}
      {changeRequestedQuoteDrafts.length > 0 ? (
        <section className="form-alert error">
          {changeRequestedQuoteDrafts.length} quote{" "}
          {changeRequestedQuoteDrafts.length === 1 ? "needs" : "need"} revision.
          Review the requested changes, edit the quote, then send the revised
          version back to the customer.
        </section>
      ) : null}

      {profileNeedsReview ? (
        <section className="form-alert error">
          Profile check needed before replying. The inbound details may conflict
          with an existing contact profile.
        </section>
      ) : null}

      <section className="inquiry-summary-grid">
        <article className="panel inquiry-summary-card">
          <div className="summary-title">
            <div>
              <p className="eyebrow">Contact</p>
              <h2>{review.contact?.name ?? "Unknown contact"}</h2>
            </div>
            {review.contact ? (
              <span className="pill">
                {formatLabel(review.contact.contactType)}
              </span>
            ) : null}
          </div>
          <div className="summary-fields">
            <span>{review.contact?.email ?? "No email"}</span>
            <span>{review.contact?.phone ?? "No phone"}</span>
            <span>
              {review.contact?.address ??
                review.contact?.company ??
                "No address"}
            </span>
          </div>
        </article>

        <article className="panel inquiry-summary-card">
          <div className="summary-title">
            <div>
              <p className="eyebrow">Lead</p>
              <h2>
                {review.lead?.serviceType ??
                  review.lead?.source ??
                  "General inquiry"}
              </h2>
            </div>
            <span className={profileNeedsReview ? "pill warning" : "pill"}>
              {profileNeedsReview
                ? "Profile check"
                : formatLabel(review.conversation.status)}
            </span>
          </div>
          <div className="summary-fields">
            <span>{review.lead?.nextStep ?? "No next step set"}</span>
            <span>{review.lead?.source ?? "Unknown source"}</span>
            <span>
              Updated{" "}
              {formatDate(
                review.lead?.updatedAt ?? review.conversation.lastMessageAt,
              )}
            </span>
          </div>
        </article>
      </section>

      <section className="panel inquiry-facts-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Current facts</p>
            <h2>Inquiry facts</h2>
          </div>
          <span className="pill">
            {review.inquiryFacts
              ? formatLabel(review.inquiryFacts.source)
              : latestAiRun
                ? "AI extracted"
                : "No triage"}
          </span>
        </div>

        <form action={updateInquiryFactsAction} className="facts-form">
          <input name="conversationId" type="hidden" value={conversationId} />
          <div className="facts-grid editable">
            <label className="fact-item fact-input">
              <strong>Job type</strong>
              <input
                defaultValue={textValue(currentInquiryFacts.jobType) ?? ""}
                name="jobType"
                placeholder="e.g. Toilet Replacement"
                type="text"
              />
            </label>
            <label className="fact-item fact-input">
              <strong>Address</strong>
              <input
                defaultValue={textValue(currentInquiryFacts.address) ?? ""}
                name="address"
                placeholder="Job address"
                type="text"
              />
            </label>
            <label className="fact-item fact-input">
              <strong>Preferred time</strong>
              <input
                defaultValue={
                  textValue(currentInquiryFacts.preferredTime) ?? ""
                }
                name="preferredTime"
                placeholder="e.g. tomorrow morning"
                type="text"
              />
            </label>
            <label className="fact-item fact-input">
              <strong>Urgency</strong>
              <select
                defaultValue={
                  textValue(currentInquiryFacts.urgency) ?? "normal"
                }
                name="urgency"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="fact-item fact-input">
              <strong>Budget</strong>
              <input
                defaultValue={textValue(currentInquiryFacts.budget) ?? ""}
                name="budget"
                placeholder="Optional"
                type="text"
              />
            </label>
            <label className="fact-item fact-input">
              <strong>Lead suitability</strong>
              <select
                defaultValue={
                  textValue(currentInquiryFacts.fit) ?? "needs_review"
                }
                name="fit"
              >
                <option value="likely_fit">Likely fit</option>
                <option value="needs_review">Needs review</option>
                <option value="not_fit">Not fit</option>
              </select>
            </label>
          </div>
          <label className="missing-info-editor">
            Missing info
            <textarea
              defaultValue={missingInfo.join("\n")}
              name="missingInfo"
              placeholder="One missing item per line, e.g. Job address"
            />
          </label>
          <div className="facts-footer">
            <span>
              {review.inquiryFacts
                ? `Last saved ${formatDate(review.inquiryFacts.updatedAt)}`
                : "Not saved as user facts yet"}
            </span>
            <button className="secondary-button compact" type="submit">
              Save facts
            </button>
          </div>
        </form>
        <form action={regenerateAiPlanAction} className="regenerate-plan-form">
          <input name="conversationId" type="hidden" value={conversationId} />
          <button
            className="primary-button compact"
            disabled={!review.inquiryFacts}
            type="submit"
          >
            Regenerate AI plan
          </button>
          <span>
            Cancels stale pending proposals and creates a fresh reply/actions
            from the saved facts.
          </span>
        </form>
      </section>

      <details className="panel disclosure-panel ai-debug-panel">
        <summary>
          <div>
            <p className="eyebrow">AI transparency</p>
            <h2>Debug trace</h2>
          </div>
          <span className={route?.fallbackUsed ? "pill warning" : "pill"}>
            {route?.fallbackUsed
              ? "Fallback used"
              : latestAiRun
                ? "Trace ready"
                : "No trace"}
          </span>
        </summary>
        <div className="disclosure-content debug-content">
          {latestAiRun ? (
            <>
              <div className="debug-grid">
                <div>
                  <strong>Provider/model</strong>
                  <span>
                    {latestAiRun.provider}/
                    {route?.selectedModel ?? latestAiRun.model}
                  </span>
                </div>
                <div>
                  <strong>Fallback</strong>
                  <span>
                    {route?.fallbackUsed
                      ? (fallbackReason ?? "Used fallback")
                      : "No"}
                  </span>
                </div>
                <div>
                  <strong>Tokens</strong>
                  <span>
                    {displayValue(latestAiRun.usage.inputTokens)} in /{" "}
                    {displayValue(latestAiRun.usage.outputTokens)} out
                  </span>
                </div>
                <div>
                  <strong>Charge</strong>
                  <span>
                    {formatMoney(String(usageTotal), "USD", generalSettings)}
                  </span>
                </div>
                <div>
                  <strong>Actions</strong>
                  <span>
                    {proposedActionTypes.length > 0
                      ? proposedActionTypes.map(formatLabel).join(", ")
                      : "-"}
                  </span>
                </div>
                <div>
                  <strong>Summary</strong>
                  <span>{displayValue(latestAiRun.output.summary)}</span>
                </div>
              </div>
              <pre className="debug-json">
                {JSON.stringify(debugPayload, null, 2)}
              </pre>
            </>
          ) : (
            <p className="empty-copy">
              No AI trace has been recorded for this inquiry.
            </p>
          )}
        </div>
      </details>

      <section className="review-grid large-left inquiry-workbench">
        <article className="panel thread-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Thread</p>
              <h2>Messages</h2>
            </div>
            <span className="pill">{review.messages.length} messages</span>
          </div>

          <form action={createManualFollowUpAction} className="follow-up-form">
            <input name="conversationId" type="hidden" value={conversationId} />
            <input
              name="submissionKey"
              type="hidden"
              value={followUpSubmissionKey}
            />
            <label>
              Add mock inbound
              <textarea
                name="message"
                placeholder="Paste or type the customer's next message..."
                required
              />
            </label>
            <button className="secondary-button compact" type="submit">
              Add and triage
            </button>
          </form>

          <div className="message-list">
            {review.messages.length > 0 ? (
              review.messages.map((message) => (
                <div
                  className={
                    message.direction === "outbound"
                      ? "message-row outbound"
                      : "message-row inbound"
                  }
                  key={message.id}
                >
                  <div className="message-meta">
                    <div className="message-channel">
                      <strong>{formatLabel(message.direction)}</strong>
                      <span className="channel-pill">
                        {channelLabel(
                          message.channelType,
                          message.channelDisplayName,
                        )}
                      </span>
                    </div>
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
                  {textValue(message.metadata.attachmentQuoteDraftId) ? (
                    <div className="message-attachment-pill">
                      Quote draft attached
                    </div>
                  ) : null}
                  {message.metadata.dryRun ? (
                    <div className="message-attachment-pill warning">
                      External send disabled
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="empty-copy">
                No messages found for this conversation.
              </p>
            )}
          </div>
        </article>

        <aside className="side-stack">
          <article className="panel outbound-composer-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Outbound</p>
                <h2>Composer</h2>
              </div>
              <span className="pill warning">Gmail active for email</span>
            </div>

            <form
              action={createMockOutboundMessageAction}
              className="outbound-composer-form"
              encType="multipart/form-data"
            >
              <input
                name="conversationId"
                type="hidden"
                value={conversationId}
              />
              <div className="mini-facts-grid">
                <label>
                  <strong>Channel</strong>
                  <select
                    name="channelType"
                    defaultValue={communicationSettings.allowedChannels[0]}
                  >
                    {OUTBOUND_CHANNELS.map((channel) => (
                      <option
                        disabled={
                          !communicationSettings.allowedChannels.includes(
                            channel,
                          )
                        }
                        key={channel}
                        value={channel}
                      >
                        {formatLabel(channel)}
                        {communicationSettings.allowedChannels.includes(channel)
                          ? ""
                          : " disabled"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="attachment-field">
                  <strong>Attach</strong>
                  <div className="attachment-control-row">
                    <select
                      aria-label="Attach Kyro hosted file"
                      name="attachmentQuoteDraftId"
                      defaultValue={attachedQuoteDraftId}
                    >
                      <option value="">No attachment</option>
                      {review.quoteDrafts.map((quoteDraft) => (
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
                Subject
                <input
                  defaultValue={composerSubject}
                  name="subject"
                  type="text"
                />
              </label>
              <label>
                Message
                <textarea
                  defaultValue={composerBody}
                  name="body"
                  placeholder="Write the outbound message..."
                  required
                />
              </label>
              <ReplyGenerator conversationId={conversationId} />
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
                Send outbound
              </button>
            </form>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Actions</p>
                <h2>Proposed actions</h2>
              </div>
            </div>

            <div className="draft-reply-list">
              {draftReplyActions.length > 0 ? (
                draftReplyActions.map((action) => {
                  const draftSubject = textValue(action.input.subject) ?? "";
                  const draftBody = textValue(action.input.body) ?? "";
                  const canEdit = action.status === "pending_approval";

                  return (
                    <div className="draft-reply-card" key={action.id}>
                      <div className="draft-reply-header">
                        <span className="pill">
                          {formatLabel(action.status)}
                        </span>
                        {textValue(action.input.attachmentQuoteDraftId) ? (
                          <span className="pill">PDF attached</span>
                        ) : null}
                        <span>Created {formatDate(action.createdAt)}</span>
                      </div>
                      <form
                        action={
                          canEdit
                            ? sendDraftReplyAction
                            : executeDashboardAction
                        }
                        className="draft-reply-form"
                      >
                        <input
                          name="actionId"
                          type="hidden"
                          value={action.id}
                        />
                        <input
                          name="conversationId"
                          type="hidden"
                          value={conversationId}
                        />
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={redirectTo}
                        />
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
                          Reply draft
                          <textarea
                            defaultValue={draftBody}
                            name="body"
                            readOnly={!canEdit}
                          />
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
                          {action.status === "pending_approval" ||
                          action.status === "approved" ? (
                            <button
                              className="primary-button compact"
                              type="submit"
                            >
                              Send generated reply
                            </button>
                          ) : null}
                          {action.status === "completed" ? (
                            <span className="pill">Sent</span>
                          ) : null}
                        </div>
                      </form>
                    </div>
                  );
                })
              ) : (
                <p className="empty-copy">No draft reply action yet.</p>
              )}
            </div>

            {otherActions.length > 0 ? (
              <div className="secondary-action-list">
                {otherActions.map((action) => (
                  <ProposedActionCard
                    action={action}
                    key={action.id}
                    redirectTo={redirectTo}
                  />
                ))}
              </div>
            ) : null}
          </article>

          {review.quoteDrafts.length > 0 ? (
            <article className="panel quote-drafts-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Documents</p>
                  <h2>Quote drafts</h2>
                </div>
                <span className="pill">{review.quoteDrafts.length}</span>
              </div>
              <div className="quote-draft-list">
                {review.quoteDrafts.map((quoteDraft) => {
                  const revisionState = quoteRevisionState(quoteDraft.metadata);
                  const needsRevision =
                    quoteDraft.status === "changes_requested" ||
                    Boolean(revisionState.pendingChangeRequest);
                  const canSendRevision =
                    revisionState.currentVersion > 1 &&
                    ["draft", "ready"].includes(quoteDraft.status);
                  const showRevisionActions = needsRevision || canSendRevision;

                  return (
                    <div
                      className={
                        showRevisionActions
                          ? "quote-draft-card quote-draft-card-action"
                          : "quote-draft-card"
                      }
                      key={quoteDraft.id}
                    >
                      <Link
                        className="plain-link"
                        href={`/documents/${quoteDraft.id}`}
                        prefetch={false}
                      >
                        <div>
                          <strong>{quoteDraft.title}</strong>
                          <span>
                            {quoteRevisionLabel(quoteDraft.metadata)} -{" "}
                            {formatLabel(quoteDraft.status)} -{" "}
                            {formatDate(quoteDraft.createdAt)}
                          </span>
                        </div>
                        <div className="quote-line-list">
                          {quoteDraft.lineItems.length > 0 ? (
                            quoteDraft.lineItems.map((item, index) => (
                              <span key={`${quoteDraft.id}-${index}`}>
                                {quoteLineItemLabel(item)}
                              </span>
                            ))
                          ) : (
                            <span>No line items yet.</span>
                          )}
                        </div>
                        {revisionState.pendingChangeRequest?.message ? (
                          <p>
                            Requested change:{" "}
                            {revisionState.pendingChangeRequest.message}
                          </p>
                        ) : quoteDraft.notes ? (
                          <p>{quoteDraft.notes}</p>
                        ) : null}
                      </Link>
                      {showRevisionActions ? (
                        <div className="quote-revision-actions">
                          {needsRevision ? (
                            <Link
                              className="secondary-button compact link-button"
                              href={`/documents/${quoteDraft.id}`}
                              prefetch={false}
                            >
                              Edit quote
                            </Link>
                          ) : null}
                          {canSendRevision ? (
                            <form action={prepareQuoteDraftSendAction}>
                              <input
                                name="quoteDraftId"
                                type="hidden"
                                value={quoteDraft.id}
                              />
                              <button className="primary-button compact" type="submit">
                                Send revised quote
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          ) : null}

          <article className="panel compact-ai-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">AI</p>
                <h2>Latest triage</h2>
              </div>
            </div>

            {latestAiRun ? (
              <div className="compact-ai-copy">
                <strong>
                  {latestAiRun.provider}/
                  {route?.selectedModel ?? latestAiRun.model}
                </strong>
                <p>
                  {textValue(latestAiRun.output.summary) ??
                    "No summary recorded."}
                </p>
              </div>
            ) : (
              <p className="empty-copy">
                No AI triage run found for this inquiry.
              </p>
            )}
          </article>
        </aside>
      </section>

      <section className="panel timeline-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Workflow</p>
            <h2>Timeline</h2>
          </div>
          <span className="pill">{timeline.length} events</span>
        </div>
        <div className="timeline-list">
          {timeline.length > 0 ? (
            timeline.map((item) => (
              <div className="timeline-item" key={item.id}>
                <span className={`timeline-dot ${item.tone}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <time>{formatDate(item.at)}</time>
              </div>
            ))
          ) : (
            <p className="empty-copy">
              No timeline events found for this conversation.
            </p>
          )}
        </div>
      </section>

      <section className="review-grid operations-grid">
        <details className="panel disclosure-panel">
          <summary>
            <div>
              <p className="eyebrow">Usage</p>
              <h2>Metered events</h2>
            </div>
            <span className="pill">{review.usageEvents.length} events</span>
          </summary>
          <div className="engine-list disclosure-content">
            {review.usageEvents.length > 0 ? (
              review.usageEvents.map((usage) => (
                <div className="engine-row" key={usage.id}>
                  <div>
                    <strong>{usage.usageType}</strong>
                    <span>
                      {usage.quantity} - {formatDate(usage.createdAt)}
                    </span>
                  </div>
                  <strong>
                    {formatMoney(
                      usage.customerChargeSnapshot,
                      usage.currency,
                      generalSettings,
                    )}
                  </strong>
                </div>
              ))
            ) : (
              <p className="empty-copy">
                No usage events recorded for this inquiry.
              </p>
            )}
          </div>
        </details>

        <details className="panel disclosure-panel">
          <summary>
            <div>
              <p className="eyebrow">Audit</p>
              <h2>History</h2>
            </div>
            <span className="pill">{review.auditLogs.length} logs</span>
          </summary>
          <div className="engine-list disclosure-content">
            {review.auditLogs.length > 0 ? (
              review.auditLogs.map((log) => (
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
                No audit logs found for this inquiry.
              </p>
            )}
          </div>
        </details>
      </section>
    </AppFrame>
  );
}
