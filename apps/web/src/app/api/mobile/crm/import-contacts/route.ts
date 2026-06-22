import { normalizeContactType } from "../../../../../lib/crm/contact-types";
import { insertAuditLog } from "../../../../../lib/engine/event-action-audit";
import {
  MobileApiError,
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

type ImportContact = {
  address: string | null;
  company: string | null;
  email: string | null;
  firstName: string | null;
  id: string;
  lastName: string | null;
  name: string | null;
  phone: string | null;
};

type ExistingContact = {
  address: string | null;
  company: string | null;
  contact_type: string | null;
  email: string | null;
  id: string;
  name: string | null;
  phone: string | null;
  source: string | null;
  tags: unknown;
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeEmail(value: unknown) {
  return textValue(value)?.toLowerCase() ?? null;
}

function normalizePhone(value: unknown) {
  const digits = textValue(value)?.replace(/\D/g, "") ?? "";

  return digits.length >= 6 ? digits : null;
}

function normalizeImportContact(value: unknown): ImportContact | null {
  const contact = objectRecord(value);
  const email = normalizeEmail(contact.email);
  const phone = textValue(contact.phone);
  const company = textValue(contact.company);
  const firstName = textValue(contact.firstName);
  const lastName = textValue(contact.lastName);
  const name =
    textValue(contact.name) ??
    textValue([firstName, lastName].filter(Boolean).join(" "));
  const id =
    textValue(contact.id) ??
    [name, email, phone, company].filter(Boolean).join(":").toLowerCase();

  if (!name && !email && !phone && !company) {
    return null;
  }

  return {
    address: textValue(contact.address),
    company,
    email,
    firstName,
    id,
    lastName,
    name,
    phone,
  };
}

function dedupeImportContacts(contacts: ImportContact[]) {
  const seen = new Set<string>();

  return contacts.filter((contact) => {
    const key =
      contact.email ??
      normalizePhone(contact.phone) ??
      [contact.name, contact.company].filter(Boolean).join("|").toLowerCase() ??
      contact.id;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function contactImportTag(contact: ImportContact, userId: string, importedAt: string) {
  return {
    deviceContactId: contact.id,
    importedAt,
    kind: "mobile_contact_import",
    userId,
  };
}

function alreadyTagged(tags: unknown[], contact: ImportContact) {
  return tags.some((tag) => {
    const record = objectRecord(tag);

    return (
      textValue(record.kind) === "mobile_contact_import" &&
      textValue(record.deviceContactId) === contact.id
    );
  });
}

function buildExistingContactUpdate({
  contact,
  existing,
  importedAt,
  userId,
}: {
  contact: ImportContact;
  existing: ExistingContact;
  importedAt: string;
  userId: string;
}) {
  const beforeTags = jsonArray(existing.tags);
  const afterTags = alreadyTagged(beforeTags, contact)
    ? beforeTags
    : [...beforeTags, contactImportTag(contact, userId, importedAt)];
  const update = {
    address: existing.address ?? contact.address,
    company: existing.company ?? contact.company,
    email: existing.email ?? contact.email,
    name: existing.name ?? contact.name,
    phone: existing.phone ?? contact.phone,
    source: existing.source ?? "mobile_contacts",
    tags: afterTags,
  };
  const changed =
    update.address !== existing.address ||
    update.company !== existing.company ||
    update.email !== existing.email ||
    update.name !== existing.name ||
    update.phone !== existing.phone ||
    update.source !== existing.source ||
    afterTags.length !== beforeTags.length;

  return changed ? update : null;
}

function findExistingContact(
  contact: ImportContact,
  byEmail: Map<string, ExistingContact>,
  byPhone: Map<string, ExistingContact>,
) {
  if (contact.email) {
    const byEmailMatch = byEmail.get(contact.email);

    if (byEmailMatch) {
      return byEmailMatch;
    }
  }

  const phoneKey = normalizePhone(contact.phone);

  return phoneKey ? byPhone.get(phoneKey) ?? null : null;
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = objectRecord(await request.json().catch(() => null));
    const contactType = normalizeContactType(textValue(payload.contactType));
    const contacts = dedupeImportContacts(
      jsonArray(payload.contacts)
        .slice(0, 500)
        .map(normalizeImportContact)
        .filter((contact): contact is ImportContact => Boolean(contact)),
    );

    if (!contacts.length) {
      throw new MobileApiError("Choose at least one contact to import.", 400);
    }

    const { data: existingContacts, error: existingError } = await supabase
      .from("contacts")
      .select("id,name,email,phone,company,contact_type,address,source,tags")
      .eq("workspace_id", workspace.id)
      .limit(5000);

    if (existingError) {
      throw new Error(existingError.message);
    }

    const byEmail = new Map<string, ExistingContact>();
    const byPhone = new Map<string, ExistingContact>();

    for (const existing of (existingContacts ?? []) as ExistingContact[]) {
      const email = normalizeEmail(existing.email);
      const phone = normalizePhone(existing.phone);

      if (email && !byEmail.has(email)) {
        byEmail.set(email, existing);
      }

      if (phone && !byPhone.has(phone)) {
        byPhone.set(phone, existing);
      }
    }

    const importedAt = new Date().toISOString();
    const importedContacts: Array<{
      email: string | null;
      id: string;
      name: string | null;
      phone: string | null;
      result: "created" | "skipped" | "updated";
    }> = [];
    let created = 0;
    let skipped = 0;
    let updated = 0;

    for (const contact of contacts) {
      const existing = findExistingContact(contact, byEmail, byPhone);

      if (existing) {
        const update = buildExistingContactUpdate({
          contact,
          existing,
          importedAt,
          userId: user.id,
        });

        if (!update) {
          skipped += 1;
          importedContacts.push({
            email: existing.email,
            id: existing.id,
            name: existing.name,
            phone: existing.phone,
            result: "skipped",
          });
          continue;
        }

        const { data: after, error: updateError } = await supabase
          .from("contacts")
          .update(update)
          .eq("workspace_id", workspace.id)
          .eq("id", existing.id)
          .select("id,name,email,phone")
          .single();

        if (updateError || !after) {
          throw new Error(updateError?.message ?? "Unable to update contact.");
        }

        updated += 1;
        importedContacts.push({
          email: after.email ? String(after.email) : null,
          id: String(after.id),
          name: after.name ? String(after.name) : null,
          phone: after.phone ? String(after.phone) : null,
          result: "updated",
        });
        continue;
      }

      const insert = {
        address: contact.address,
        company: contact.company,
        contact_type: contactType,
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        source: "mobile_contacts",
        tags: [contactImportTag(contact, user.id, importedAt)],
        workspace_id: workspace.id,
      };
      const { data: after, error: insertError } = await supabase
        .from("contacts")
        .insert(insert)
        .select("id,name,email,phone")
        .single();

      if (insertError || !after) {
        throw new Error(insertError?.message ?? "Unable to create contact.");
      }

      created += 1;
      importedContacts.push({
        email: after.email ? String(after.email) : null,
        id: String(after.id),
        name: after.name ? String(after.name) : null,
        phone: after.phone ? String(after.phone) : null,
        result: "created",
      });
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "contact.phone_contacts_imported",
      entityType: "contact",
      before: null,
      after: {
        created,
        skipped,
        updated,
      },
      metadata: {
        contactType,
        importedContactIds: importedContacts.map((contact) => contact.id),
        source: "mobile.settings.contact_sync",
      },
    });

    return Response.json({
      created,
      importedContacts,
      message: `${created} created, ${updated} updated, ${skipped} already in CRM.`,
      skipped,
      updated,
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
