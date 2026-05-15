"use server";

import { ingestManualInbound } from "../../lib/inbound/manual";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeRedirectPath(value: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function redirectWithInboundMessage(
  redirectTo: string,
  key: "engine_error" | "engine_message",
  message: string
): never {
  const separator = redirectTo.includes("?") ? "&" : "?";

  redirect(`${redirectTo}${separator}${key}=${encodeURIComponent(message)}`);
}

export async function createManualInboundAction(formData: FormData) {
  const redirectTo = safeRedirectPath(formString(formData, "redirectTo"));
  const submissionKey = formString(formData, "submissionKey");
  const contactName = formString(formData, "contactName");
  const email = formString(formData, "email");
  const phone = formString(formData, "phone");
  const company = formString(formData, "company");
  const contactType = formString(formData, "contactType");
  const address = formString(formData, "address");
  const serviceType = formString(formData, "serviceType");
  const message = formString(formData, "message");

  if (!contactName) {
    redirectWithInboundMessage(redirectTo, "engine_error", "Contact name is required.");
  }

  if (!email && !phone) {
    redirectWithInboundMessage(redirectTo, "engine_error", "Add at least an email or phone number.");
  }

  if (!message) {
    redirectWithInboundMessage(redirectTo, "engine_error", "Inbound message is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  let wasDuplicate = false;

  try {
    const result = await ingestManualInbound(supabase, user, workspace.id, {
      submissionKey,
      contactName,
      email,
      phone,
      company,
      contactType,
      address,
      serviceType,
      message
    });
    wasDuplicate = Boolean(result.duplicate);
  } catch (error) {
    redirectWithInboundMessage(
      redirectTo,
      "engine_error",
      error instanceof Error ? error.message : "Unable to ingest manual inbound enquiry."
    );
  }

  revalidatePath("/");
  revalidatePath(redirectTo);
  redirectWithInboundMessage(
    redirectTo,
    "engine_message",
    wasDuplicate
      ? "Duplicate submit ignored. The first enquiry was already recorded."
      : "Inbound enquiry ingested, triaged, and queued for reply."
  );
}
