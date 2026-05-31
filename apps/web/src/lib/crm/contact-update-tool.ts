import type { SupabaseClient } from "@supabase/supabase-js";
import {
  autocompleteAddresses,
  getAddressPlaceDetails,
  hasGoogleAddressLookupConfig,
} from "../addresses/google";
import type { AddressColumnUpdates, StructuredAddress } from "../addresses/types";
import { insertAuditLog } from "../engine/event-action-audit";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import { normalizeContactType } from "./contact-types";
import {
  normalizeCompanyName,
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "./identity";

type ContactUpdateArgs = Record<string, unknown>;

type ContactPreview = {
  address: string | null;
  company: string | null;
  contactType: string | null;
  email: string | null;
  id: string;
  name: string | null;
  phone: string | null;
};

type ContactUpdateResult =
  | {
      answer: string;
      changedFields: string[];
      contact: ContactPreview;
      contacts: ContactPreview[];
      ok: true;
    }
  | {
      answer: string;
      contacts?: ContactPreview[];
      ok: false;
      reason: string;
    };

const CONTACT_SELECT =
  "id,name,email,phone,company,contact_type,address,notes,normalized_email,normalized_phone,normalized_company,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableText(value: string | null) {
  return value ? value : null;
}

function fieldValue(args: ContactUpdateArgs, keys: string[]) {
  const nested = objectRecord(args.updates ?? args.fields ?? args.contact);

  for (const key of keys) {
    const direct = textValue(args[key]);

    if (direct) {
      return direct;
    }

    const nestedValue = textValue(nested[key]);

    if (nestedValue) {
      return nestedValue;
    }
  }

  return null;
}

function contactPreview(row: Record<string, unknown>): ContactPreview {
  return {
    address: textValue(row.address),
    company: textValue(row.company),
    contactType: textValue(row.contact_type),
    email: textValue(row.email),
    id: String(row.id),
    name: textValue(row.name),
    phone: textValue(row.phone),
  };
}

function ilikePattern(value: string) {
  return `%${value.replace(/[,%]/g, " ").replace(/\s+/g, " ").trim()}%`;
}

function changedFieldLabel(field: string) {
  const labels: Record<string, string> = {
    address: "address",
    company: "company",
    contact_type: "contact type",
    email: "email",
    name: "name",
    notes: "notes",
    phone: "phone number",
  };

  return labels[field] ?? field.replace(/_/g, " ");
}

function updateSummary(changedFields: string[]) {
  const labels = changedFields.map(changedFieldLabel);

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function manualAddressFields(address: string | null): AddressColumnUpdates {
  if (!address) {
    return {
      address: null,
      address_administrative_area: null,
      address_country_code: null,
      address_latitude: null,
      address_line1: null,
      address_line2: null,
      address_locality: null,
      address_longitude: null,
      address_place_id: null,
      address_postal_code: null,
      address_source: "assistant",
      address_structured: {},
      address_validated_at: null,
      address_validation_status: "unverified",
    };
  }

  return {
    address,
    address_administrative_area: null,
    address_country_code: null,
    address_latitude: null,
    address_line1: address,
    address_line2: null,
    address_locality: null,
    address_longitude: null,
    address_place_id: null,
    address_postal_code: null,
    address_source: "assistant",
    address_structured: {
      administrativeArea: null,
      countryCode: null,
      formattedAddress: address,
      latitude: null,
      line1: address,
      line2: null,
      locality: null,
      longitude: null,
      placeId: null,
      postalCode: null,
      provider: "assistant",
      source: "assistant",
      validationStatus: "unverified",
    },
    address_validated_at: null,
    address_validation_status: "unverified",
  };
}

function verifiedAddressFields(address: StructuredAddress): AddressColumnUpdates {
  return {
    address: address.formattedAddress ?? address.line1,
    address_administrative_area: address.administrativeArea,
    address_country_code: address.countryCode,
    address_latitude:
      address.latitude === null ? null : String(address.latitude),
    address_line1: address.line1,
    address_line2: address.line2,
    address_locality: address.locality,
    address_longitude:
      address.longitude === null ? null : String(address.longitude),
    address_place_id: address.placeId,
    address_postal_code: address.postalCode,
    address_source: address.source,
    address_structured: address,
    address_validated_at:
      address.validationStatus === "validated" ? new Date().toISOString() : null,
    address_validation_status: address.validationStatus,
  };
}

function addressLikelyNeedsLocality(address: string) {
  const normalized = address.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return false;
  }

  const hasStreetNumber = /^\d+[a-zA-Z]?\s+\S+/.test(normalized);
  const hasSeparator = /[,;]/.test(normalized);
  const wordCount = normalized.split(" ").filter(Boolean).length;

  return hasStreetNumber && !hasSeparator && wordCount <= 4;
}

async function resolveAddressForAssistantUpdate({
  address,
  region,
}: {
  address: string;
  region: PhoneRegion | string | null;
}): Promise<
  | {
      answer?: string;
      ok: false;
      reason: string;
    }
  | {
      formattedAddress: string | null;
      ok: true;
      updates: AddressColumnUpdates;
      verificationNote?: string;
    }
> {
  if (addressLikelyNeedsLocality(address)) {
    return {
      answer:
        "I need the suburb or city before I update that address safely. Please give me the street address plus suburb or city.",
      ok: false,
      reason: "address_needs_locality",
    };
  }

  if (!hasGoogleAddressLookupConfig()) {
    return {
      formattedAddress: address,
      ok: true,
      updates: manualAddressFields(address),
      verificationNote: "Google address verification is not configured.",
    };
  }

  try {
    const suggestions = await autocompleteAddresses({
      input: address,
      region,
    });
    const [bestSuggestion] = suggestions;

    if (!bestSuggestion) {
      return {
        formattedAddress: address,
        ok: true,
        updates: manualAddressFields(address),
        verificationNote: "Google could not find a matching address.",
      };
    }

    const structuredAddress = await getAddressPlaceDetails({
      placeId: bestSuggestion.placeId,
      validate: true,
    });
    const updates = verifiedAddressFields(structuredAddress);

    return {
      formattedAddress: updates.address,
      ok: true,
      updates,
      verificationNote:
        structuredAddress.validationStatus === "validated"
          ? undefined
          : "Google found the address, but it may need review.",
    };
  } catch (error) {
    return {
      formattedAddress: address,
      ok: true,
      updates: manualAddressFields(address),
      verificationNote:
        error instanceof Error
          ? `Google address verification failed: ${error.message}`
          : "Google address verification failed.",
    };
  }
}

function appendNote(existing: string | null, note: string) {
  const timestamp = new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
  const entry = `[Kyro note ${timestamp}] ${note}`;

  return existing ? `${existing.trim()}\n\n${entry}` : entry;
}

async function lookupContacts({
  args,
  supabase,
  workspaceId,
}: {
  args: ContactUpdateArgs;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const contactId =
    fieldValue(args, ["contactId", "contact_id", "id"]) ??
    textValue(objectRecord(args.target).id);

  if (contactId) {
    const { data, error } = await supabase
      .from("contacts")
      .select(CONTACT_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("id", contactId)
      .is("merged_into_contact_id", null)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to load contact for update: ${error.message}`);
    }

    return data ? [data as Record<string, unknown>] : [];
  }

  const query = fieldValue(args, [
    "contactQuery",
    "contact_query",
    "targetContact",
    "target_contact",
    "contactName",
    "contact_name",
    "query",
  ]);

  if (!query) {
    return [];
  }

  const exactEmail = normalizeContactEmail(query);
  const exactPhone = normalizeContactPhoneForRegion(query);

  if (exactPhone && /\d/.test(query)) {
    const { data, error } = await supabase
      .from("contacts")
      .select(CONTACT_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("normalized_phone", exactPhone)
      .is("merged_into_contact_id", null)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (error) {
      throw new Error(`Unable to find contact by phone: ${error.message}`);
    }

    if ((data ?? []).length > 0) {
      return data as Array<Record<string, unknown>>;
    }
  }

  if (exactEmail && query.includes("@")) {
    const { data, error } = await supabase
      .from("contacts")
      .select(CONTACT_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("normalized_email", exactEmail)
      .is("merged_into_contact_id", null)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (error) {
      throw new Error(`Unable to find contact by email: ${error.message}`);
    }

    if ((data ?? []).length > 0) {
      return data as Array<Record<string, unknown>>;
    }
  }

  const pattern = ilikePattern(query);
  const { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_SELECT)
    .eq("workspace_id", workspaceId)
    .is("merged_into_contact_id", null)
    .or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(6);

  if (error) {
    throw new Error(`Unable to search contacts for update: ${error.message}`);
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function updateContactFromAssistantTool({
  args,
  source = "assistant_tool",
  supabase,
  userId,
  workspaceId,
}: {
  args: ContactUpdateArgs;
  source?: string;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}): Promise<ContactUpdateResult> {
  const name = fieldValue(args, ["newName", "new_name"]);
  const email = fieldValue(args, ["email", "newEmail", "new_email"]);
  const phone = fieldValue(args, [
    "phone",
    "phoneNumber",
    "phone_number",
    "newPhone",
    "new_phone",
  ]);
  const company = fieldValue(args, ["company", "newCompany", "new_company"]);
  const address = fieldValue(args, ["address", "newAddress", "new_address"]);
  const notes = fieldValue(args, ["notes", "note"]);
  const rawContactType = fieldValue(args, [
    "contactType",
    "contact_type",
    "type",
  ]);
  const notesMode =
    fieldValue(args, ["notesMode", "notes_mode", "noteMode", "note_mode"]) ===
    "replace"
      ? "replace"
      : "append";

  if (!name && !email && !phone && !company && !address && !notes && !rawContactType) {
    return {
      answer:
        "I need at least one contact field to update: name, email, phone, address, company, contact type, or notes.",
      ok: false,
      reason: "no_update_fields",
    };
  }

  const matches = await lookupContacts({ args, supabase, workspaceId });

  if (matches.length === 0) {
    return {
      answer:
        "I could not safely identify the contact to update. Please say the contact name again, or ask me to show the contact first.",
      ok: false,
      reason: "contact_not_found",
    };
  }

  if (matches.length > 1) {
    return {
      answer:
        "I found multiple matching contacts. Pick the right contact before I change anything.",
      contacts: matches.map(contactPreview),
      ok: false,
      reason: "ambiguous_contact",
    };
  }

  const before = matches[0];
  const generalSettings = await getWorkspaceGeneralSettings(supabase, workspaceId);
  const update: Record<string, unknown> = {};
  const changedFields: string[] = [];
  let verifiedAddress: string | null = null;
  let addressVerificationNote: string | undefined;

  if (name) {
    update.name = nullableText(name);
    changedFields.push("name");
  }

  if (email) {
    const normalizedEmail = normalizeContactEmail(email);

    update.email = normalizedEmail;
    update.normalized_email = normalizedEmail;
    changedFields.push("email");
  }

  if (phone) {
    update.phone = nullableText(phone);
    update.normalized_phone = normalizeContactPhoneForRegion(
      phone,
      generalSettings.defaultPhoneRegion,
    );
    changedFields.push("phone");
  }

  if (company) {
    update.company = nullableText(company);
    update.normalized_company = normalizeCompanyName(company);
    changedFields.push("company");
  }

  if (address) {
    const addressResult = await resolveAddressForAssistantUpdate({
      address,
      region: generalSettings.defaultPhoneRegion,
    });

    if (!addressResult.ok) {
      return {
        answer:
          addressResult.answer ??
          "I need a bit more location detail before I update that address.",
        contacts: [contactPreview(before)],
        ok: false,
        reason: addressResult.reason,
      };
    }

    Object.assign(update, addressResult.updates);
    verifiedAddress = addressResult.formattedAddress;
    addressVerificationNote = addressResult.verificationNote;
    changedFields.push("address");
  }

  if (rawContactType) {
    update.contact_type = normalizeContactType(rawContactType);
    changedFields.push("contact_type");
  }

  if (notes) {
    const currentNotes = textValue(before.notes);

    update.notes =
      notesMode === "replace" ? nullableText(notes) : appendNote(currentNotes, notes);
    changedFields.push("notes");
  }

  const uniqueChangedFields = [...new Set(changedFields)];

  const { data: after, error } = await supabase
    .from("contacts")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", String(before.id))
    .select(CONTACT_SELECT)
    .single();

  if (error || !after) {
    throw new Error(
      `Unable to update contact profile: ${error?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(supabase, {
    action: "contact.assistant_updated",
    actorId: userId,
    actorType: "ai",
    after: after as Record<string, unknown>,
    before,
    entityId: String(before.id),
    entityType: "contact",
    metadata: {
      addressVerificationNote,
      changedFields: uniqueChangedFields,
      notesMode,
      source,
    },
    workspaceId,
  });

  const contact = contactPreview(after as Record<string, unknown>);
  const label = contact.name ?? contact.company ?? "that contact";
  const answer =
    verifiedAddress && uniqueChangedFields.length === 1
      ? `Updated ${label}'s address to ${verifiedAddress}.${addressVerificationNote ? ` ${addressVerificationNote}` : ""}`
      : `Updated ${label}'s ${updateSummary(uniqueChangedFields)}.${addressVerificationNote ? ` ${addressVerificationNote}` : ""}`;

  return {
    answer,
    changedFields: uniqueChangedFields,
    contact,
    contacts: [contact],
    ok: true,
  };
}
