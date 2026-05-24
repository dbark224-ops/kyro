import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QuoteDraftProfile } from "../crm/queries";
import { DEFAULT_DOCUMENT_TEMPLATE_SETTINGS } from "./settings";
import {
  appendQuoteDocumentHistory,
  quoteDocumentChangedSinceLastEvent,
  quoteDocumentContentHash,
  quoteDocumentHistory,
} from "./history";

function profile(title = "Quote"): QuoteDraftProfile {
  return {
    auditLogs: [],
    inquiryFacts: null,
    messages: [],
    quoteDraft: {
      contact: null,
      conversation: null,
      createdAt: "2026-05-24T00:00:00.000Z",
      id: "quote-1",
      inquiryFacts: null,
      lead: null,
      lineItemCount: 1,
      lineItems: [
        {
          description: "Callout",
          notes: null,
          quantity: 1,
          total: 120,
          unit: "job",
          unitPrice: 120,
        },
      ],
      metadata: {
        customerEmail: "pat@example.com",
        lastGeneratedDocument: {
          generatedAt: "ignored",
        },
      },
      notes: "Confirm before sending.",
      status: "draft",
      title,
      updatedAt: "2026-05-24T00:00:00.000Z",
    },
  };
}

describe("quote document history", () => {
  it("creates stable content hashes that ignore document history metadata", () => {
    const first = quoteDocumentContentHash({
      profile: profile(),
      settings: DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
    });
    const withHistory = profile();

    withHistory.quoteDraft.metadata = appendQuoteDocumentHistory(
      withHistory.quoteDraft.metadata,
      {
        contentHash: "old",
        document: null,
        kind: "pdf_generated",
        occurredAt: "2026-05-24T01:00:00.000Z",
        source: "test",
      },
    );

    assert.equal(
      quoteDocumentContentHash({
        profile: withHistory,
        settings: DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
      }),
      first,
    );
  });

  it("detects changes since the latest document event", () => {
    const current = quoteDocumentContentHash({
      profile: profile("Quote A"),
      settings: DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
    });
    const historyMetadata = appendQuoteDocumentHistory(
      {},
      {
        contentHash: current,
        document: { contentHash: current },
        kind: "email_sent",
        occurredAt: "2026-05-24T01:00:00.000Z",
        source: "test",
      },
    );
    const history = quoteDocumentHistory(historyMetadata);

    assert.equal(
      quoteDocumentChangedSinceLastEvent({
        currentContentHash: current,
        history,
      }).changed,
      false,
    );
    assert.equal(
      quoteDocumentChangedSinceLastEvent({
        currentContentHash: "different",
        history,
      }).changed,
      true,
    );
  });

  it("keeps customer approval events in the document history trail", () => {
    const metadata = appendQuoteDocumentHistory(
      {},
      {
        contentHash: "current",
        kind: "customer_approved",
        occurredAt: "2026-05-24T02:00:00.000Z",
        source: "quote.approval_portal",
      },
    );
    const history = quoteDocumentHistory(metadata);

    assert.equal(history.length, 1);
    assert.equal(history[0].kind, "customer_approved");
  });
});
