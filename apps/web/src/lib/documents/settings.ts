import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeQuoteLineItems,
  type QuoteLineItem,
} from "./templates";

export const DOCUMENT_TEMPLATE_POLICY_TYPE = "document_templates";

export const DOCUMENT_ACCENT_THEMES = [
  "graphite",
  "cyan",
  "pink",
  "blue",
  "green",
] as const;
export const DOCUMENT_CURRENCIES = ["AUD", "USD", "NZD", "GBP", "EUR"] as const;

export type DocumentAccentTheme = (typeof DOCUMENT_ACCENT_THEMES)[number];
export type DocumentCurrency = (typeof DOCUMENT_CURRENCIES)[number];

export type DocumentTemplateDesignSettings = {
  accentTheme: DocumentAccentTheme;
  currency: DocumentCurrency;
  footerText: string;
  paymentTerms: string;
  quoteStyleDirection: string;
  showPreparedBy: boolean;
  validityDays: number;
};

export type DocumentTemplateReferenceFile = {
  name: string;
  size: number;
  type: string;
};

export type CustomDocumentTemplate = {
  createdAt: string;
  defaultTitle?: string;
  description: string;
  key: string;
  label: string;
  lineItems: QuoteLineItem[];
  notes: string;
  referenceFiles: DocumentTemplateReferenceFile[];
  revisionRequest: string | null;
  settings: DocumentTemplateDesignSettings;
  updatedAt: string;
};

export type DocumentTemplateSettings = DocumentTemplateDesignSettings & {
  customTemplates: CustomDocumentTemplate[];
};

export const DEFAULT_DOCUMENT_TEMPLATE_DESIGN_SETTINGS: DocumentTemplateDesignSettings = {
  accentTheme: "graphite",
  currency: "AUD",
  footerText:
    "Thank you for the opportunity. Please review the scope, inclusions, exclusions, and pricing before approving any work.",
  paymentTerms:
    "Payment terms, deposit requirements, and final pricing must be confirmed before this quote is sent to a customer.",
  quoteStyleDirection:
    "Clean, professional, service-business quote. Keep it practical, trustworthy, and easy for a customer to scan on mobile or PDF.",
  showPreparedBy: true,
  validityDays: 14,
};

export const DEFAULT_DOCUMENT_TEMPLATE_SETTINGS: DocumentTemplateSettings = {
  ...DEFAULT_DOCUMENT_TEMPLATE_DESIGN_SETTINGS,
  customTemplates: [],
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function boundedText(value: unknown, fallback: string, maxLength: number) {
  const text = textValue(value);

  return text ? text.slice(0, maxLength) : fallback;
}

function nullableBoundedText(value: unknown, maxLength: number) {
  const text = textValue(value);

  return text ? text.slice(0, maxLength) : null;
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeAccentTheme(value: unknown): DocumentAccentTheme {
  return DOCUMENT_ACCENT_THEMES.includes(value as DocumentAccentTheme)
    ? (value as DocumentAccentTheme)
    : DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.accentTheme;
}

function normalizeCurrency(value: unknown): DocumentCurrency {
  return DOCUMENT_CURRENCIES.includes(value as DocumentCurrency)
    ? (value as DocumentCurrency)
    : DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.currency;
}

export function normalizeDocumentTemplateDesignSettings(
  value: unknown,
): DocumentTemplateDesignSettings {
  const settings = objectRecord(value);
  const validityDays = numberValue(settings.validityDays);

  return {
    accentTheme: normalizeAccentTheme(settings.accentTheme),
    currency: normalizeCurrency(settings.currency),
    footerText: boundedText(
      settings.footerText,
      DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.footerText,
      500,
    ),
    paymentTerms: boundedText(
      settings.paymentTerms,
      DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.paymentTerms,
      500,
    ),
    quoteStyleDirection: boundedText(
      settings.quoteStyleDirection,
      DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.quoteStyleDirection,
      800,
    ),
    showPreparedBy: booleanValue(
      settings.showPreparedBy,
      DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.showPreparedBy,
    ),
    validityDays:
      validityDays === null
        ? DEFAULT_DOCUMENT_TEMPLATE_SETTINGS.validityDays
        : Math.max(1, Math.min(90, Math.round(validityDays))),
  };
}

function normalizeReferenceFiles(value: unknown) {
  return jsonArray(value)
    .map((item) => {
      const file = objectRecord(item);
      const size = numberValue(file.size);

      return {
        name: boundedText(file.name, "", 180),
        size: size === null ? 0 : Math.max(0, Math.round(size)),
        type: boundedText(file.type, "application/octet-stream", 120),
      };
    })
    .filter((file) => file.name)
    .slice(0, 8);
}

export function normalizeCustomDocumentTemplates(
  value: unknown,
): CustomDocumentTemplate[] {
  return jsonArray(value)
    .map((item) => {
      const template = objectRecord(item);
      const key = boundedText(template.key, "", 120);
      const label = boundedText(template.label, "", 120);

      if (!key || !label) {
        return null;
      }

      const lineItems = normalizeQuoteLineItems(jsonArray(template.lineItems));

      return {
        createdAt: boundedText(
          template.createdAt,
          new Date(0).toISOString(),
          40,
        ),
        ...(textValue(template.defaultTitle)
          ? {
              defaultTitle: boundedText(
                template.defaultTitle,
                `${label} Draft`,
                140,
              ),
            }
          : {}),
        description: boundedText(
          template.description,
          "Custom quote template.",
          220,
        ),
        key,
        label,
        lineItems,
        notes:
          typeof template.notes === "string"
            ? template.notes.slice(0, 900)
            : "",
        referenceFiles: normalizeReferenceFiles(template.referenceFiles),
        revisionRequest: nullableBoundedText(template.revisionRequest, 1000),
        settings: normalizeDocumentTemplateDesignSettings(template.settings),
        updatedAt: boundedText(
          template.updatedAt,
          new Date(0).toISOString(),
          40,
        ),
      };
    })
    .filter((template): template is CustomDocumentTemplate => Boolean(template))
    .slice(0, 50);
}

export function normalizeDocumentTemplateSettings(
  value: unknown,
): DocumentTemplateSettings {
  const settings = objectRecord(value);

  return {
    ...normalizeDocumentTemplateDesignSettings(settings),
    customTemplates: normalizeCustomDocumentTemplates(settings.customTemplates),
  };
}

export function documentTemplateDesignSettingsForQuote(
  metadata: unknown,
  fallback: DocumentTemplateSettings,
) {
  const quoteMetadata = objectRecord(metadata);
  const snapshot = quoteMetadata.documentTemplateSettings;

  return normalizeDocumentTemplateDesignSettings(snapshot ?? fallback);
}

export async function getDocumentTemplateSettings(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_policies")
    .select("settings")
    .eq("workspace_id", workspaceId)
    .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load document template settings: ${error.message}`,
    );
  }

  return normalizeDocumentTemplateSettings(data?.settings);
}
