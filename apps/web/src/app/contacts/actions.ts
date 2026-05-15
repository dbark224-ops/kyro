"use server";

import { normalizeContactType } from "../../lib/crm/contact-types";
import { insertAuditLog } from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: string) {
  return value ? value : null;
}

function safeRedirectPath(value: string, fallback: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function redirectWithContactStatus(
  contactId: string,
  key: "engine_error" | "engine_message",
  message: string,
  redirectTo?: string,
): never {
  const target = safeRedirectPath(redirectTo ?? "", `/contacts/${contactId}`);
  const separator = target.includes("?") ? "&" : "?";

  redirect(`${target}${separator}${key}=${encodeURIComponent(message)}`);
}

function redirectWithContactError(
  contactId: string,
  message: string,
  redirectTo?: string,
): never {
  redirectWithContactStatus(contactId, "engine_error", message, redirectTo);
}

export async function updateContactProfileAction(formData: FormData) {
  const contactId = formString(formData, "contactId");

  if (!contactId) {
    redirect("/contacts?engine_error=Contact id is required.");
  }

  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    `/contacts/${contactId}`,
  );
  const name = formString(formData, "name");
  const email = formString(formData, "email").toLowerCase();
  const phone = formString(formData, "phone");
  const company = formString(formData, "company");
  const address = formString(formData, "address");
  const notes = formString(formData, "notes");
  const contactType = normalizeContactType(formString(formData, "contactType"));

  if (!name && !email && !phone && !company) {
    redirectWithContactError(
      contactId,
      "Add at least a name, email, phone, or company.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: before, error: beforeError } = await supabase
    .from("contacts")
    .select("id,name,email,phone,company,contact_type,address,notes")
    .eq("workspace_id", workspace.id)
    .eq("id", contactId)
    .maybeSingle();

  if (beforeError) {
    redirectWithContactError(
      contactId,
      `Unable to load contact profile: ${beforeError.message}`,
      redirectTo,
    );
  }

  if (!before) {
    redirectWithContactError(
      contactId,
      "Contact profile not found.",
      redirectTo,
    );
  }

  const update = {
    address: nullableText(address),
    company: nullableText(company),
    contact_type: contactType,
    email: nullableText(email),
    name: nullableText(name),
    notes: nullableText(notes),
    phone: nullableText(phone),
  };

  const { data: after, error: updateError } = await supabase
    .from("contacts")
    .update(update)
    .eq("workspace_id", workspace.id)
    .eq("id", contactId)
    .select("id,name,email,phone,company,contact_type,address,notes")
    .single();

  if (updateError || !after) {
    redirectWithContactError(
      contactId,
      `Unable to update contact profile: ${updateError?.message ?? "unknown error"}`,
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "contact.profile_updated",
    entityType: "contact",
    entityId: contactId,
    before,
    after,
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  redirectWithContactStatus(
    contactId,
    "engine_message",
    "Contact profile updated.",
    redirectTo,
  );
}
