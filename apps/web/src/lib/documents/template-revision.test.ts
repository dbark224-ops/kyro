import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blankDocumentTemplateRevisionPayload,
  parseDocumentTemplateRevision,
} from "./template-revision";

describe("document template revision payloads", () => {
  it("builds a blank assistant-editable payload from workspace defaults", () => {
    const payload = blankDocumentTemplateRevisionPayload({
      label: "Invoice",
      settings: { currency: "AUD", validityDays: 21 },
    });

    assert.equal(payload.label, "Invoice");
    assert.equal(payload.settings.currency, "AUD");
    assert.equal(payload.settings.validityDays, 21);
    assert.deepEqual(payload.lineItems, []);
  });

  it("normalizes model JSON into reusable template data", () => {
    const revision = parseDocumentTemplateRevision(
      JSON.stringify({
        description: "Premium invoice",
        label: "Invoice",
        lineItems: [
          {
            description: "Labour",
            notes: "Includes standard labour allowance",
            quantity: 1,
            unit: "job",
            unitPrice: null,
          },
        ],
        notes: "Confirm scope before sending.",
        revisionRequest: "Create an invoice template",
        settings: {
          accentTheme: "cyan",
          currency: "AUD",
          footerText: "Thanks for working with us.",
          paymentTerms: "Due within 7 days.",
          quoteStyleDirection: "Premium, clean, easy to scan.",
          showPreparedBy: true,
          validityDays: 14,
        },
      }),
    );

    assert.equal(revision.label, "Invoice");
    assert.equal(revision.lineItems[0].description, "Labour");
    assert.equal(revision.settings.accentTheme, "cyan");
  });
});
