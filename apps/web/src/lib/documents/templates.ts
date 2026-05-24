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
  defaultTitle?: string;
  notes: string;
  lineItems: QuoteLineItem[];
};

export type QuoteLineItemRowInput = {
  description: unknown;
  notes?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
};

export const QUOTE_TEMPLATES = [] as const satisfies QuoteTemplate[];

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

export function quoteTemplateCatalog(
  customTemplates: readonly QuoteTemplate[] = [],
): QuoteTemplate[] {
  return [...QUOTE_TEMPLATES, ...customTemplates];
}

export function getQuoteTemplate(
  key: string | null | undefined,
  customTemplates: readonly QuoteTemplate[] = [],
) {
  const catalog = quoteTemplateCatalog(customTemplates);

  return (
    catalog.find((template) => template.key === key) ??
    catalog[0] ??
    null
  );
}

export function quoteTemplateOptions(
  templates: readonly QuoteTemplate[] = QUOTE_TEMPLATES,
) {
  return templates.map((template) => ({
    description: template.description,
    key: template.key,
    label: template.label,
  }));
}

export function draftTitleFromTemplate(
  template: Pick<QuoteTemplate, "label">,
  date = new Date(),
) {
  const timestamp = new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
  })
    .format(date)
    .replace(",", "");

  return `${template.label} - ${timestamp}`;
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

export function parseQuoteLineItemRows(rows: QuoteLineItemRowInput[]) {
  return rows
    .map((row) =>
      quoteLineItem(
        textValue(row.description) ?? "",
        parseNullableNumber(row.quantity),
        textValue(row.unit),
        parseNullableNumber(row.unitPrice),
        textValue(row.notes),
      ),
    )
    .filter(
      (item) =>
        item.description ||
        item.quantity !== null ||
        item.unit ||
        item.unitPrice !== null ||
        item.notes,
    )
    .map((item) =>
      item.description
        ? item
        : {
            ...item,
            description: "Quote line item",
          },
    );
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
