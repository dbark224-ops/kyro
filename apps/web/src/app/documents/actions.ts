"use server";

import {
  getQuoteTemplate,
  parseQuoteLineItems,
} from "../../lib/documents/templates";
import { insertAuditLog } from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const QUOTE_DRAFT_STATUSES = new Set(["draft", "ready", "sent", "archived"]);

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: string) {
  return value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function documentPath(quoteDraftId: string) {
  return `/documents/${encodeURIComponent(quoteDraftId)}`;
}

function redirectWithDocumentMessage(
  quoteDraftId: string,
  key: "engine_error" | "engine_message",
  message: string,
): never {
  redirect(`${documentPath(quoteDraftId)}?${key}=${encodeURIComponent(message)}`);
}

export async function createQuoteDraftFromTemplateAction(formData: FormData) {
  const template = getQuoteTemplate(formString(formData, "templateKey"));
  const { supabase, user, workspace } = await requireWorkspaceContext();

  const { data: quoteDraft, error } = await supabase
    .from("quote_drafts")
    .insert({
      workspace_id: workspace.id,
      title: template.defaultTitle,
      status: "draft",
      line_items: template.lineItems,
      notes: template.notes,
      metadata: {
        customerCompany: null,
        customerEmail: null,
        customerName: null,
        customerPhone: null,
        dryRun: true,
        jobAddress: null,
        jobType: template.label,
        preferredTime: null,
        source: "document.template",
        templateKey: template.key,
      },
    })
    .select("id,title,status")
    .single();

  if (error || !quoteDraft) {
    redirect(
      `/documents?engine_error=${encodeURIComponent(
        error?.message ?? "Unable to create quote draft.",
      )}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "quote_draft.created_from_template",
    entityType: "quote_draft",
    entityId: String(quoteDraft.id),
    after: {
      status: quoteDraft.status,
      templateKey: template.key,
      title: quoteDraft.title,
    },
  });

  revalidatePath("/documents");
  redirectWithDocumentMessage(
    String(quoteDraft.id),
    "engine_message",
    "Quote draft created.",
  );
}

export async function applyQuoteTemplateAction(formData: FormData) {
  const quoteDraftId = formString(formData, "quoteDraftId");
  const template = getQuoteTemplate(formString(formData, "templateKey"));

  if (!quoteDraftId) {
    redirect("/documents?engine_error=Quote draft id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: before, error: beforeError } = await supabase
    .from("quote_drafts")
    .select("id,title,status,line_items,notes,metadata")
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (beforeError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", beforeError.message);
  }

  if (!before) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Quote draft was not found.");
  }

  const nextMetadata = {
    ...objectRecord(before.metadata),
    jobType: template.label,
    templateAppliedAt: new Date().toISOString(),
    templateKey: template.key,
  };

  const { error: updateError } = await supabase
    .from("quote_drafts")
    .update({
      line_items: template.lineItems,
      metadata: nextMetadata,
      notes: template.notes,
      title: template.defaultTitle,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId);

  if (updateError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", updateError.message);
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "quote_draft.template_applied",
    entityType: "quote_draft",
    entityId: quoteDraftId,
    before: {
      lineItems: before.line_items,
      metadata: before.metadata,
      notes: before.notes,
      title: before.title,
    },
    after: {
      lineItems: template.lineItems,
      metadata: nextMetadata,
      notes: template.notes,
      title: template.defaultTitle,
    },
  });

  revalidatePath("/documents");
  revalidatePath(documentPath(quoteDraftId));
  redirectWithDocumentMessage(quoteDraftId, "engine_message", "Template applied.");
}

export async function updateQuoteDraftAction(formData: FormData) {
  const quoteDraftId = formString(formData, "quoteDraftId");
  const title = formString(formData, "title");
  const status = formString(formData, "status") || "draft";

  if (!quoteDraftId) {
    redirect("/documents?engine_error=Quote draft id is required.");
  }

  if (!title) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Title is required.");
  }

  if (!QUOTE_DRAFT_STATUSES.has(status)) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Quote status is invalid.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: before, error: beforeError } = await supabase
    .from("quote_drafts")
    .select("id,title,status,line_items,notes,metadata,conversation_id,lead_id")
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (beforeError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", beforeError.message);
  }

  if (!before) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Quote draft was not found.");
  }

  const nextMetadata = {
    ...objectRecord(before.metadata),
    customerCompany: nullableText(formString(formData, "customerCompany")),
    customerEmail: nullableText(formString(formData, "customerEmail")),
    customerName: nullableText(formString(formData, "customerName")),
    customerPhone: nullableText(formString(formData, "customerPhone")),
    jobAddress: nullableText(formString(formData, "jobAddress")),
    jobType: nullableText(formString(formData, "jobType")),
    preferredTime: nullableText(formString(formData, "preferredTime")),
    updatedFrom: "documents.editor",
  };
  const nextLineItems = parseQuoteLineItems(formString(formData, "lineItemsText"));
  const nextNotes = nullableText(formString(formData, "notes"));

  const { error: updateError } = await supabase
    .from("quote_drafts")
    .update({
      line_items: nextLineItems,
      metadata: nextMetadata,
      notes: nextNotes,
      status,
      title,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId);

  if (updateError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", updateError.message);
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "quote_draft.updated",
    entityType: "quote_draft",
    entityId: quoteDraftId,
    before: {
      lineItems: before.line_items,
      metadata: before.metadata,
      notes: before.notes,
      status: before.status,
      title: before.title,
    },
    after: {
      lineItems: nextLineItems,
      metadata: nextMetadata,
      notes: nextNotes,
      status,
      title,
    },
    metadata: {
      conversationId: before.conversation_id ? String(before.conversation_id) : null,
      leadId: before.lead_id ? String(before.lead_id) : null,
    },
  });

  revalidatePath("/documents");
  revalidatePath(documentPath(quoteDraftId));

  if (before.conversation_id) {
    revalidatePath(`/inbox/${before.conversation_id}`);
  }

  redirectWithDocumentMessage(quoteDraftId, "engine_message", "Quote draft saved.");
}
