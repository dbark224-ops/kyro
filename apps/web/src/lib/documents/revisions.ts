import { quoteDocumentHistory, type QuoteDocumentHistoryEvent } from "./history";

export type QuoteRevisionState = {
  currentVersion: number;
  latestChangeRequest: QuoteDocumentHistoryEvent | null;
  latestCustomerFacingEvent: QuoteDocumentHistoryEvent | null;
  latestPreparedEvent: QuoteDocumentHistoryEvent | null;
  latestSentEvent: QuoteDocumentHistoryEvent | null;
  needsRevision: boolean;
  pendingChangeRequest: {
    message: string | null;
    requestedAt: string | null;
    requestedFromVersion: number;
  } | null;
};

const VOLATILE_METADATA_KEYS = new Set([
  "customerApproval",
  "documentHistory",
  "lastGeneratedDocument",
  "preparedSendActionId",
  "preparedSendAt",
  "quoteApprovalLinkId",
  "quoteRevision",
  "sentAt",
  "sentChannelType",
  "sentDryRunAt",
  "sentDryRunChannelType",
  "sentDryRunMessageId",
  "sentExternalAt",
  "sentExternalMessageId",
  "sentExternalProvider",
  "sentMessageId",
  "updatedFrom",
]);

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown, fallback = 1) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function dateValue(value: string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }

  return value ?? null;
}

function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function quoteRevisionMetadata(metadata: Record<string, unknown>) {
  return objectRecord(metadata.quoteRevision);
}

function eventVersion(event: QuoteDocumentHistoryEvent | null) {
  if (!event) {
    return 1;
  }

  return event.quoteVersion ?? numberValue(event.document?.quoteVersion, 1);
}

function latestEvent(
  history: QuoteDocumentHistoryEvent[],
  kinds: QuoteDocumentHistoryEvent["kind"][],
) {
  return history.find((event) => kinds.includes(event.kind)) ?? null;
}

export function quoteRevisionState(metadata: Record<string, unknown>): QuoteRevisionState {
  const revision = quoteRevisionMetadata(metadata);
  const history = quoteDocumentHistory(metadata);
  const latestChangeRequest = latestEvent(history, ["customer_changes_requested"]);
  const latestSentEvent = latestEvent(history, ["email_sent"]);
  const latestPreparedEvent = latestEvent(history, ["email_prepared"]);
  const latestCustomerFacingEvent = latestEvent(history, [
    "customer_approved",
    "customer_changes_requested",
    "customer_viewed",
    "email_sent",
    "email_prepared",
  ]);
  const historyVersion = Math.max(
    1,
    ...history.map((event) => eventVersion(event)).filter(Number.isFinite),
  );
  const currentVersion = Math.max(
    numberValue(revision.currentVersion, 1),
    historyVersion,
  );
  const pendingChangeRequest = objectRecord(revision.pendingChangeRequest);
  const pendingRequestedFromVersion = numberValue(
    pendingChangeRequest.requestedFromVersion,
    latestChangeRequest ? eventVersion(latestChangeRequest) : currentVersion,
  );
  const hasPendingMetadata = Object.keys(pendingChangeRequest).length > 0;
  const legacyHistoryNeedsRevision = Boolean(
    !hasPendingMetadata &&
      latestChangeRequest &&
      (!latestPreparedEvent ||
        dateValue(latestChangeRequest.occurredAt) >
          dateValue(latestPreparedEvent.occurredAt)),
  );
  const pendingSourceExists = Boolean(
    (hasPendingMetadata && pendingChangeRequest.status !== "resolved") ||
      legacyHistoryNeedsRevision,
  );
  const pending = pendingSourceExists
    ? {
        message:
          textValue(pendingChangeRequest.message) ??
          textValue(latestChangeRequest?.document?.message) ??
          null,
        requestedAt:
          textValue(pendingChangeRequest.requestedAt) ??
          latestChangeRequest?.occurredAt ??
          null,
        requestedFromVersion: pendingRequestedFromVersion,
      }
    : null;
  const needsRevision = Boolean(pending);

  return {
    currentVersion,
    latestChangeRequest,
    latestCustomerFacingEvent,
    latestPreparedEvent,
    latestSentEvent,
    needsRevision,
    pendingChangeRequest: pending,
  };
}

export function quoteRevisionLabel(metadata: Record<string, unknown>) {
  return `v${quoteRevisionState(metadata).currentVersion}`;
}

export function quoteVersionedDocumentMetadata<T extends Record<string, unknown>>(
  documentMetadata: T,
  metadata: Record<string, unknown>,
): T & { quoteVersion: number } {
  const state = quoteRevisionState(metadata);

  return {
    ...documentMetadata,
    quoteVersion: state.currentVersion,
  };
}

export function markQuoteChangeRequestReceived({
  at,
  message,
  metadata,
}: {
  at: string;
  message: string | null;
  metadata: Record<string, unknown>;
}) {
  const state = quoteRevisionState(metadata);
  const revision = quoteRevisionMetadata(metadata);

  return {
    ...metadata,
    quoteRevision: {
      ...revision,
      currentVersion: state.currentVersion,
      pendingChangeRequest: {
        message,
        requestedAt: at,
        requestedFromVersion: state.currentVersion,
        status: "open",
      },
      status: "changes_requested",
      updatedAt: at,
    },
  };
}

export function markQuotePreparedForCustomer({
  approvalLinkId,
  at,
  contentHash,
  metadata,
  source,
}: {
  approvalLinkId: string;
  at: string;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  source: string;
}) {
  const state = quoteRevisionState(metadata);
  const revision = quoteRevisionMetadata(metadata);

  return {
    ...metadata,
    quoteApprovalLinkId: approvalLinkId,
    quoteRevision: {
      ...revision,
      awaitingCustomerVersion: state.currentVersion,
      currentVersion: state.currentVersion,
      lastPreparedAt: at,
      lastPreparedContentHash: contentHash,
      lastPreparedSource: source,
      lastPreparedVersion: state.currentVersion,
      pendingChangeRequest: state.pendingChangeRequest
        ? {
            ...state.pendingChangeRequest,
            resolvedAt: at,
            status: "resolved",
          }
        : objectRecord(revision.pendingChangeRequest),
      status: "awaiting_customer",
      updatedAt: at,
    },
  };
}

export function markQuoteSentToCustomer({
  at,
  contentHash,
  metadata,
  source,
}: {
  at: string;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  source: string;
}) {
  const state = quoteRevisionState(metadata);
  const revision = quoteRevisionMetadata(metadata);

  return {
    ...metadata,
    quoteRevision: {
      ...revision,
      currentVersion: state.currentVersion,
      lastSentAt: at,
      lastSentContentHash: contentHash,
      lastSentSource: source,
      lastSentVersion: state.currentVersion,
      status: "awaiting_customer",
      updatedAt: at,
    },
  };
}

export function markQuoteCustomerApproved({
  at,
  metadata,
}: {
  at: string;
  metadata: Record<string, unknown>;
}) {
  const state = quoteRevisionState(metadata);
  const revision = quoteRevisionMetadata(metadata);

  return {
    ...metadata,
    quoteRevision: {
      ...revision,
      approvedAt: at,
      approvedVersion: state.currentVersion,
      currentVersion: state.currentVersion,
      status: "approved",
      updatedAt: at,
    },
  };
}

export function quoteRevisionMetadataAfterEditorSave({
  at,
  beforeMetadata,
  contentChanged,
  nextMetadata,
  previousStatus,
}: {
  at: string;
  beforeMetadata: Record<string, unknown>;
  contentChanged: boolean;
  nextMetadata: Record<string, unknown>;
  previousStatus: string;
}) {
  const state = quoteRevisionState(beforeMetadata);
  const nextRevision = quoteRevisionMetadata(nextMetadata);

  if (!contentChanged || previousStatus !== "changes_requested") {
    return {
      ...nextMetadata,
      quoteRevision: {
        ...nextRevision,
        currentVersion: state.currentVersion,
      },
    };
  }

  const requestedFromVersion =
    state.pendingChangeRequest?.requestedFromVersion ?? state.currentVersion;
  const nextVersion = Math.max(state.currentVersion + 1, requestedFromVersion + 1);

  return {
    ...nextMetadata,
    quoteRevision: {
      ...nextRevision,
      currentVersion: nextVersion,
      pendingChangeRequest: state.pendingChangeRequest
        ? {
            ...state.pendingChangeRequest,
            resolvedAt: at,
            status: "resolved",
          }
        : objectRecord(nextRevision.pendingChangeRequest),
      revisedAt: at,
      revisedFromVersion: requestedFromVersion,
      status: "revision_draft",
      updatedAt: at,
    },
  };
}

export function quoteEditableSnapshot(input: {
  contactId?: string | null;
  lineItems: unknown;
  metadata: Record<string, unknown>;
  notes?: string | null;
  title: string;
}) {
  return stableStringify({
    contactId: input.contactId ?? null,
    lineItems: input.lineItems,
    metadata: Object.fromEntries(
      Object.entries(input.metadata).filter(
        ([key]) => !VOLATILE_METADATA_KEYS.has(key),
      ),
    ),
    notes: input.notes ?? null,
    title: input.title,
  });
}

export function quoteEditableContentChanged(
  before: Parameters<typeof quoteEditableSnapshot>[0],
  after: Parameters<typeof quoteEditableSnapshot>[0],
) {
  return quoteEditableSnapshot(before) !== quoteEditableSnapshot(after);
}
