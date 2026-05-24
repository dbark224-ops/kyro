import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QuoteDraftProfile } from "../crm/queries";
import { DEFAULT_DOCUMENT_TEMPLATE_SETTINGS } from "./settings";
import { buildQuoteDocumentHtml, buildQuoteTemplatePreviewHtml } from "./render";

const baseProfile: QuoteDraftProfile = {
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
        notes: null,
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

describe("buildQuoteDocumentHtml", () => {
  it("renders escaped quote data into printable HTML", () => {
    const html = buildQuoteDocumentHtml({
      businessProfile: {
        businessName: "WFA Plumbing",
        defaultReplyInstructions: null,
        description: null,
        industry: "Plumbing",
        serviceArea: "Brisbane",
        toneOfVoice: null,
      },
      generatedAt: new Date("2026-05-22T00:00:00.000Z"),
      profile: {
        ...baseProfile,
        quoteDraft: {
          ...baseProfile.quoteDraft,
          title: "Leak <Repair> Quote",
        },
      },
      settings: DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
      workspace: { name: "WFA Plumbing" },
    });

    assert.match(html, /Leak &lt;Repair&gt; Quote/);
    assert.match(html, /WFA Plumbing/);
    assert.match(html, /Callout and diagnosis/);
    assert.ok(html.includes("A$125.00"));
    assert.ok(html.includes("Print / save PDF"));
    assert.match(html, /@page \{ size: A4; margin: 0; \}/);
    assert.match(html, /\.page \{ width: auto; min-height: auto; margin: 0; padding: 18mm; \}/);
    assert.doesNotMatch(html, /backdrop-filter/);
    assert.doesNotMatch(html, /Template direction/);
    assert.doesNotMatch(html, /Clean, professional, service-business quote/);
  });

  it("renders template previews through the same document renderer without print chrome", () => {
    const html = buildQuoteTemplatePreviewHtml({
      generatedAt: new Date("2026-05-23T00:00:00.000Z"),
      lineItems: [
        {
          description: "Rough-in allowance",
          notes: "Confirm site access.",
          quantity: 1,
          total: null,
          unit: "job",
          unitPrice: null,
        },
      ],
      notes: "Template notes.",
      settings: DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
      templateDescription: "Bathroom renovation",
      templateLabel: "Renovation Quote",
      workspace: { name: "WFA Plumbing" },
    });

    assert.match(html, /Renovation Quote/);
    assert.match(html, /Bathroom renovation/);
    assert.match(html, /Rough-in allowance/);
    assert.match(html, /Template notes/);
    assert.doesNotMatch(html, /Print \/ save PDF/);
  });
});
