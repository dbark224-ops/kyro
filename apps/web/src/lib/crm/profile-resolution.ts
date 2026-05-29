import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";

export const CONTACT_PROFILE_MERGE_ACTION_TYPE = "merge_contact_profiles";

export const PROFILE_RESOLUTION_STATUSES = [
  "clear",
  "needs_review",
  "merged",
] as const;

export type ProfileResolutionStatus =
  (typeof PROFILE_RESOLUTION_STATUSES)[number];

type ContactMergeInput = {
  reason?: string | null;
  sourceContactId: string;
  targetContactId: string;
  userId: string;
  workspaceId: string;
};

type ContactReviewInput = {
  contactId: string;
  reason?: string | null;
  userId: string;
  workspaceId: string;
};

type ContactMergeSnapshot = {
  address: string | null;
  company: string | null;
  contact_type: string | null;
  email: string | null;
  id: string;
  lifecycle_reason: string | null;
  lifecycle_reviewed_at: string | null;
  lifecycle_source: string | null;
  lifecycle_stage: string | null;
  name: string | null;
  normalized_company: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  notes: string | null;
  phone: string | null;
  profile_conflict_contact_ids: unknown;
  profile_resolution_reason: string | null;
  profile_resolution_status: string | null;
  source: string | null;
  tags: unknown;
  updated_at: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : null))
        .filter((item): item is string => Boolean(item))
    : [];
}

function mergeTags(source: unknown, target: unknown) {
  return [
    ...new Set([...stringArray(target), ...stringArray(source), "merged"]),
  ];
}

function firstText(...values: Array<string | null | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? null;
}

function appendMergeNote(
  targetNotes: string | null,
  source: ContactMergeSnapshot,
  now: string,
) {
  const sourceNotes = textValue(source.notes);
  const sourceName = firstText(
    source.name,
    source.company,
    source.email,
    source.phone,
  );

  if (!sourceNotes) {
    return targetNotes;
  }

  const mergeNote = `[${now}] Merged notes from ${sourceName ?? "duplicate profile"}:\n${sourceNotes}`;

  return targetNotes ? `${targetNotes}\n\n${mergeNote}` : mergeNote;
}

function buildTargetPatch({
  now,
  source,
  target,
  userId,
}: {
  now: string;
  source: ContactMergeSnapshot;
  target: ContactMergeSnapshot;
  userId: string;
}) {
  return {
    address: firstText(target.address, source.address),
    company: firstText(target.company, source.company),
    contact_type:
      firstText(target.contact_type, source.contact_type) ?? "client",
    email: firstText(target.email, source.email),
    lifecycle_reason: firstText(
      target.lifecycle_reason,
      source.lifecycle_reason,
    ),
    lifecycle_reviewed_at:
      target.lifecycle_reviewed_at ?? source.lifecycle_reviewed_at,
    lifecycle_source: firstText(
      target.lifecycle_source,
      source.lifecycle_source,
    ),
    lifecycle_stage:
      firstText(target.lifecycle_stage, source.lifecycle_stage) ?? "lead",
    name: firstText(target.name, source.name),
    normalized_company: firstText(
      target.normalized_company,
      source.normalized_company,
    ),
    normalized_email: firstText(
      target.normalized_email,
      source.normalized_email,
    ),
    normalized_phone: firstText(
      target.normalized_phone,
      source.normalized_phone,
    ),
    notes: appendMergeNote(textValue(target.notes), source, now),
    phone: firstText(target.phone, source.phone),
    profile_conflict_contact_ids: stringArray(
      target.profile_conflict_contact_ids,
    ).filter((id) => id !== source.id),
    profile_resolution_reason: "Merged duplicate contact profile.",
    profile_resolution_status: "clear",
    profile_resolved_at: now,
    profile_resolved_by_user_id: userId,
    source: firstText(target.source, source.source),
    tags: mergeTags(source.tags, target.tags),
  };
}

async function updateContactLinks(
  supabase: SupabaseClient,
  table: string,
  workspaceId: string,
  sourceContactId: string,
  targetContactId: string,
) {
  const { data, error } = await supabase
    .from(table)
    .update({ contact_id: targetContactId })
    .eq("workspace_id", workspaceId)
    .eq("contact_id", sourceContactId)
    .select("id");

  if (error) {
    throw new Error(`Unable to move ${table}: ${error.message}`);
  }

  return data?.length ?? 0;
}

export function normalizeProfileResolutionStatus(
  value: unknown,
): ProfileResolutionStatus {
  return PROFILE_RESOLUTION_STATUSES.includes(value as ProfileResolutionStatus)
    ? (value as ProfileResolutionStatus)
    : "clear";
}

export async function resolveContactProfileReview(
  supabase: SupabaseClient,
  input: ContactReviewInput,
) {
  const now = new Date().toISOString();
  const reason =
    input.reason?.trim() ||
    "Reviewed and kept separate from candidate profiles.";
  const { data: before, error: beforeError } = await supabase
    .from("contacts")
    .select(
      "id,profile_resolution_status,profile_resolution_reason,profile_conflict_contact_ids",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.contactId)
    .maybeSingle();

  if (beforeError || !before) {
    throw new Error(
      `Unable to load profile review: ${beforeError?.message ?? "not found"}`,
    );
  }

  const { data: after, error: updateError } = await supabase
    .from("contacts")
    .update({
      profile_conflict_contact_ids: [],
      profile_resolution_reason: reason,
      profile_resolution_status: "clear",
      profile_resolved_at: now,
      profile_resolved_by_user_id: input.userId,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.contactId)
    .select(
      "id,profile_resolution_status,profile_resolution_reason,profile_conflict_contact_ids",
    )
    .single();

  if (updateError || !after) {
    throw new Error(
      `Unable to mark profile reviewed: ${updateError?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: input.workspaceId,
    actorType: "user",
    actorId: input.userId,
    action: "contact.profile_review_resolved",
    entityType: "contact",
    entityId: input.contactId,
    before,
    after,
    metadata: { reason },
  });
}

export async function mergeContactProfiles(
  supabase: SupabaseClient,
  input: ContactMergeInput,
) {
  if (input.sourceContactId === input.targetContactId) {
    throw new Error("Choose two different contact profiles to merge.");
  }

  const now = new Date().toISOString();
  const reason =
    input.reason?.trim() || "Merged from CRM profile resolution review.";
  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select(
      "id,name,email,phone,company,normalized_email,normalized_phone,normalized_company,contact_type,lifecycle_stage,lifecycle_source,lifecycle_reason,lifecycle_reviewed_at,address,source,notes,tags,profile_resolution_status,profile_resolution_reason,profile_conflict_contact_ids,updated_at",
    )
    .eq("workspace_id", input.workspaceId)
    .in("id", [input.sourceContactId, input.targetContactId]);

  if (contactsError) {
    throw new Error(
      `Unable to load contact profiles: ${contactsError.message}`,
    );
  }

  const source = (contacts ?? []).find(
    (contact) => String(contact.id) === input.sourceContactId,
  ) as ContactMergeSnapshot | undefined;
  const target = (contacts ?? []).find(
    (contact) => String(contact.id) === input.targetContactId,
  ) as ContactMergeSnapshot | undefined;

  if (!source || !target) {
    throw new Error(
      "Both source and target profiles must exist in this workspace.",
    );
  }

  if (
    normalizeProfileResolutionStatus(source.profile_resolution_status) ===
    "merged"
  ) {
    throw new Error("The source profile has already been merged.");
  }

  const targetPatch = buildTargetPatch({
    now,
    source,
    target,
    userId: input.userId,
  });
  const { data: afterTarget, error: targetError } = await supabase
    .from("contacts")
    .update(targetPatch)
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.targetContactId)
    .select(
      "id,name,email,phone,company,contact_type,lifecycle_stage,address,notes,profile_resolution_status,profile_conflict_contact_ids",
    )
    .single();

  if (targetError || !afterTarget) {
    throw new Error(
      `Unable to update target profile: ${targetError?.message ?? "unknown error"}`,
    );
  }

  const updatedCounts = {
    actions: 0,
    conversations: await updateContactLinks(
      supabase,
      "conversations",
      input.workspaceId,
      input.sourceContactId,
      input.targetContactId,
    ),
    inquiryFacts: await updateContactLinks(
      supabase,
      "inquiry_facts",
      input.workspaceId,
      input.sourceContactId,
      input.targetContactId,
    ),
    leads: await updateContactLinks(
      supabase,
      "leads",
      input.workspaceId,
      input.sourceContactId,
      input.targetContactId,
    ),
    messages: await updateContactLinks(
      supabase,
      "messages",
      input.workspaceId,
      input.sourceContactId,
      input.targetContactId,
    ),
    quoteDrafts: await updateContactLinks(
      supabase,
      "quote_drafts",
      input.workspaceId,
      input.sourceContactId,
      input.targetContactId,
    ),
  };

  const { data: contactActions, error: contactActionsError } = await supabase
    .from("actions")
    .update({ target_id: input.targetContactId })
    .eq("workspace_id", input.workspaceId)
    .eq("target_type", "contact")
    .eq("target_id", input.sourceContactId)
    .select("id");

  if (contactActionsError) {
    throw new Error(
      `Unable to move contact actions: ${contactActionsError.message}`,
    );
  }

  updatedCounts.actions = contactActions?.length ?? 0;

  const { data: afterSource, error: sourceError } = await supabase
    .from("contacts")
    .update({
      merged_into_contact_id: input.targetContactId,
      profile_conflict_contact_ids: [],
      profile_resolution_reason: reason,
      profile_resolution_status: "merged",
      profile_resolved_at: now,
      profile_resolved_by_user_id: input.userId,
      tags: mergeTags(["merged_contact_profile"], source.tags),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.sourceContactId)
    .select(
      "id,merged_into_contact_id,profile_resolution_status,profile_resolution_reason,profile_resolved_at",
    )
    .single();

  if (sourceError || !afterSource) {
    throw new Error(
      `Unable to archive source profile: ${sourceError?.message ?? "unknown error"}`,
    );
  }

  const { data: mergeAction, error: actionError } = await supabase
    .from("actions")
    .insert({
      workspace_id: input.workspaceId,
      type: CONTACT_PROFILE_MERGE_ACTION_TYPE,
      status: "completed",
      requested_by: "user",
      approval_required: false,
      approved_by_user_id: input.userId,
      approved_at: now,
      executed_at: now,
      target_type: "contact",
      target_id: input.targetContactId,
      input: {
        reason,
        sourceContactId: input.sourceContactId,
        targetContactId: input.targetContactId,
      },
      result: {
        sourceSnapshot: source,
        targetSnapshot: target,
        targetPatch,
        updatedCounts,
      },
      policy_snapshot: {},
    })
    .select("id")
    .single();

  if (actionError || !mergeAction) {
    throw new Error(
      `Profiles merged, but merge action could not be recorded: ${
        actionError?.message ?? "unknown error"
      }`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: input.workspaceId,
    actorType: "user",
    actorId: input.userId,
    action: "contact.profiles_merged",
    entityType: "contact",
    entityId: input.targetContactId,
    before: target,
    after: afterTarget,
    metadata: {
      actionId: String(mergeAction.id),
      reason,
      sourceContactId: input.sourceContactId,
      updatedCounts,
    },
  });

  await insertAuditLog(supabase, {
    workspaceId: input.workspaceId,
    actorType: "user",
    actorId: input.userId,
    action: "contact.profile_merged_into",
    entityType: "contact",
    entityId: input.sourceContactId,
    before: source,
    after: afterSource,
    metadata: {
      actionId: String(mergeAction.id),
      reason,
      targetContactId: input.targetContactId,
    },
  });

  return {
    actionId: String(mergeAction.id),
    targetContactId: input.targetContactId,
    updatedCounts,
  };
}
