import { createHash } from "node:crypto";
import type { QuoteDraftProfile } from "../crm/queries";
import type { DocumentTemplateDesignSettings } from "./settings";
import { normalizeQuoteLineItems } from "./templates";

export type QuoteDocumentEventKind =
  | "customer_approved"
  | "customer_changes_requested"
  | "customer_viewed"
  | "email_prepared"
  | "email_sent"
  | "pdf_generated";

export type QuoteDocumentHistoryEvent = {
  actionId?: string | null;
  actorType?: "ai" | "system" | "user";
  channelType?: string | null;
  contentHash?: string | null;
  document?: Record<string, unknown> | null;
  id: string;
  kind: QuoteDocumentEventKind;
  messageId?: string | null;
  occurredAt: string;
  quoteVersion?: number;
  sentTo?: string | null;
  source?: string | null;
};

const HISTORY_LIMIT = 40;

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

function stableQuoteMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !VOLATILE_METADATA_KEYS.has(key),
    ),
  );
}

function shortHash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 20);
}

export function quoteDocumentContentHash({
  profile,
  settings,
}: {
  profile: QuoteDraftProfile;
  settings: DocumentTemplateDesignSettings;
}) {
  const quote = profile.quoteDraft;

  return shortHash({
    contact: quote.contact,
    inquiryFacts: profile.inquiryFacts ?? quote.inquiryFacts,
    lead: quote.lead,
    lineItems: normalizeQuoteLineItems(quote.lineItems),
    metadata: stableQuoteMetadata(quote.metadata),
    notes: quote.notes,
    settings,
    title: quote.title,
  });
}

export function quoteDocumentHistory(metadata: Record<string, unknown>) {
  const rawHistory = metadata.documentHistory;

  if (!Array.isArray(rawHistory)) {
    return [] as QuoteDocumentHistoryEvent[];
  }

  const parsed: QuoteDocumentHistoryEvent[] = [];

  for (const item of rawHistory) {
    const event = objectRecord(item);
    const kind = textValue(event.kind);
    const occurredAt = textValue(event.occurredAt);
    const id = textValue(event.id);

    if (
      !id ||
      !occurredAt ||
      (kind !== "pdf_generated" &&
        kind !== "customer_approved" &&
        kind !== "customer_changes_requested" &&
        kind !== "customer_viewed" &&
        kind !== "email_prepared" &&
        kind !== "email_sent")
    ) {
      continue;
    }

    const normalized: QuoteDocumentHistoryEvent = {
      id,
      kind,
      occurredAt,
    };
    const actionId = textValue(event.actionId);
    const channelType = textValue(event.channelType);
    const contentHash = textValue(event.contentHash);
    const messageId = textValue(event.messageId);
    const document = objectRecord(event.document);
    const quoteVersion = Number(event.quoteVersion ?? document.quoteVersion);
    const sentTo = textValue(event.sentTo);
    const source = textValue(event.source);

    if (
      event.actorType === "ai" ||
      event.actorType === "system" ||
      event.actorType === "user"
    ) {
      normalized.actorType = event.actorType;
    }

    if (actionId) {
      normalized.actionId = actionId;
    }

    if (channelType) {
      normalized.channelType = channelType;
    }

    if (contentHash) {
      normalized.contentHash = contentHash;
    }

    if (event.document) {
      normalized.document = document;
    }

    if (messageId) {
      normalized.messageId = messageId;
    }

    if (Number.isFinite(quoteVersion) && quoteVersion > 0) {
      normalized.quoteVersion = Math.floor(quoteVersion);
    }

    if (sentTo) {
      normalized.sentTo = sentTo;
    }

    if (source) {
      normalized.source = source;
    }

    parsed.push(normalized);
  }

  return parsed.sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() -
      new Date(left.occurredAt).getTime(),
  );
}

export function appendQuoteDocumentHistory(
  metadata: Record<string, unknown>,
  event: Omit<QuoteDocumentHistoryEvent, "id"> & { id?: string | null },
) {
  const eventId =
    event.id ??
    shortHash({
      actionId: event.actionId,
      contentHash: event.contentHash,
      kind: event.kind,
      messageId: event.messageId,
      occurredAt: event.occurredAt,
      source: event.source,
    });
  const nextEvent: QuoteDocumentHistoryEvent = {
    ...event,
    id: eventId,
  };
  const deduped = [
    nextEvent,
    ...quoteDocumentHistory(metadata).filter((item) => item.id !== eventId),
  ]
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime(),
    )
    .slice(0, HISTORY_LIMIT);

  return {
    ...metadata,
    documentHistory: deduped,
  };
}

export function quoteDocumentChangedSinceLastEvent({
  currentContentHash,
  history,
  kinds = ["email_sent", "email_prepared", "pdf_generated"],
}: {
  currentContentHash: string;
  history: QuoteDocumentHistoryEvent[];
  kinds?: QuoteDocumentEventKind[];
}) {
  const latest = history.find(
    (event) => kinds.includes(event.kind) && event.contentHash,
  );

  return {
    changed: Boolean(latest?.contentHash && latest.contentHash !== currentContentHash),
    latest: latest ?? null,
  };
}
