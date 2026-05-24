import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
  documentTemplateDesignSettingsForQuote,
  normalizeDocumentTemplateSettings,
} from "./settings";

describe("document template settings", () => {
  it("normalizes supported values", () => {
    const settings = normalizeDocumentTemplateSettings({
      accentTheme: "cyan",
      currency: "NZD",
      footerText: "Thanks",
      paymentTerms: "Seven days",
      quoteStyleDirection: "Minimal and calm",
      showPreparedBy: false,
      validityDays: "21",
    });

    assert.equal(settings.accentTheme, "cyan");
    assert.equal(settings.currency, "NZD");
    assert.equal(settings.footerText, "Thanks");
    assert.equal(settings.paymentTerms, "Seven days");
    assert.equal(settings.quoteStyleDirection, "Minimal and calm");
    assert.equal(settings.showPreparedBy, false);
    assert.equal(settings.validityDays, 21);
  });

  it("falls back and bounds risky values", () => {
    const settings = normalizeDocumentTemplateSettings({
      accentTheme: "neon",
      currency: "DOGE",
      showPreparedBy: "yes",
      validityDays: 999,
    });

    assert.equal(
      settings.accentTheme,
      DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.accentTheme,
    );
    assert.equal(settings.currency, DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.currency);
    assert.equal(
      settings.showPreparedBy,
      DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.showPreparedBy,
    );
    assert.equal(settings.validityDays, 90);
  });

  it("normalizes custom reusable templates and reference metadata", () => {
    const settings = normalizeDocumentTemplateSettings({
      customTemplates: [
        {
          createdAt: "2026-05-22T00:00:00.000Z",
          description: "For larger jobs",
          key: "custom_premium",
          label: "Premium Quote",
          lineItems: [
            {
              description: "Planning",
              quantity: "2",
              unit: "hour",
              unitPrice: "100",
            },
          ],
          notes: "Check inclusions.",
          referenceFiles: [{ name: "old-quote.pdf", size: "2048", type: "application/pdf" }],
          revisionRequest: "Make it cleaner.",
          settings: {
            accentTheme: "blue",
            currency: "AUD",
            validityDays: "30",
          },
          updatedAt: "2026-05-22T00:00:00.000Z",
        },
      ],
    });

    assert.equal(settings.customTemplates.length, 1);
    assert.equal(settings.customTemplates[0]?.label, "Premium Quote");
    assert.equal(settings.customTemplates[0]?.lineItems[0]?.total, 200);
    assert.equal(settings.customTemplates[0]?.referenceFiles[0]?.name, "old-quote.pdf");
    assert.equal(settings.customTemplates[0]?.settings.accentTheme, "blue");
    assert.equal(settings.customTemplates[0]?.settings.validityDays, 30);
  });

  it("keeps blank user-created templates blank instead of inserting trade defaults", () => {
    const settings = normalizeDocumentTemplateSettings({
      customTemplates: [
        {
          createdAt: "2026-05-23T00:00:00.000Z",
          description: "Starts clean",
          key: "custom_blank",
          label: "Blank Quote",
          lineItems: [],
          notes: "",
          referenceFiles: [],
          settings: {},
          updatedAt: "2026-05-23T00:00:00.000Z",
        },
      ],
    });

    assert.equal(settings.customTemplates.length, 1);
    assert.deepEqual(settings.customTemplates[0]?.lineItems, []);
    assert.equal(settings.customTemplates[0]?.notes, "");
  });

  it("uses saved quote template settings snapshots before workspace defaults", () => {
    const settings = documentTemplateDesignSettingsForQuote(
      {
        documentTemplateSettings: {
          accentTheme: "green",
          currency: "NZD",
          validityDays: 7,
        },
      },
      DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
    );

    assert.equal(settings.accentTheme, "green");
    assert.equal(settings.currency, "NZD");
    assert.equal(settings.validityDays, 7);
  });
});
