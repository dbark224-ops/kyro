export const CONTACT_TYPES = [
  "client",
  "supplier",
  "contractor",
  "builder",
  "property_manager",
  "other"
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_OPTIONS = [
  { label: "Client", value: "client" },
  { label: "Supplier", value: "supplier" },
  { label: "Contractor", value: "contractor" },
  { label: "Builder / commercial", value: "builder" },
  { label: "Property manager", value: "property_manager" },
  { label: "Other", value: "other" }
] satisfies Array<{ label: string; value: ContactType }>;

function nullableText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeContactType(value?: string | null): ContactType {
  const normalized = nullableText(value)?.toLowerCase().replace(/\s+/g, "_");

  return CONTACT_TYPES.includes(normalized as ContactType) ? (normalized as ContactType) : "client";
}

export function formatContactType(value?: string | null) {
  const normalized = normalizeContactType(value);

  return CONTACT_TYPE_OPTIONS.find((option) => option.value === normalized)?.label ?? "Client";
}
