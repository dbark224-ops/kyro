import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import { evaluateContactLifecycle } from "./lifecycle";
import { normalizeContactType } from "./contact-types";
import { textValue } from "@kyro/core";

type LifecycleReviewOptions = {
  contactId?: string | null;
  limit?: number;
};

type ContactRow = {
  contact_type?: string | null;
  id: string;
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
  /** Contacts moved from lead to client. */
  promoted: number;
  reviewed: number;
  /** Contacts skipped because they are not leads. */
  skippedNotLead: number;
  unchanged: number;
};

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

/**
 * Every action on the contact counts as evidence now.
 *
 * This used to strip out the review engine's own suggestion actions before
 * evaluating, so it did not read its own proposals back as proof. It no longer
 * creates any -- a promotion is applied directly -- so there is nothing to
 * filter out.
 */
function lifecycleEvidenceActions(actions: ExistingActionRow[]) {
  return actions;
}

export async function runContactLifecycleReview(
  supabase: SupabaseClient,
  workspaceId: string,
  options: LifecycleReviewOptions = {},
): Promise<ContactLifecycleReviewSummary> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let contactQuery = supabase
    .from("contacts")
    .select("id,contact_type")
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
    return { promoted: 0, reviewed: 0, skippedNotLead: 0, unchanged: 0 };
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
    promoted: 0,
    reviewed: 0,
    skippedNotLead: 0,
    unchanged: 0,
  };

  for (const contact of contacts) {
    const contactId = String(contact.id);
    const currentType = normalizeContactType(contact.contact_type);

    summary.reviewed += 1;

    // Promotion only, and only out of "lead". Never demote a client, and never
    // touch a supplier, contractor, staff member or property manager -- those
    // are things a person decided, and the evidence this reads (a quote
    // approved, a job booked, an invoice paid) says nothing about them.
    //
    // Being one-directional is also what lets this run unattended. The old
    // suggestion flow deferred to a `lifecycle_source` column to know whether a
    // human had set the value; contact type has no such column, and a rule that
    // can only ever move lead to client does not need one.
    if (currentType !== "lead") {
      summary.skippedNotLead += 1;
      continue;
    }

    const review = evaluateContactLifecycle({
      currentStage: "lead",
      lifecycleSource: "system",
      actions: lifecycleEvidenceActions(actionsByContact.get(contactId) ?? []),
      leads: leadsByContact.get(contactId) ?? [],
      messages: messagesByContact.get(contactId) ?? [],
      quoteApprovalLinks: quoteApprovalsByContact.get(contactId) ?? [],
      quoteDrafts: quoteDraftsByContact.get(contactId) ?? [],
    });

    if (!review.shouldSuggest || review.recommendedStage !== "client") {
      summary.unchanged += 1;
      continue;
    }

    // The contact_type guard makes this a no-op if anything changed the type
    // between the read above and here, so a concurrent edit by the owner wins
    // rather than being overwritten.
    const { error: promoteError } = await supabase
      .from("contacts")
      .update({ contact_type: "client" })
      .eq("workspace_id", workspaceId)
      .eq("id", contactId)
      .eq("contact_type", "lead");

    if (promoteError) {
      throw new Error(
        `Unable to promote contact to client: ${promoteError.message}`,
      );
    }

    // This audit entry is now the entire record of why the type changed. It
    // used to be a suggestion the owner approved, so the reasoning was on
    // screen in front of them; it happens unattended now, and this is the only
    // place that says what convinced it.
    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      action: "contact.promoted_to_client",
      entityType: "contact",
      entityId: contactId,
      before: { contactType: "lead" },
      after: {
        confidence: review.confidence,
        contactType: "client",
        evidence: review.evidence,
        reason: review.reason,
      },
    });

    summary.promoted += 1;
  }

  return summary;
}
