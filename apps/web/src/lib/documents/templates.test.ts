import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  draftTitleFromTemplate,
  getQuoteTemplate,
  parseQuoteLineItemRows,
  quoteLineItem,
  quoteTemplateCatalog,
} from "./templates";

describe("parseQuoteLineItemRows", () => {
  it("turns editable row fields into priced line items", () => {
    const items = parseQuoteLineItemRows([
      {
        description: "Callout and diagnosis",
        notes: "Includes first 30 minutes",
        quantity: "2",
        unit: "visit",
        unitPrice: "$125.50",
      },
    ]);

    assert.deepEqual(items, [
      {
        description: "Callout and diagnosis",
        notes: "Includes first 30 minutes",
        quantity: 2,
        total: 251,
        unit: "visit",
        unitPrice: 125.5,
      },
    ]);
  });

  it("drops fully blank rows but keeps partial rows editable", () => {
    const items = parseQuoteLineItemRows([
      { description: "", quantity: "", unit: "", unitPrice: "", notes: "" },
      { description: "", quantity: "1", unit: "job", unitPrice: "", notes: "" },
    ]);

    assert.deepEqual(items, [
      {
        description: "Quote line item",
        notes: null,
        quantity: 1,
        total: null,
        unit: "job",
        unitPrice: null,
      },
    ]);
  });
});

describe("quote template catalog", () => {
  it("starts empty until custom templates exist", () => {
    assert.deepEqual(quoteTemplateCatalog(), []);
    assert.equal(getQuoteTemplate("anything"), null);
  });

  it("returns custom templates", () => {
    const customTemplate = {
      description: "Custom structure",
      key: "custom_template",
      label: "Custom Template",
      lineItems: [quoteLineItem("Custom line", 1, "job")],
      notes: "Custom notes",
    };
    const catalog = quoteTemplateCatalog([customTemplate]);

    assert.deepEqual(catalog, [customTemplate]);
    assert.equal(
      getQuoteTemplate("custom_template", [customTemplate])?.label,
      "Custom Template",
    );
  });
});

describe("draftTitleFromTemplate", () => {
  it("uses the template name plus minute-level timestamp", () => {
    assert.equal(
      draftTitleFromTemplate(
        { label: "Premium Quote" },
        new Date(2026, 4, 23, 14, 5, 30),
      ),
      "Premium Quote - May 23 14:05",
    );
  });
});
