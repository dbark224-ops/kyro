import type { SupabaseClient } from "@supabase/supabase-js";
import type { AddressColumnUpdates } from "../addresses/types";
import {
  addressLikelyNeedsLocality,
  verifyAddressText,
} from "../addresses/verify";
import { insertAuditLog } from "../engine/event-action-audit";
import { formatWorkspaceDateTimeWithYear } from "../time/format";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import { normalizeContactType } from "./contact-types";
import {
  normalizeCompanyName,
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "./identity";
import { objectRecord, textValue } from "@kyro/core";

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
  "id,name,email,phone,secondary_phone,secondary_phone_name,secondary_phone_label,company,contact_type,address,notes,normalized_email,normalized_phone,normalized_company,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at";

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
    secondary_phone: "other number",
    secondary_phone_label: "who that number belongs to",
    secondary_phone_name: "name on the other number",
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
  // The assistant is the one caller with a person on the other end, so it can
  // ask for the missing suburb instead of storing a street name that matches
  // forty towns. Triage and the voice agent have no such option and store the
  // text unverified -- see verifyAddressText.
  if (addressLikelyNeedsLocality(address)) {
    return {
      answer:
        "I need the suburb or city before I update that address safely. Please give me the street address plus suburb or city.",
      ok: false,
      reason: "address_needs_locality",
    };
  }

  const verification = await verifyAddressText({
    address,
    region: typeof region === "string" ? region : null,
    source: "assistant",
  });

  return {
    formattedAddress: verification.formattedAddress,
    ok: true,
    updates: verification.updates,
    verificationNote: verification.verificationNote,
  };
}

function appendNote(
  existing: string | null,
  note: string,
  timeZone?: string | null,
) {
  // This stamp is persisted into the contact's notes, so a wrong timezone here
  // is wrong permanently -- it is not re-rendered from a stored instant.
  const timestamp = formatWorkspaceDateTimeWithYear({
    timeZone,
    value: new Date(),
  });
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
    .or(
      `name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
    )
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
  // Customers hand over someone else's number constantly -- "my partner Sam is
  // home today, they're on ...". Without this it is read once and lost, or
  // worse, overwrites the customer's own number.
  const secondaryPhone = fieldValue(args, [
    "secondaryPhone",
    "secondary_phone",
    "otherPhone",
    "other_phone",
    "alternatePhone",
    "alternate_phone",
  ]);
  const secondaryPhoneName = fieldValue(args, [
    "secondaryPhoneName",
    "secondary_phone_name",
    "otherPhoneName",
    "other_phone_name",
  ]);
  const secondaryPhoneLabel = fieldValue(args, [
    "secondaryPhoneLabel",
    "secondary_phone_label",
    "secondaryPhoneRole",
    "secondary_phone_role",
    "otherPhoneLabel",
    "other_phone_label",
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

  if (
    !name &&
    !email &&
    !phone &&
    !secondaryPhone &&
    !secondaryPhoneName &&
    !secondaryPhoneLabel &&
    !company &&
    !address &&
    !notes &&
    !rawContactType
  ) {
    return {
      answer:
        "I need at least one contact field to update: name, email, phone, another number, address, company, contact type, or notes.",
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
  const generalSettings = await getWorkspaceGeneralSettings(
    supabase,
    workspaceId,
  );
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

  if (secondaryPhone) {
    update.secondary_phone = nullableText(secondaryPhone);
    // Not indexed and never matched against an inbound caller: the partner's
    // number is not the contact's identity, and treating it as one would merge
    // two people's profiles.
    update.normalized_secondary_phone = normalizeContactPhoneForRegion(
      secondaryPhone,
      generalSettings.defaultPhoneRegion,
    );
    changedFields.push("secondary_phone");
  }

  if (secondaryPhoneName) {
    update.secondary_phone_name = nullableText(secondaryPhoneName);
    changedFields.push("secondary_phone_name");
  }

  if (secondaryPhoneLabel) {
    update.secondary_phone_label = nullableText(secondaryPhoneLabel);
    changedFields.push("secondary_phone_label");
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

    if (notesMode === "replace") {
      update.notes = nullableText(notes);
    } else {
      const { timeZone } = await getWorkspaceGeneralSettings(
        supabase,
        workspaceId,
      );

      update.notes = appendNote(currentNotes, notes, timeZone);
    }

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
