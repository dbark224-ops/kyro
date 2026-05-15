export type QuoteLineItem = {
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
  notes: string | null;
};

export type QuoteTemplate = {
  key: string;
  label: string;
  description: string;
  defaultTitle: string;
  notes: string;
  lineItems: QuoteLineItem[];
};

export const QUOTE_TEMPLATES = [
  {
    key: "general_service_quote",
    label: "General Service Quote",
    description: "A clean starter quote for a trade job that still needs pricing.",
    defaultTitle: "General Service Quote Draft",
    notes:
      "Draft only. Confirm scope, pricing, materials, exclusions, and timing before sending.",
    lineItems: [
      quoteLineItem("Site assessment and scope confirmation", 1, "job"),
      quoteLineItem("Labour allowance", 1, "job"),
      quoteLineItem("Materials allowance", 1, "job"),
    ],
  },
  {
    key: "plumbing_repair",
    label: "Plumbing Repair",
    description: "Callout, diagnosis, labour, and parts placeholder lines.",
    defaultTitle: "Plumbing Repair Quote Draft",
    notes:
      "Draft only. Confirm the repair scope, access, parts, and any after-hours charge before sending.",
    lineItems: [
      quoteLineItem("Callout and diagnosis", 1, "visit"),
      quoteLineItem("Plumbing labour", 1, "job"),
      quoteLineItem("Parts and consumables", 1, "allowance"),
    ],
  },
  {
    key: "bathroom_renovation",
    label: "Bathroom Renovation",
    description: "Early-stage bathroom renovation quote structure.",
    defaultTitle: "Bathroom Renovation Quote Draft",
    notes:
      "Draft only. Confirm inclusions, fixtures, waterproofing, tiling, demolition, and exclusions before sending.",
    lineItems: [
      quoteLineItem("Bathroom renovation planning and site check", 1, "job"),
      quoteLineItem("Demolition and preparation allowance", 1, "job"),
      quoteLineItem("Plumbing rough-in and fit-off allowance", 1, "job"),
      quoteLineItem("Waterproofing and tiling allowance", 1, "job"),
      quoteLineItem("Fixtures and materials allowance", 1, "allowance"),
    ],
  },
] as const satisfies QuoteTemplate[];

export function quoteLineItem(
  description: string,
  quantity: number | null = 1,
  unit: string | null = "job",
  unitPrice: number | null = null,
  notes: string | null = null,
): QuoteLineItem {
  return {
    description,
    notes,
    quantity,
    total:
      quantity !== null && unitPrice !== null
        ? roundMoney(quantity * unitPrice)
        : null,
    unit,
    unitPrice,
  };
}

export function getQuoteTemplate(key: string | null | undefined) {
  return (
    QUOTE_TEMPLATES.find((template) => template.key === key) ??
    QUOTE_TEMPLATES[0]
  );
}

export function quoteTemplateOptions() {
  return QUOTE_TEMPLATES.map((template) => ({
    description: template.description,
    key: template.key,
    label: template.label,
  }));
}

export function parseQuoteLineItems(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [descriptionValue, quantityValue, unitValue, unitPriceValue, notesValue] =
        line.split("|").map((part) => part.trim());
      const quantity = parseNullableNumber(quantityValue);
      const unitPrice = parseNullableNumber(unitPriceValue);

      return quoteLineItem(
        descriptionValue || "Quote line item",
        quantity,
        unitValue || null,
        unitPrice,
        notesValue || null,
      );
    });
}

export function lineItemsToEditorText(items: unknown[]) {
  return normalizeQuoteLineItems(items)
    .map((item) =>
      [
        item.description,
        item.quantity ?? "",
        item.unit ?? "",
        item.unitPrice ?? "",
        item.notes ?? "",
      ].join(" | "),
    )
    .join("\n");
}

export function normalizeQuoteLineItems(items: unknown[]) {
  return items.map((item) => {
    const row =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    const quantity = parseNullableNumber(row.quantity);
    const unitPrice = parseNullableNumber(row.unitPrice ?? row.unit_price);

    return quoteLineItem(
      textValue(row.description) ?? "Quote line item",
      quantity,
      textValue(row.unit),
      unitPrice,
      textValue(row.notes),
    );
  });
}

function parseNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(String(value).replace(/[$,]/g, "").trim());

  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
