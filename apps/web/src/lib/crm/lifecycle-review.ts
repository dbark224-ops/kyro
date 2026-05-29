import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import {
  CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE,
  evaluateContactLifecycle,
  normalizeContactLifecycleSource,
  normalizeContactLifecycleStage,
  type ContactLifecycleStage,
} from "./lifecycle";

type LifecycleReviewOptions = {
  contactId?: string | null;
  limit?: number;
};

type ContactRow = {
  id: string;
  lifecycle_stage?: string | null;
  lifecycle_source?: string | null;
};

type LeadRow = {
  contact_id?: string | null;
  next_step?: string | null;
  status?: string | null;
};

type MessageRow = {
  contact_id?: string | null;
  direction?: string | null;
};

type QuoteDraftRow = {
  contact_id?: string | null;
  id: string;
  metadata?: unknown;
  status?: string | null;
};

type QuoteApprovalLinkRow = {
  approved_at?: string | null;
  quote_draft_id?: string | null;
  status?: string | null;
};

type ExistingActionRow = {
  id: string;
  input?: unknown;
  result?: unknown;
  status?: string | null;
  target_id?: string | null;
  type?: string | null;
};

export type ContactLifecycleReviewSummary = {
  reviewed: number;
  skippedManual: number;
  suggested: number;
  unchanged: number;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function groupByContact<T extends { contact_id?: string | null }>(rows: T[]) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const contactId = textValue(row.contact_id);

    if (!contactId) {
      continue;
    }

    grouped.set(contactId, [...(grouped.get(contactId) ?? []), row]);
  }

  return grouped;
}

function activeLifecycleSuggestionFor(
  actions: ExistingActionRow[],
  recommendedStage: ContactLifecycleStage,
) {
  return actions.find((action) => {
    const status = textValue(action.status);
    const input = objectRecord(action.input);
    return (
      ["approved", "executing", "pending_approval", "requested"].includes(
        status ?? "",
      ) &&
      textValue(action.type) === CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE &&
      textValue(input.recommendedStage) === recommendedStage
    );
  });
}

function lifecycleEvidenceActions(actions: ExistingActionRow[]) {
  return actions.filter(
    (action) => textValue(action.type) !== CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE,
  );
}

export async function runContactLifecycleReview(
  supabase: SupabaseClient,
  workspaceId: string,
  options: LifecycleReviewOptions = {},
): Promise<ContactLifecycleReviewSummary> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let contactQuery = supabase
    .from("contacts")
    .select("id,lifecycle_stage,lifecycle_source")
    .eq("workspace_id", workspaceId)
    .is("merged_into_contact_id", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (options.contactId) {
    contactQuery = contactQuery.eq("id", options.contactId);
  }

  const { data: contactRows, error: contactError } = await contactQuery;

  if (contactError) {
    throw new Error(
      `Unable to load contacts for lifecycle review: ${contactError.message}`,
    );
  }

  const contacts = (contactRows ?? []) as ContactRow[];
  const contactIds = contacts.map((contact) => String(contact.id));

  if (contactIds.length === 0) {
    return { reviewed: 0, skippedManual: 0, suggested: 0, unchanged: 0 };
  }

  const [leads, messages, quoteDrafts, existingActions] = await Promise.all([
    supabase
      .from("leads")
      .select("contact_id,status,next_step")
      .eq("workspace_id", workspaceId)
      .in("contact_id", contactIds)
      .limit(2000),
    supabase
      .from("messages")
      .select("contact_id,direction")
      .eq("workspace_id", workspaceId)
      .in("contact_id", contactIds)
      .limit(5000),
    supabase
      .from("quote_drafts")
      .select("id,contact_id,status,metadata")
      .eq("workspace_id", workspaceId)
      .in("contact_id", contactIds)
      .limit(2000),
    supabase
      .from("actions")
      .select("id,target_id,type,status,input,result")
      .eq("workspace_id", workspaceId)
      .eq("target_type", "contact")
      .in("target_id", contactIds)
      .limit(2000),
  ]);

  if (leads.error) {
    throw new Error(`Unable to load lifecycle leads: ${leads.error.message}`);
  }

  if (messages.error) {
    throw new Error(
      `Unable to load lifecycle messages: ${messages.error.message}`,
    );
  }

  if (quoteDrafts.error) {
    throw new Error(
      `Unable to load lifecycle quote drafts: ${quoteDrafts.error.message}`,
    );
  }

  if (existingActions.error) {
    throw new Error(
      `Unable to load lifecycle actions: ${existingActions.error.message}`,
    );
  }

  const quoteDraftRows = (quoteDrafts.data ?? []) as QuoteDraftRow[];
  const quoteDraftIds = quoteDraftRows.map((draft) => String(draft.id));
  const quoteApprovalLinks =
    quoteDraftIds.length > 0
      ? await supabase
          .from("quote_approval_links")
          .select("quote_draft_id,status,approved_at")
          .eq("workspace_id", workspaceId)
          .in("quote_draft_id", quoteDraftIds)
          .limit(2000)
      : { data: [], error: null };

  if (quoteApprovalLinks.error) {
    throw new Error(
      `Unable to load lifecycle quote approvals: ${quoteApprovalLinks.error.message}`,
    );
  }

  const leadsByContact = groupByContact((leads.data ?? []) as LeadRow[]);
  const messagesByContact = groupByContact(
    (messages.data ?? []) as MessageRow[],
  );
  const quoteDraftsByContact = groupByContact(quoteDraftRows);
  const quoteDraftContactById = new Map(
    quoteDraftRows.map((draft) => [
      String(draft.id),
      textValue(draft.contact_id),
    ]),
  );
  const quoteApprovalsByContact = new Map<string, QuoteApprovalLinkRow[]>();

  for (const link of (quoteApprovalLinks.data ??
    []) as QuoteApprovalLinkRow[]) {
    const contactId = quoteDraftContactById.get(
      String(link.quote_draft_id ?? ""),
    );

    if (!contactId) {
      continue;
    }

    quoteApprovalsByContact.set(contactId, [
      ...(quoteApprovalsByContact.get(contactId) ?? []),
      link,
    ]);
  }

  const actionsByContact = new Map<string, ExistingActionRow[]>();

  for (const action of (existingActions.data ?? []) as ExistingActionRow[]) {
    const contactId = textValue(action.target_id);

    if (!contactId) {
      continue;
    }

    actionsByContact.set(contactId, [
      ...(actionsByContact.get(contactId) ?? []),
      action,
    ]);
  }

  const summary: ContactLifecycleReviewSummary = {
    reviewed: 0,
    skippedManual: 0,
    suggested: 0,
    unchanged: 0,
  };
  const reviewedAt = new Date().toISOString();

  for (const contact of contacts) {
    const contactId = String(contact.id);
    const currentStage = normalizeContactLifecycleStage(
      contact.lifecycle_stage,
    );
    const lifecycleSource = normalizeContactLifecycleSource(
      contact.lifecycle_source,
    );
    const review = evaluateContactLifecycle({
      currentStage,
      lifecycleSource,
      actions: lifecycleEvidenceActions(actionsByContact.get(contactId) ?? []),
      leads: leadsByContact.get(contactId) ?? [],
      messages: messagesByContact.get(contactId) ?? [],
      quoteApprovalLinks: quoteApprovalsByContact.get(contactId) ?? [],
      quoteDrafts: quoteDraftsByContact.get(contactId) ?? [],
    });

    summary.reviewed += 1;

    const { error: reviewedError } = await supabase
      .from("contacts")
      .update({ lifecycle_reviewed_at: reviewedAt })
      .eq("workspace_id", workspaceId)
      .eq("id", contactId);

    if (reviewedError) {
      throw new Error(
        `Unable to mark lifecycle review time: ${reviewedError.message}`,
      );
    }

    if (review.manualOverride) {
      summary.skippedManual += 1;
      continue;
    }

    if (!review.shouldSuggest) {
      summary.unchanged += 1;
      continue;
    }

    if (
      activeLifecycleSuggestionFor(
        actionsByContact.get(contactId) ?? [],
        review.recommendedStage,
      )
    ) {
      summary.unchanged += 1;
      continue;
    }

    const actionInput = {
      confidence: review.confidence,
      currentStage,
      evidence: review.evidence,
      reason: review.reason,
      recommendedStage: review.recommendedStage,
      reviewedAt,
    };
    const { data: action, error: actionError } = await supabase
      .from("actions")
      .insert({
        workspace_id: workspaceId,
        type: CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE,
        status: "pending_approval",
        requested_by: "system",
        approval_required: true,
        target_type: "contact",
        target_id: contactId,
        input: actionInput,
        result: {},
        policy_snapshot: {
          highConfidenceAutoApply: false,
          mode: "suggestion_only",
          source: "crm_lifecycle_review",
          version: 1,
        },
      })
      .select("id")
      .single();

    if (actionError || !action) {
      throw new Error(
        `Unable to create lifecycle suggestion: ${
          actionError?.message ?? "unknown error"
        }`,
      );
    }

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      action: "contact.lifecycle_review_suggested",
      entityType: "contact",
      entityId: contactId,
      after: {
        actionId: String(action.id),
        ...actionInput,
      },
    });

    summary.suggested += 1;
  }

  return summary;
}
