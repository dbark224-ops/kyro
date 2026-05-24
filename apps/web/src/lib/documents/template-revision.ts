import {
  DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
  normalizeDocumentTemplateDesignSettings,
} from "./settings";
import { normalizeQuoteLineItems } from "./templates";
import {
  openAiProviderUsageId,
  openAiUsageFromResponse,
} from "../usage/openai";

export type DocumentTemplateRevisionPayload = {
  description: string;
  label: string;
  lineItems: Array<{
    description: string;
    notes: string | null;
    quantity: number | null;
    unit: string | null;
    unitPrice: number | null;
  }>;
  notes: string;
  revisionRequest: string | null;
  settings: {
    accentTheme: "graphite" | "cyan" | "pink" | "blue" | "green";
    currency: "AUD" | "USD" | "NZD" | "GBP" | "EUR";
    footerText: string;
    paymentTerms: string;
    quoteStyleDirection: string;
    showPreparedBy: boolean;
    validityDays: number;
  };
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function documentTemplateModel() {
  return (
    envValue("OPENAI_DOCUMENT_TEMPLATE_MODEL") ||
    envValue("OPENAI_LOW_COST_MODEL") ||
    "gpt-4.1-mini"
  );
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);
  const message = textValue(error.message);

  return message ?? "OpenAI template revision failed.";
}

function responseOutputText(payload: unknown) {
  const root = objectRecord(payload);
  const direct = textValue(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];

  for (const item of output) {
    const content = objectRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const text = textValue(objectRecord(part).text);

      if (text) {
        return text;
      }
    }
  }

  return null;
}

function responseUsage(payload: unknown, prompt: string, text: string) {
  return {
    ...openAiUsageFromResponse(payload, { prompt, text }),
    providerUsageId: openAiProviderUsageId(payload) ?? null,
  };
}

export function documentTemplateRevisionPayload(
  value: unknown,
): DocumentTemplateRevisionPayload {
  const template = objectRecord(value);
  const settings = normalizeDocumentTemplateDesignSettings(template.settings);

  return {
    description: textValue(template.description) ?? "",
    label: textValue(template.label) ?? "",
    lineItems: normalizeQuoteLineItems(
      Array.isArray(template.lineItems) ? template.lineItems : [],
    ).map((item) => ({
      description: item.description,
      notes: item.notes,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
    })),
    notes: typeof template.notes === "string" ? template.notes : "",
    revisionRequest: textValue(template.revisionRequest),
    settings,
  };
}

function buildTemplateRevisionPrompt(input: {
  instruction: string;
  template: DocumentTemplateRevisionPayload;
  workspaceName: string;
}) {
  return JSON.stringify(
    {
      currentTemplate: input.template,
      instruction: input.instruction,
      outputContract: {
        description: "string",
        label: "string",
        lineItems: [
          {
            description: "string",
            notes: "string | null",
            quantity: "number | null",
            unit: "string | null",
            unitPrice: "number | null",
          },
        ],
        notes: "string",
        revisionRequest: "string | null",
        settings: {
          accentTheme: "graphite | cyan | pink | blue | green",
          currency: "AUD | USD | NZD | GBP | EUR",
          footerText: "string",
          paymentTerms: "string",
          quoteStyleDirection: "string",
          showPreparedBy: "boolean",
          validityDays: "integer 1-90",
        },
      },
      rules: [
        "Return JSON only.",
        "Revise the reusable quote template structure and wording according to the instruction.",
        "Keep quote and invoice-style documents deterministic and structured, not image-generated.",
        "Do not invent exact prices unless the user explicitly gave prices. Use null unitPrice when pricing is not specified.",
        "Keep line items reusable placeholders, not a one-off customer quote.",
        "Prefer concise customer-facing wording.",
        "If the user asks for visual style, update quoteStyleDirection, accentTheme, footerText, or paymentTerms rather than moving arbitrary layout boxes.",
        "Preserve useful existing line items unless the user asks to remove or replace them.",
        `Workspace name: ${input.workspaceName}`,
      ],
      task: "Update this Kyro reusable quote template for review before saving.",
    },
    null,
    2,
  );
}

export function parseDocumentTemplateRevision(
  text: string,
): DocumentTemplateRevisionPayload {
  const parsed = objectRecord(JSON.parse(text));
  const settings = normalizeDocumentTemplateDesignSettings(parsed.settings);
  const lineItems = normalizeQuoteLineItems(
    Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
  );

  return {
    description: (textValue(parsed.description) ?? "Custom quote template.").slice(0, 220),
    label: (textValue(parsed.label) ?? "Custom quote template").slice(0, 120),
    lineItems: lineItems.map((item) => ({
      description: item.description,
      notes: item.notes,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
    })),
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 900) : "",
    revisionRequest: textValue(parsed.revisionRequest),
    settings: {
      ...settings,
      footerText: settings.footerText.slice(0, 500),
      paymentTerms: settings.paymentTerms.slice(0, 500),
      quoteStyleDirection: settings.quoteStyleDirection.slice(0, 800),
    },
  };
}

export async function runDocumentTemplateRevision(input: {
  instruction: string;
  template: DocumentTemplateRevisionPayload;
  workspaceName: string;
}) {
  const apiKey = openAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for template edits.");
  }

  const model = documentTemplateModel();
  const prompt = buildTemplateRevisionPrompt(input);
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: prompt,
      instructions:
        "You revise deterministic quote document templates for Kyro, a trades/service CRM. Return compact JSON only.",
      max_output_tokens: 1800,
      model,
      text: {
        format: {
          name: "kyro_document_template_revision",
          schema: {
            additionalProperties: false,
            properties: {
              description: { type: "string" },
              label: { type: "string" },
              lineItems: {
                items: {
                  additionalProperties: false,
                  properties: {
                    description: { type: "string" },
                    notes: { type: ["string", "null"] },
                    quantity: { type: ["number", "null"] },
                    unit: { type: ["string", "null"] },
                    unitPrice: { type: ["number", "null"] },
                  },
                  required: ["description", "quantity", "unit", "unitPrice", "notes"],
                  type: "object",
                },
                type: "array",
              },
              notes: { type: "string" },
              revisionRequest: { type: ["string", "null"] },
              settings: {
                additionalProperties: false,
                properties: {
                  accentTheme: {
                    enum: ["graphite", "cyan", "pink", "blue", "green"],
                    type: "string",
                  },
                  currency: {
                    enum: ["AUD", "USD", "NZD", "GBP", "EUR"],
                    type: "string",
                  },
                  footerText: { type: "string" },
                  paymentTerms: { type: "string" },
                  quoteStyleDirection: { type: "string" },
                  showPreparedBy: { type: "boolean" },
                  validityDays: { maximum: 90, minimum: 1, type: "integer" },
                },
                required: [
                  "accentTheme",
                  "currency",
                  "footerText",
                  "paymentTerms",
                  "quoteStyleDirection",
                  "showPreparedBy",
                  "validityDays",
                ],
                type: "object",
              },
            },
            required: [
              "label",
              "description",
              "lineItems",
              "notes",
              "revisionRequest",
              "settings",
            ],
            type: "object",
          },
          strict: true,
          type: "json_schema",
        },
      },
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(providerErrorMessage(payload));
  }

  const outputText = responseOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI returned an empty template revision.");
  }

  return {
    data: parseDocumentTemplateRevision(outputText),
    model,
    usage: responseUsage(payload, prompt, outputText),
  };
}

export function blankDocumentTemplateRevisionPayload(input: {
  label?: string | null;
  settings?: unknown;
}): DocumentTemplateRevisionPayload {
  return documentTemplateRevisionPayload({
    description: "",
    label: input.label ?? "Custom quote template",
    lineItems: [],
    notes: "",
    revisionRequest: null,
    settings: input.settings ?? DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
  });
}
