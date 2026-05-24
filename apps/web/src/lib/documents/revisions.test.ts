import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendQuoteDocumentHistory, quoteDocumentHistory } from "./history";
import {
  markQuoteChangeRequestReceived,
  markQuotePreparedForCustomer,
  quoteEditableContentChanged,
  quoteRevisionMetadataAfterEditorSave,
  quoteRevisionState,
  quoteVersionedDocumentMetadata,
} from "./revisions";

describe("quote revisions", () => {
  it("tracks customer change requests against the active version", () => {
    const metadata = markQuoteChangeRequestReceived({
      at: "2026-05-24T01:00:00.000Z",
      message: "Please add the upstairs bathroom.",
      metadata: {},
    });
    const withHistory = appendQuoteDocumentHistory(metadata, {
      document: { message: "Please add the upstairs bathroom." },
      kind: "customer_changes_requested",
      occurredAt: "2026-05-24T01:00:00.000Z",
      quoteVersion: 1,
      source: "test",
    });
    const state = quoteRevisionState(withHistory);

    assert.equal(state.currentVersion, 1);
    assert.equal(state.needsRevision, true);
    assert.equal(state.pendingChangeRequest?.requestedFromVersion, 1);
    assert.equal(
      state.pendingChangeRequest?.message,
      "Please add the upstairs bathroom.",
    );
  });

  it("increments the quote version when edits resolve a change request", () => {
    const requested = markQuoteChangeRequestReceived({
      at: "2026-05-24T01:00:00.000Z",
      message: "Please add a second line item.",
      metadata: {},
    });
    const updated = quoteRevisionMetadataAfterEditorSave({
      at: "2026-05-24T02:00:00.000Z",
      beforeMetadata: requested,
      contentChanged: true,
      nextMetadata: { ...requested, updatedFrom: "documents.editor" },
      previousStatus: "changes_requested",
    });
    const state = quoteRevisionState(updated);
    const revision = updated.quoteRevision as Record<string, unknown>;
    const pendingChangeRequest = revision.pendingChangeRequest as Record<
      string,
      unknown
    >;

    assert.equal(state.currentVersion, 2);
    assert.equal(state.pendingChangeRequest, null);
    assert.equal(state.needsRevision, false);
    assert.equal(revision.revisedFromVersion, 1);
    assert.equal(pendingChangeRequest.status, "resolved");
    assert.equal(revision.status, "revision_draft");
  });

  it("stores the active quote version on generated document metadata and history", () => {
    const revised = quoteRevisionMetadataAfterEditorSave({
      at: "2026-05-24T02:00:00.000Z",
      beforeMetadata: markQuoteChangeRequestReceived({
        at: "2026-05-24T01:00:00.000Z",
        message: "Please revise it.",
        metadata: {},
      }),
      contentChanged: true,
      nextMetadata: {},
      previousStatus: "changes_requested",
    });
    const document = quoteVersionedDocumentMetadata(
      { contentHash: "hash", filename: "quote.pdf" },
      revised,
    );
    const prepared = markQuotePreparedForCustomer({
      approvalLinkId: "approval-1",
      at: "2026-05-24T03:00:00.000Z",
      contentHash: "hash",
      metadata: revised,
      source: "test",
    });
    const history = quoteDocumentHistory(
      appendQuoteDocumentHistory(prepared, {
        contentHash: "hash",
        document,
        kind: "email_prepared",
        occurredAt: "2026-05-24T03:00:00.000Z",
        quoteVersion: Number(document.quoteVersion),
        source: "test",
      }),
    );

    assert.equal(document.quoteVersion, 2);
    assert.equal(quoteRevisionState(prepared).needsRevision, false);
    assert.equal(history[0].quoteVersion, 2);
  });

  it("does not keep legacy change-request history pending after a prepared revision", () => {
    const requested = appendQuoteDocumentHistory(
      {},
      {
        document: { message: "Please revise it." },
        kind: "customer_changes_requested",
        occurredAt: "2026-05-24T01:00:00.000Z",
        quoteVersion: 1,
        source: "test",
      },
    );
    const prepared = appendQuoteDocumentHistory(requested, {
      document: { quoteVersion: 2 },
      kind: "email_prepared",
      occurredAt: "2026-05-24T03:00:00.000Z",
      quoteVersion: 2,
      source: "test",
    });
    const state = quoteRevisionState(prepared);

    assert.equal(state.pendingChangeRequest, null);
    assert.equal(state.needsRevision, false);
  });

  it("ignores volatile revision metadata when checking editable content", () => {
    assert.equal(
      quoteEditableContentChanged(
        {
          contactId: "contact-1",
          lineItems: [{ description: "Callout" }],
          metadata: { quoteRevision: { currentVersion: 1 } },
          notes: "Notes",
          title: "Quote",
        },
        {
          contactId: "contact-1",
          lineItems: [{ description: "Callout" }],
          metadata: { quoteRevision: { currentVersion: 2 } },
          notes: "Notes",
          title: "Quote",
        },
      ),
      false,
    );
  });
});
