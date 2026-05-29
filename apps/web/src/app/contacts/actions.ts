"use server";

import { parseAddressFormData } from "../../lib/addresses/form";
import { normalizeContactType } from "../../lib/crm/contact-types";
import {
  normalizeCompanyName,
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
} from "../../lib/crm/identity";
import { runContactLifecycleReview } from "../../lib/crm/lifecycle-review";
import {
  CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE,
  normalizeContactLifecycleStage,
} from "../../lib/crm/lifecycle";
import {
  mergeContactProfiles,
  resolveContactProfileReview,
} from "../../lib/crm/profile-resolution";
import { insertAuditLog } from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function redirectWithStatus(
  target: string,
  key: "engine_error" | "engine_message",
  message: string,
): never {
  const separator = target.includes("?") ? "&" : "?";

  redirect(`${target}${separator}${key}=${encodeURIComponent(message)}`);
}

function redirectWithContactStatus(
  contactId: string,
  key: "engine_error" | "engine_message",
  message: string,
  redirectTo?: string,
): never {
  const target = safeRedirectPath(redirectTo ?? "", `/contacts/${contactId}`);

  redirectWithStatus(target, key, message);
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
  const rawEmail = formString(formData, "email");
  const email = normalizeContactEmail(rawEmail);
  const phone = formString(formData, "phone");
  const company = formString(formData, "company");
  const normalizedCompany = normalizeCompanyName(company);
  const address = formString(formData, "address");
  const addressFields = parseAddressFormData(formData, "address");
  const notes = formString(formData, "notes");
  const contactType = normalizeContactType(formString(formData, "contactType"));
  const lifecycleStage = normalizeContactLifecycleStage(
    formString(formData, "lifecycleStage"),
  );
  const originalLifecycleStage = normalizeContactLifecycleStage(
    formString(formData, "originalLifecycleStage"),
  );
  const lifecycleChanged = lifecycleStage !== originalLifecycleStage;

  if (!name && !email && !phone && !company) {
    redirectWithContactError(
      contactId,
      "Add at least a name, email, phone, or company.",
      redirectTo,
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const generalSettings = await getWorkspaceGeneralSettings(
    supabase,
    workspace.id,
  );
  const normalizedPhone = normalizeContactPhoneForRegion(
    phone,
    generalSettings.defaultPhoneRegion,
  );
  const { data: before, error: beforeError } = await supabase
    .from("contacts")
    .select(
      "id,name,email,phone,company,contact_type,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at,address,notes",
    )
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
    ...(formString(formData, "addressGooglePlaceId") ||
    address !== (before.address ?? "")
      ? addressFields
      : { address: nullableText(address) }),
    company: nullableText(company),
    contact_type: contactType,
    email,
    lifecycle_stage: lifecycleStage,
    lifecycle_source: lifecycleChanged
      ? "manual"
      : (before.lifecycle_source ?? "system"),
    lifecycle_reason: lifecycleChanged
      ? "Set manually from CRM profile."
      : before.lifecycle_reason,
    lifecycle_reviewed_at: lifecycleChanged
      ? new Date().toISOString()
      : before.lifecycle_reviewed_at,
    name: nullableText(name),
    notes: nullableText(notes),
    phone: nullableText(phone),
    normalized_email: email,
    normalized_phone: normalizedPhone,
    normalized_company: normalizedCompany,
  };

  const { data: after, error: updateError } = await supabase
    .from("contacts")
    .update(update)
    .eq("workspace_id", workspace.id)
    .eq("id", contactId)
    .select(
      "id,name,email,phone,company,contact_type,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at,address,notes",
    )
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

export async function clearLifecycleManualOverrideAction(formData: FormData) {
  const contactId = formString(formData, "contactId");

  if (!contactId) {
    redirect("/contacts?engine_error=Contact id is required.");
  }

  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    `/contacts/${contactId}`,
  );
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: before, error: beforeError } = await supabase
    .from("contacts")
    .select(
      "id,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", contactId)
    .maybeSingle();

  if (beforeError || !before) {
    redirectWithContactError(
      contactId,
      `Unable to load contact lifecycle: ${beforeError?.message ?? "not found"}`,
      redirectTo,
    );
  }

  if (String(before.lifecycle_source) !== "manual") {
    redirectWithContactStatus(
      contactId,
      "engine_message",
      "Lifecycle is already open to automated review.",
      redirectTo,
    );
  }

  const now = new Date().toISOString();
  const { data: after, error: updateError } = await supabase
    .from("contacts")
    .update({
      lifecycle_reason:
        "Manual override cleared. Automated lifecycle review may suggest future changes.",
      lifecycle_reviewed_at: now,
      lifecycle_source: "system",
    })
    .eq("workspace_id", workspace.id)
    .eq("id", contactId)
    .select(
      "id,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at",
    )
    .single();

  if (updateError || !after) {
    redirectWithContactError(
      contactId,
      `Unable to clear manual lifecycle override: ${
        updateError?.message ?? "unknown error"
      }`,
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "contact.lifecycle_manual_override_cleared",
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
    "Manual lifecycle override cleared.",
    redirectTo,
  );
}

export async function mergeContactProfilesAction(formData: FormData) {
  const sourceContactId = formString(formData, "sourceContactId");
  const targetContactId = formString(formData, "targetContactId");
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    "/contacts",
  );
  const reason = formString(formData, "reason");

  if (!sourceContactId || !targetContactId) {
    redirectWithStatus(
      redirectTo,
      "engine_error",
      "Choose a source and target profile to merge.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    const result = await mergeContactProfiles(supabase, {
      reason,
      sourceContactId,
      targetContactId,
      userId: user.id,
      workspaceId: workspace.id,
    });

    revalidatePath("/contacts");
    revalidatePath(`/contacts/${sourceContactId}`);
    revalidatePath(`/contacts/${targetContactId}`);
    redirectWithStatus(
      safeRedirectPath(
        formString(formData, "successRedirectTo"),
        `/contacts?contactId=${result.targetContactId}`,
      ),
      "engine_message",
      `Profiles merged. Moved ${result.updatedCounts.messages} message${
        result.updatedCounts.messages === 1 ? "" : "s"
      }, ${result.updatedCounts.leads} lead${
        result.updatedCounts.leads === 1 ? "" : "s"
      }, and ${result.updatedCounts.quoteDrafts} document${
        result.updatedCounts.quoteDrafts === 1 ? "" : "s"
      }.`,
    );
  } catch (error) {
    redirectWithStatus(
      redirectTo,
      "engine_error",
      error instanceof Error ? error.message : "Unable to merge profiles.",
    );
  }
}

export async function resolveProfileReviewAction(formData: FormData) {
  const contactId = formString(formData, "contactId");
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    contactId ? `/contacts/${contactId}` : "/contacts",
  );
  const reason = formString(formData, "reason");

  if (!contactId) {
    redirectWithStatus(
      redirectTo,
      "engine_error",
      "Choose a profile to mark reviewed.",
    );
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    await resolveContactProfileReview(supabase, {
      contactId,
      reason,
      userId: user.id,
      workspaceId: workspace.id,
    });
  } catch (error) {
    redirectWithStatus(
      redirectTo,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to mark profile reviewed.",
    );
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  redirectWithStatus(redirectTo, "engine_message", "Profile review resolved.");
}

export async function runContactLifecycleReviewAction(formData: FormData) {
  const contactId = formString(formData, "contactId");
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    "/contacts",
  );
  const { supabase, workspace } = await requireWorkspaceContext();
  let summary: Awaited<ReturnType<typeof runContactLifecycleReview>>;

  try {
    summary = await runContactLifecycleReview(supabase, workspace.id, {
      contactId: contactId || null,
      limit: contactId ? 1 : 100,
    });
  } catch (error) {
    redirectWithStatus(
      redirectTo,
      "engine_error",
      error instanceof Error
        ? error.message
        : "Unable to run lifecycle review.",
    );
  }

  revalidatePath("/contacts");
  if (contactId) {
    revalidatePath(`/contacts/${contactId}`);
  }

  redirectWithStatus(
    redirectTo,
    "engine_message",
    `Lifecycle review complete: ${summary.suggested} suggestion${
      summary.suggested === 1 ? "" : "s"
    } created from ${summary.reviewed} profile${
      summary.reviewed === 1 ? "" : "s"
    }.`,
  );
}

export async function applyLifecycleSuggestionAction(formData: FormData) {
  const actionId = formString(formData, "actionId");
  const contactId = formString(formData, "contactId");

  if (!actionId || !contactId) {
    redirect(
      "/contacts?engine_error=Lifecycle action and contact are required.",
    );
  }

  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    `/contacts/${contactId}`,
  );
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: action, error: actionError } = await supabase
    .from("actions")
    .select("id,status,target_id,input,result")
    .eq("workspace_id", workspace.id)
    .eq("id", actionId)
    .eq("type", CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE)
    .eq("target_type", "contact")
    .maybeSingle();

  if (actionError || !action) {
    redirectWithContactError(
      contactId,
      `Unable to load lifecycle suggestion: ${
        actionError?.message ?? "not found"
      }`,
      redirectTo,
    );
  }

  if (String(action.target_id) !== contactId) {
    redirectWithContactError(
      contactId,
      "Lifecycle suggestion target mismatch.",
      redirectTo,
    );
  }

  const status = String(action.status);
  if (!["approved", "pending_approval", "requested"].includes(status)) {
    redirectWithContactError(
      contactId,
      "Lifecycle suggestion has already been handled.",
      redirectTo,
    );
  }

  const input = objectRecord(action.input);
  const recommendedStage = normalizeContactLifecycleStage(
    typeof input.recommendedStage === "string" ? input.recommendedStage : null,
  );
  const reason =
    typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim()
      : "Applied from lifecycle review suggestion.";
  const now = new Date().toISOString();
  const { data: before, error: beforeError } = await supabase
    .from("contacts")
    .select(
      "id,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", contactId)
    .maybeSingle();

  if (beforeError || !before) {
    redirectWithContactError(
      contactId,
      `Unable to load contact lifecycle: ${beforeError?.message ?? "not found"}`,
      redirectTo,
    );
  }

  const { data: after, error: updateError } = await supabase
    .from("contacts")
    .update({
      lifecycle_stage: recommendedStage,
      lifecycle_source: "ai",
      lifecycle_reason: reason,
      lifecycle_reviewed_at: now,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", contactId)
    .select(
      "id,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at",
    )
    .single();

  if (updateError || !after) {
    redirectWithContactError(
      contactId,
      `Unable to apply lifecycle suggestion: ${
        updateError?.message ?? "unknown error"
      }`,
      redirectTo,
    );
  }

  const { error: actionUpdateError } = await supabase
    .from("actions")
    .update({
      approved_at: now,
      approved_by_user_id: user.id,
      executed_at: now,
      result: {
        ...objectRecord(action.result),
        appliedAt: now,
        appliedByUserId: user.id,
        appliedStage: recommendedStage,
      },
      status: "completed",
    })
    .eq("workspace_id", workspace.id)
    .eq("id", actionId);

  if (actionUpdateError) {
    redirectWithContactError(
      contactId,
      `Lifecycle changed, but the suggestion could not be completed: ${actionUpdateError.message}`,
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "contact.lifecycle_stage_changed",
    entityType: "contact",
    entityId: contactId,
    before,
    after,
    metadata: {
      actionId,
      source: "lifecycle_suggestion",
    },
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  redirectWithContactStatus(
    contactId,
    "engine_message",
    "Lifecycle suggestion applied.",
    redirectTo,
  );
}

export async function dismissLifecycleSuggestionAction(formData: FormData) {
  const actionId = formString(formData, "actionId");
  const contactId = formString(formData, "contactId");

  if (!actionId || !contactId) {
    redirect(
      "/contacts?engine_error=Lifecycle action and contact are required.",
    );
  }

  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    `/contacts/${contactId}`,
  );
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const now = new Date().toISOString();
  const { data: action, error } = await supabase
    .from("actions")
    .update({
      result: {
        dismissedAt: now,
        dismissedByUserId: user.id,
      },
      status: "cancelled",
    })
    .eq("workspace_id", workspace.id)
    .eq("id", actionId)
    .eq("type", CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE)
    .eq("target_type", "contact")
    .eq("target_id", contactId)
    .in("status", ["approved", "pending_approval", "requested"])
    .select("id")
    .maybeSingle();

  if (error || !action) {
    redirectWithContactError(
      contactId,
      `Unable to ignore lifecycle suggestion: ${error?.message ?? "not found"}`,
      redirectTo,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "contact.lifecycle_review_dismissed",
    entityType: "contact",
    entityId: contactId,
    after: {
      actionId,
      dismissedAt: now,
    },
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  redirectWithContactStatus(
    contactId,
    "engine_message",
    "Lifecycle suggestion ignored.",
    redirectTo,
  );
}
