import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import type { QuoteDraftProfile } from "../crm/queries";
import { DEFAULT_DOCUMENT_TEMPLATE_SETTINGS } from "./settings";
import {
  buildQuotePdfArtifact,
  quotePdfFilename,
  quotePdfMetadata,
} from "./pdf";

const profile: QuoteDraftProfile = {
  auditLogs: [],
  inquiryFacts: {
    address: "10 Sample St",
    budget: null,
    fit: null,
    jobType: "Leak repair",
    missingInfo: [],
    preferredTime: "Tomorrow",
    urgency: null,
  },
  messages: [],
  quoteDraft: {
    contact: {
      address: null,
      company: null,
      email: "pat@example.com",
      id: "contact-1",
      name: "Pat Customer",
      phone: "0400 000 000",
    },
    conversation: null,
    createdAt: "2026-05-22T00:00:00.000Z",
    id: "quote-1",
    inquiryFacts: {
      address: "10 Sample St",
      budget: null,
      jobType: "Leak repair",
      preferredTime: "Tomorrow",
    },
    lead: null,
    lineItemCount: 1,
    lineItems: [
      {
        description: "Callout and diagnosis",
        notes: "Includes first inspection.",
        quantity: 1,
        total: 125,
        unit: "visit",
        unitPrice: 125,
      },
    ],
    metadata: {},
    notes: "Confirm parts before sending.",
    status: "draft",
    title: "Leak Repair Quote",
    updatedAt: "2026-05-22T00:00:00.000Z",
  },
};

describe("quote PDF artifacts", () => {
  it("generates a valid PDF attachment artifact from quote data", async () => {
    const artifact = await buildQuotePdfArtifact({
      businessProfile: {
        businessName: "WFA Plumbing",
        defaultReplyInstructions: null,
        description: null,
        industry: "Plumbing",
        serviceArea: "Brisbane",
        toneOfVoice: null,
      },
      generatedAt: new Date("2026-05-22T00:00:00.000Z"),
      profile,
      settings: DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
      workspace: { name: "WFA Plumbing" },
    });
    const parsed = await PDFDocument.load(artifact.bytes);

    assert.equal(artifact.contentType, "application/pdf");
    assert.equal(artifact.filename, "Leak Repair Quote.pdf");
    assert.ok(artifact.contentBase64.length > 100);
    assert.ok(artifact.sizeBytes > 500);
    assert.equal(parsed.getPageCount(), 1);
    assert.equal(artifact.contentHash.length, 20);
    assert.deepEqual(quotePdfMetadata(artifact), {
      contentHash: artifact.contentHash,
      contentType: "application/pdf",
      filename: "Leak Repair Quote.pdf",
      generatedAt: "2026-05-22T00:00:00.000Z",
      renderer: "pdf-lib",
      sizeBytes: artifact.sizeBytes,
    });
  });

  it("sanitizes PDF filenames", () => {
    assert.equal(
      quotePdfFilename('Bad / Quote: "Name"'),
      "Bad _ Quote_ _Name_.pdf",
    );
  });
});
