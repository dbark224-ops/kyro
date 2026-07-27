/**
 * What a contact is to the business.
 *
 * This used to be half the answer. A separate `lifecycle_stage` column tracked
 * lead vs client alongside it, and the two disagreed on every contact in
 * production -- all 36 were typed "client" while staged "lead", so the CRM
 * counted the same person under both filters and neither number meant
 * anything. Lead and client are not a different axis from supplier and
 * contractor; they are the same question asked twice. One field now.
 *
 * "lead" comes first because that is what an unrecognised inbound contact is.
 * Kyro promotes them to "client" on its own once there is real evidence -- an
 * approved quote, a booked job, a paid invoice -- which is what the lifecycle
 * review engine already detected and now writes here.
 */
export const CONTACT_TYPES = [
  "lead",
  "client",
  "supplier",
  "contractor",
  "staff",
  "property_manager",
  "other",
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_OPTIONS = [
  { label: "Lead", value: "lead" },
  { label: "Client", value: "client" },
  { label: "Supplier", value: "supplier" },
  { label: "Contractor", value: "contractor" },
  { label: "Staff", value: "staff" },
  { label: "Property manager", value: "property_manager" },
  { label: "Other", value: "other" },
] satisfies Array<{ label: string; value: ContactType }>;

/**
 * Types that were removed, and where their rows land.
 *
 * Production had none of these, but a stored value outliving the list it came
 * from is exactly how a contact ends up silently relabelled as something it is
 * not. Mapping them explicitly beats falling through to the default.
 */
const RETIRED_CONTACT_TYPES: Record<string, ContactType> = {
  builder: "other",
  builder_commercial: "other",
  commercial: "other",
  customer: "client",
};

function nullableText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeContactType(value?: string | null): ContactType {
  const normalized = nullableText(value)?.toLowerCase().replace(/\s+/g, "_");

  if (!normalized) {
    // An unknown contact is a lead, not a client. Claiming someone has done
    // business with you when nothing says so is the worse of the two guesses.
    return "lead";
  }

  if (CONTACT_TYPES.includes(normalized as ContactType)) {
    return normalized as ContactType;
  }

  return RETIRED_CONTACT_TYPES[normalized] ?? "lead";
}

export function formatContactType(value?: string | null) {
  const normalized = normalizeContactType(value);

  return (
    CONTACT_TYPE_OPTIONS.find((option) => option.value === normalized)?.label ??
    "Lead"
  );
}

/**
 * Whether this type means someone the business sells to, as opposed to a
 * supplier, subcontractor or staff member. The lead/client split used to carry
 * this and several callers still need the distinction.
 */
export function isCustomerContactType(value?: string | null) {
  const normalized = normalizeContactType(value);

  return normalized === "lead" || normalized === "client";
}
