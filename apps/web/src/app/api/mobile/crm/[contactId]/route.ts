import { getContactProfile } from "../../../../../lib/crm/queries";
import { normalizeContactType } from "../../../../../lib/crm/contact-types";
import { insertAuditLog } from "../../../../../lib/engine/event-action-audit";
import {
  MobileApiError,
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ contactId: string }>;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function actionSummary(input: Record<string, unknown>) {
  return (
    textValue(input.body) ??
    textValue(input.replyBody) ??
    textValue(input.message) ??
    textValue(input.reason) ??
    "Ready for review."
  );
}

function lifecycleFromTags(tags: unknown[]) {
  const override = [...tags]
    .reverse()
    .map(objectRecord)
    .find((tag) => textValue(tag.kind) === "mobile_lifecycle_override");

  if (!override) {
    return null;
  }

  return {
    reason: textValue(override.reason),
    reviewedAt: textValue(override.reviewedAt),
    source: "manual",
    stage: textValue(override.stage) ?? "active",
  };
}

function computedLifecycle(profile: NonNullable<Awaited<ReturnType<typeof getContactProfile>>>) {
  if (profile.counts.messages > 0 || profile.counts.leads > 0) {
    return "active";
  }

  return "new";
}

function normalizeMatchValue(value: string | null) {
  return value?.trim().toLowerCase() ?? null;
}

function contactTitle(contact: {
  company: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
}) {
  return contact.name ?? contact.company ?? contact.email ?? contact.phone ?? "Contact";
}

async function loadContactMeta({
  contactId,
  supabase,
  workspaceId,
}: {
  contactId: string;
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
  workspaceId: string;
}) {
  const { data: current, error: currentError } = await supabase
    .from("contacts")
    .select("id,name,email,phone,company,contact_type,address,source,notes,tags,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (currentError) {
    throw new Error(currentError.message);
  }

  if (!current) {
    throw new MobileApiError("Contact profile was not found.", 404);
  }

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id,name,email,phone,company,contact_type,address,tags,updated_at")
    .eq("workspace_id", workspaceId)
    .limit(250);

  if (contactsError) {
    throw new Error(contactsError.message);
  }

  const currentEmail = normalizeMatchValue(current.email ? String(current.email) : null);
  const currentPhone = normalizeMatchValue(current.phone ? String(current.phone) : null);
  const currentCompany = normalizeMatchValue(current.company ? String(current.company) : null);
  const dismissedCandidateIds = new Set(
    jsonArray(current.tags)
      .map(objectRecord)
      .filter((tag) => textValue(tag.kind) === "mobile_profile_resolution")
      .flatMap((tag) => jsonArray(tag.dismissedCandidateIds))
      .filter((value): value is string => typeof value === "string"),
  );
  const candidates = (contacts ?? [])
    .filter((candidate) => String(candidate.id) !== contactId)
    .filter((candidate) => !dismissedCandidateIds.has(String(candidate.id)))
    .map((candidate) => {
      const matchFields: string[] = [];
      const email = normalizeMatchValue(candidate.email ? String(candidate.email) : null);
      const phone = normalizeMatchValue(candidate.phone ? String(candidate.phone) : null);
      const company = normalizeMatchValue(candidate.company ? String(candidate.company) : null);

      if (currentEmail && email === currentEmail) {
        matchFields.push("email");
      }

      if (currentPhone && phone === currentPhone) {
        matchFields.push("phone");
      }

      if (currentCompany && company === currentCompany) {
        matchFields.push("company");
      }

      return {
        company: candidate.company ? String(candidate.company) : null,
        contactType: candidate.contact_type ? String(candidate.contact_type) : "client",
        email: candidate.email ? String(candidate.email) : null,
        id: String(candidate.id),
        matchFields,
        name: candidate.name ? String(candidate.name) : null,
        phone: candidate.phone ? String(candidate.phone) : null,
        updatedAt: String(candidate.updated_at),
      };
    })
    .filter((candidate) => candidate.matchFields.length > 0)
    .slice(0, 8);
  const companyContacts = currentCompany
    ? (contacts ?? [])
        .filter((candidate) => String(candidate.id) !== contactId)
        .filter(
          (candidate) =>
            normalizeMatchValue(candidate.company ? String(candidate.company) : null) ===
            currentCompany,
        )
        .map((candidate) => ({
          contactType: candidate.contact_type ? String(candidate.contact_type) : "client",
          email: candidate.email ? String(candidate.email) : null,
          id: String(candidate.id),
          name: candidate.name ? String(candidate.name) : null,
          phone: candidate.phone ? String(candidate.phone) : null,
          updatedAt: String(candidate.updated_at),
        }))
        .slice(0, 8)
    : [];
  const identityWarnings = ["email", "phone"].flatMap((field) => {
    const value = field === "email" ? currentEmail : currentPhone;

    if (!value) {
      return [];
    }

    const contactIds = [contactId, ...candidates.filter((candidate) => candidate.matchFields.includes(field)).map((candidate) => candidate.id)];

    return contactIds.length > 1
      ? [{
          contactIds,
          count: contactIds.length,
          field,
          value,
        }]
      : [];
  });

  return {
    companyContacts,
    current,
    identityWarnings,
    resolutionCandidates: candidates,
  };
}

async function buildMobileContactProfile(request: Request, contactId: string) {
  const { supabase, workspace } = await requireMobileWorkspaceContext(request);
  const [profile, meta] = await Promise.all([
    getContactProfile(supabase, workspace.id, contactId),
    loadContactMeta({ contactId, supabase, workspaceId: workspace.id }),
  ]);

  if (!profile) {
    throw new MobileApiError("Contact profile was not found.", 404);
  }

  const tags = jsonArray(meta.current.tags);
  const lifecycleOverride = lifecycleFromTags(tags);
  const lifecycleStage = lifecycleOverride?.stage ?? computedLifecycle(profile);
  const hasConflict =
    meta.resolutionCandidates.length > 0 || meta.identityWarnings.length > 0;

  return {
    actions: profile.actions.slice(0, 8).map((action) => ({
      createdAt: action.createdAt,
      id: action.id,
      status: action.status,
      summary: actionSummary(action.input),
      title: action.type,
      type: action.type,
    })),
    auditLogs: profile.auditLogs.slice(0, 8),
    companyContacts: meta.companyContacts,
    contact: {
      ...profile.contact,
      lifecycleReason: lifecycleOverride?.reason,
      lifecycleReviewedAt: lifecycleOverride?.reviewedAt,
      lifecycleSource: lifecycleOverride?.source ?? profile.contact.source ?? "system",
      lifecycleStage,
      mergedIntoContactId: null,
      profileConflictContactIds: meta.resolutionCandidates.map((candidate) => candidate.id),
      profileResolutionReason: hasConflict
        ? "Possible duplicate contact details were found."
        : null,
      profileResolutionStatus: hasConflict ? "needs_review" : "clear",
    },
    counts: profile.counts,
    identityWarnings: meta.identityWarnings,
    leads: profile.leads,
    mergedSources: [],
    messages: profile.messages.slice(0, 12),
    quoteDrafts: profile.quoteDrafts.slice(0, 8),
    resolutionCandidates: meta.resolutionCandidates,
    title: contactTitle(profile.contact),
    workspace,
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { contactId } = await context.params;
    return Response.json(await buildMobileContactProfile(request, contactId));
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { contactId } = await context.params;
    const { supabase, user, workspace } =
      await requireMobileWorkspaceContext(request);
    const payload = objectRecord(await request.json().catch(() => null));
    const operation = textValue(payload.operation);

    if (operation === "update_profile") {
      await updateContactProfile({
        contactId,
        payload,
        supabase,
        userId: user.id,
        workspaceId: workspace.id,
      });
    } else if (operation === "set_lifecycle") {
      await setLifecycleOverride({
        contactId,
        payload,
        supabase,
        userId: user.id,
        workspaceId: workspace.id,
      });
    } else if (operation === "resolve_conflict") {
      await addProfileResolutionTag({
        contactId,
        payload,
        supabase,
        userId: user.id,
        workspaceId: workspace.id,
      });
    } else if (operation === "merge_contact") {
      const sourceContactId = textValue(payload.sourceContactId);

      if (!sourceContactId) {
        throw new MobileApiError("Merge source contact is required.", 400);
      }

      await mergeContactIntoTarget({
        sourceContactId,
        targetContactId: contactId,
        supabase,
        userId: user.id,
        workspaceId: workspace.id,
      });
    } else {
      throw new MobileApiError("CRM operation is invalid.", 400);
    }

    return Response.json({
      message: crmOperationMessage(operation),
      profile: await buildMobileContactProfile(request, contactId),
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

async function updateContactProfile({
  contactId,
  payload,
  supabase,
  userId,
  workspaceId,
}: {
  contactId: string;
  payload: Record<string, unknown>;
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
  userId: string;
  workspaceId: string;
}) {
  const { data: before, error: beforeError } = await supabase
    .from("contacts")
    .select("id,name,email,phone,company,contact_type,address,notes")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (beforeError) {
    throw new Error(beforeError.message);
  }

  if (!before) {
    throw new MobileApiError("Contact profile was not found.", 404);
  }

  const update = {
    address: nullableText(payload.address),
    company: nullableText(payload.company),
    contact_type: normalizeContactType(textValue(payload.contactType) ?? "client"),
    email: nullableText(payload.email)?.toLowerCase() ?? null,
    name: nullableText(payload.name),
    notes: nullableText(payload.notes),
    phone: nullableText(payload.phone),
  };

  if (!update.name && !update.email && !update.phone && !update.company) {
    throw new MobileApiError("Add at least a name, email, phone, or company.", 400);
  }

  const { data: after, error: updateError } = await supabase
    .from("contacts")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .select("id,name,email,phone,company,contact_type,address,notes")
    .single();

  if (updateError || !after) {
    throw new Error(updateError?.message ?? "Unable to update contact profile.");
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "contact.profile_updated",
    entityType: "contact",
    entityId: contactId,
    before,
    after,
    metadata: {
      source: "mobile.crm",
    },
  });
}

async function setLifecycleOverride({
  contactId,
  payload,
  supabase,
  userId,
  workspaceId,
}: {
  contactId: string;
  payload: Record<string, unknown>;
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
  userId: string;
  workspaceId: string;
}) {
  const stage = textValue(payload.lifecycleStage);

  if (!stage || !["new", "active", "lead", "client", "supplier", "inactive"].includes(stage)) {
    throw new MobileApiError("Lifecycle stage is invalid.", 400);
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id,tags")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!contact) {
    throw new MobileApiError("Contact profile was not found.", 404);
  }

  const beforeTags = jsonArray(contact.tags);
  const afterTags = [
    ...beforeTags.filter(
      (tag) => textValue(objectRecord(tag).kind) !== "mobile_lifecycle_override",
    ),
    {
      kind: "mobile_lifecycle_override",
      reason: nullableText(payload.lifecycleReason),
      reviewedAt: new Date().toISOString(),
      stage,
      userId,
    },
  ];
  const { error: updateError } = await supabase
    .from("contacts")
    .update({ tags: afterTags })
    .eq("workspace_id", workspaceId)
    .eq("id", contactId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "contact.lifecycle_override_updated",
    entityType: "contact",
    entityId: contactId,
    before: { tags: beforeTags },
    after: { tags: afterTags },
    metadata: {
      source: "mobile.crm",
    },
  });
}

async function addProfileResolutionTag({
  contactId,
  payload,
  supabase,
  userId,
  workspaceId,
}: {
  contactId: string;
  payload: Record<string, unknown>;
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
  userId: string;
  workspaceId: string;
}) {
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id,tags")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!contact) {
    throw new MobileApiError("Contact profile was not found.", 404);
  }

  const beforeTags = jsonArray(contact.tags);
  const afterTags = [
    ...beforeTags,
    {
      dismissedCandidateIds: jsonArray(payload.candidateIds).filter(
        (value): value is string => typeof value === "string",
      ),
      kind: "mobile_profile_resolution",
      reason: nullableText(payload.reason),
      resolvedAt: new Date().toISOString(),
      status: "dismissed",
      userId,
    },
  ];
  const { error: updateError } = await supabase
    .from("contacts")
    .update({ tags: afterTags })
    .eq("workspace_id", workspaceId)
    .eq("id", contactId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "contact.profile_conflict_dismissed",
    entityType: "contact",
    entityId: contactId,
    before: { tags: beforeTags },
    after: { tags: afterTags },
    metadata: {
      source: "mobile.crm",
    },
  });
}

async function mergeContactIntoTarget({
  sourceContactId,
  targetContactId,
  supabase,
  userId,
  workspaceId,
}: {
  sourceContactId: string;
  targetContactId: string;
  supabase: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>["supabase"];
  userId: string;
  workspaceId: string;
}) {
  if (sourceContactId === targetContactId) {
    throw new MobileApiError("Choose a different contact to merge.", 400);
  }

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id,name,email,phone,company,contact_type,address,notes,tags")
    .eq("workspace_id", workspaceId)
    .in("id", [sourceContactId, targetContactId]);

  if (error) {
    throw new Error(error.message);
  }

  const source = contacts?.find((contact) => String(contact.id) === sourceContactId);
  const target = contacts?.find((contact) => String(contact.id) === targetContactId);

  if (!source || !target) {
    throw new MobileApiError("Both contacts must exist before merging.", 404);
  }

  const mergedTarget = {
    address: target.address ?? source.address ?? null,
    company: target.company ?? source.company ?? null,
    contact_type: target.contact_type ?? source.contact_type ?? "client",
    email: target.email ?? source.email ?? null,
    name: target.name ?? source.name ?? null,
    notes: [target.notes, source.notes ? `Merged note: ${source.notes}` : null]
      .filter(Boolean)
      .join("\n\n") || null,
    phone: target.phone ?? source.phone ?? null,
    tags: [
      ...jsonArray(target.tags),
      {
        kind: "mobile_contact_merge",
        mergedAt: new Date().toISOString(),
        sourceContactId,
        sourceSummary: {
          company: source.company,
          email: source.email,
          name: source.name,
          phone: source.phone,
        },
        userId,
      },
    ],
  };

  const tables = ["leads", "conversations", "messages", "quote_drafts", "inquiry_facts"];

  for (const table of tables) {
    const { error: relinkError } = await supabase
      .from(table)
      .update({ contact_id: targetContactId })
      .eq("workspace_id", workspaceId)
      .eq("contact_id", sourceContactId);

    if (relinkError) {
      throw new Error(`Unable to relink ${table}: ${relinkError.message}`);
    }
  }

  const { error: updateTargetError } = await supabase
    .from("contacts")
    .update(mergedTarget)
    .eq("workspace_id", workspaceId)
    .eq("id", targetContactId);

  if (updateTargetError) {
    throw new Error(updateTargetError.message);
  }

  const { error: deleteSourceError } = await supabase
    .from("contacts")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", sourceContactId);

  if (deleteSourceError) {
    throw new Error(deleteSourceError.message);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "contact.merged",
    entityType: "contact",
    entityId: targetContactId,
    before: { source, target },
    after: { target: mergedTarget },
    metadata: {
      source: "mobile.crm",
      sourceContactId,
      targetContactId,
    },
  });
}

function crmOperationMessage(operation: string | null) {
  if (operation === "update_profile") {
    return "Contact profile updated.";
  }

  if (operation === "set_lifecycle") {
    return "Lifecycle override saved.";
  }

  if (operation === "merge_contact") {
    return "Contacts merged.";
  }

  return "Profile conflict dismissed.";
}
