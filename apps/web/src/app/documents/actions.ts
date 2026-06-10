"use server";

import {
  draftTitleFromTemplate,
  getQuoteTemplate,
  parseQuoteLineItemRows,
} from "../../lib/documents/templates";
import {
  DOCUMENT_ACCENT_THEMES,
  DOCUMENT_CURRENCIES,
  DOCUMENT_TEMPLATE_POLICY_TYPE,
  getDocumentTemplateSettings,
  normalizeDocumentTemplateDesignSettings,
  normalizeDocumentTemplateSettings,
  type CustomDocumentTemplate,
  type DocumentTemplateReferenceFile,
} from "../../lib/documents/settings";
import {
  buildInvoicePdfArtifactForDraft,
  buildQuotePdfArtifactForDraft,
  quotePdfMetadata,
} from "../../lib/documents/pdf";
import {
  generatedDocumentMetadata,
  recordQuoteGeneratedDocument,
} from "../../lib/documents/generated-documents";
import { fileGeneratedDocumentToGoogleDrive } from "../../lib/integrations/google-drive";
import {
  createQuoteApprovalLinkForDraft,
} from "../../lib/documents/approval";
import { appendQuoteDocumentHistory } from "../../lib/documents/history";
import {
  markQuotePreparedForCustomer,
  quoteEditableContentChanged,
  quoteRevisionMetadataAfterEditorSave,
  quoteRevisionState,
  quoteVersionedDocumentMetadata,
} from "../../lib/documents/revisions";
import { insertAuditLog } from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const QUOTE_DRAFT_STATUSES = new Set([
  "approved",
  "archived",
  "changes_requested",
  "draft",
  "ready",
  "sent",
]);

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formStringValues(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? value.trim() : ""));
}

function nullableText(value: string) {
  return value.trim() ? value.trim() : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function documentPath(quoteDraftId: string) {
  return `/files/${encodeURIComponent(quoteDraftId)}`;
}

function newDocumentPath(templateKey: string | null = null) {
  const params = new URLSearchParams();

  if (templateKey) {
    params.set("templateKey", templateKey);
  }

  const query = params.toString();

  return query ? `/files/new?${query}` : "/files/new";
}

function redirectWithDocumentsMessage(
  key: "engine_error" | "engine_message",
  message: string,
): never {
  redirect(`/files?${key}=${encodeURIComponent(message)}`);
}

function redirectWithNewDocumentMessage(
  templateKey: string | null,
  key: "engine_error" | "engine_message",
  message: string,
): never {
  const params = new URLSearchParams();

  if (templateKey) {
    params.set("templateKey", templateKey);
  }

  params.set(key, message);

  redirect(`/files/new?${params.toString()}`);
}

function redirectWithTemplateBuilderMessage(
  key: "engine_error" | "engine_message",
  message: string,
): never {
  redirect(`/files/templates/new?${key}=${encodeURIComponent(message)}`);
}

function templatePath(templateKey: string) {
  return `/files/templates/${encodeURIComponent(templateKey)}`;
}

function revalidateFilesHome() {
  revalidatePath("/files");
  revalidatePath("/documents");
}

function revalidateTemplateBuilder() {
  revalidatePath("/files/templates/new");
  revalidatePath("/documents/templates/new");
}

function redirectWithTemplateMessage(
  templateKey: string,
  key: "engine_error" | "engine_message",
  message: string,
): never {
  redirect(`${templatePath(templateKey)}?${key}=${encodeURIComponent(message)}`);
}

function redirectWithDocumentMessage(
  quoteDraftId: string,
  key: "engine_error" | "engine_message",
  message: string,
): never {
  redirect(`${documentPath(quoteDraftId)}?${key}=${encodeURIComponent(message)}`);
}

function slugValue(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "template"
  );
}

function quoteSendSubject(title: string) {
  return `Your quote: ${title}`;
}

function quoteSendBody({
  approvalUrl,
  customerName,
  jobLabel,
}: {
  approvalUrl?: string | null;
  customerName: string | null;
  jobLabel: string | null;
}) {
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";
  const scope = jobLabel
    ? ` for ${jobLabel}`
    : "";

  return [
    greeting,
    "",
    `Thanks for the opportunity. I have attached the quote${scope} for you to review.`,
    "",
    approvalUrl
      ? `You can approve the quote or request changes here: ${approvalUrl}`
      : "Please let me know if you would like anything changed, or if you are happy for us to proceed.",
    "",
    "If the link gives you any trouble, just reply to this email and I will help.",
  ].join("\n");
}

function quoteLineItemsFromForm(formData: FormData) {
  const descriptions = formStringValues(formData, "lineItemDescription");
  const quantities = formStringValues(formData, "lineItemQuantity");
  const units = formStringValues(formData, "lineItemUnit");
  const unitPrices = formStringValues(formData, "lineItemUnitPrice");
  const lineNotes = formStringValues(formData, "lineItemNotes");

  return parseQuoteLineItemRows(
    descriptions.map((description, index) => ({
      description,
      notes: lineNotes[index] ?? "",
      quantity: quantities[index] ?? "",
      unit: units[index] ?? "",
      unitPrice: unitPrices[index] ?? "",
    })),
  );
}

function quoteDraftEditorMetadataFromForm(
  formData: FormData,
  base: Record<string, unknown>,
) {
  return {
    ...base,
    customerCompany: nullableText(formString(formData, "customerCompany")),
    customerEmail: nullableText(formString(formData, "customerEmail")),
    customerName: nullableText(formString(formData, "customerName")),
    customerPhone: nullableText(formString(formData, "customerPhone")),
    jobAddress: nullableText(formString(formData, "jobAddress")),
    jobType: nullableText(formString(formData, "jobType")),
    preferredTime: nullableText(formString(formData, "preferredTime")),
    updatedFrom: "documents.editor",
  };
}

function referenceFilesFromForm(formData: FormData) {
  return formData
    .getAll("referenceFiles")
    .filter((value): value is File => value instanceof File && value.size > 0)
    .slice(0, 8)
    .map((file) => ({
      name: file.name.slice(0, 180),
      size: file.size,
      type: (file.type || "application/octet-stream").slice(0, 120),
    }));
}

function referenceFilesFromJson(formData: FormData) {
  const raw = formString(formData, "existingReferenceFiles");

  if (!raw) {
    return [] as DocumentTemplateReferenceFile[];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        const file = objectRecord(item);
        const size = Number(file.size);
        const name = nullableText(String(file.name ?? ""));

        if (!name) {
          return null;
        }

        return {
          name: name.slice(0, 180),
          size: Number.isFinite(size) ? Math.max(0, Math.round(size)) : 0,
          type: (nullableText(String(file.type ?? "")) ?? "application/octet-stream").slice(0, 120),
        };
      })
      .filter((file): file is DocumentTemplateReferenceFile => Boolean(file))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function documentTemplateDesignSettingsFromForm(formData: FormData) {
  return normalizeDocumentTemplateDesignSettings({
    accentTheme: formString(formData, "accentTheme"),
    currency: formString(formData, "currency"),
    footerText: formString(formData, "footerText"),
    paymentTerms: formString(formData, "paymentTerms"),
    quoteStyleDirection: formString(formData, "quoteStyleDirection"),
    showPreparedBy: formData.get("showPreparedBy") === "on",
    validityDays: formString(formData, "validityDays"),
  });
}

function documentTemplateFromForm(
  formData: FormData,
  options: {
    createdAt: string;
    existingReferenceFiles?: DocumentTemplateReferenceFile[];
    key: string;
    now: string;
  },
): CustomDocumentTemplate {
  const lineItems = quoteLineItemsFromForm(formData);
  const existingReferenceFiles =
    options.existingReferenceFiles ??
    (formData.has("existingReferenceFiles") ? referenceFilesFromJson(formData) : []);

  return {
    createdAt: options.createdAt,
    description:
      nullableText(formString(formData, "description")) ??
      "Custom quote template.",
    key: options.key,
    label: formString(formData, "label"),
    lineItems,
    notes: formString(formData, "notes"),
    referenceFiles: [...existingReferenceFiles, ...referenceFilesFromForm(formData)].slice(0, 8),
    revisionRequest: nullableText(formString(formData, "revisionRequest")),
    settings: documentTemplateDesignSettingsFromForm(formData),
    updatedAt: options.now,
  };
}

export async function createQuoteDraftFromTemplateAction(formData: FormData) {
  const templateKey = nullableText(formString(formData, "templateKey"));

  if (!templateKey) {
    redirectWithDocumentsMessage(
      "engine_error",
      "Create a document template before starting a quote draft.",
    );
  }

  redirect(newDocumentPath(templateKey));
}

export async function createQuoteDraftAction(formData: FormData) {
  const templateKey = nullableText(formString(formData, "templateKey"));
  const title = formString(formData, "title");
  const status = formString(formData, "status") || "draft";
  const selectedContactId = nullableText(formString(formData, "contactId"));

  if (!title) {
    redirectWithNewDocumentMessage(templateKey, "engine_error", "Title is required.");
  }

  if (!QUOTE_DRAFT_STATUSES.has(status)) {
    redirectWithNewDocumentMessage(templateKey, "engine_error", "Quote status is invalid.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const documentTemplateSettings = await getDocumentTemplateSettings(
    supabase,
    workspace.id,
  );
  const template = templateKey
    ? getQuoteTemplate(templateKey, documentTemplateSettings.customTemplates)
    : null;

  if (templateKey && (!template || template.key !== templateKey)) {
    redirectWithDocumentsMessage("engine_error", "Document template was not found.");
  }

  if (selectedContactId) {
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("id", selectedContactId)
      .maybeSingle();

    if (contactError) {
      redirectWithNewDocumentMessage(templateKey, "engine_error", contactError.message);
    }

    if (!contact) {
      redirectWithNewDocumentMessage(
        templateKey,
        "engine_error",
        "Selected customer was not found.",
      );
    }
  }

  const templateSettings = normalizeDocumentTemplateDesignSettings(
    objectRecord(template).settings ?? documentTemplateSettings,
  );
  const nextLineItems = quoteLineItemsFromForm(formData);
  const nextNotes = nullableText(formString(formData, "notes"));
  const nextMetadata = quoteDraftEditorMetadataFromForm(formData, {
    documentTemplateReferenceFiles:
      template && "referenceFiles" in template
        ? objectRecord(template).referenceFiles
        : [],
    documentTemplateSettings: templateSettings,
    dryRun: true,
    quoteRevision: {
      currentVersion: 1,
      status: "draft",
    },
    source: template ? "document.template" : "documents.editor",
    templateKey: template?.key ?? null,
  });

  const { data: quoteDraft, error } = await supabase
    .from("quote_drafts")
    .insert({
      contact_id: selectedContactId,
      line_items: nextLineItems,
      metadata: nextMetadata,
      notes: nextNotes,
      status,
      title,
      workspace_id: workspace.id,
    })
    .select("id,title,status")
    .single();

  if (error || !quoteDraft) {
    redirectWithNewDocumentMessage(
      templateKey,
      "engine_error",
      error?.message ?? "Unable to save quote draft.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: template ? "quote_draft.created_from_template" : "quote_draft.created",
    entityType: "quote_draft",
    entityId: String(quoteDraft.id),
    after: {
      lineItems: nextLineItems,
      metadata: nextMetadata,
      notes: nextNotes,
      status: quoteDraft.status,
      templateKey: template?.key ?? null,
      title: quoteDraft.title,
    },
  });

  revalidateFilesHome();
  redirectWithDocumentMessage(
    String(quoteDraft.id),
    "engine_message",
    "Quote draft saved.",
  );
}

export async function applyQuoteTemplateAction(formData: FormData) {
  const quoteDraftId = formString(formData, "quoteDraftId");

  if (!quoteDraftId) {
    redirect("/files?engine_error=Quote draft id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const documentTemplateSettings = await getDocumentTemplateSettings(
    supabase,
    workspace.id,
  );
  const template = getQuoteTemplate(
    formString(formData, "templateKey"),
    documentTemplateSettings.customTemplates,
  );

  if (!template) {
    redirectWithDocumentMessage(
      quoteDraftId,
      "engine_error",
      "Create a document template before applying a structure.",
    );
  }

  const templateSettings = normalizeDocumentTemplateDesignSettings(
    objectRecord(template).settings ?? documentTemplateSettings,
  );
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

  const title = draftTitleFromTemplate(template);
  const nextMetadata = {
    ...objectRecord(before.metadata),
    documentTemplateReferenceFiles:
      "referenceFiles" in template
        ? objectRecord(template).referenceFiles
        : [],
    documentTemplateSettings: templateSettings,
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
      title,
    },
  });

  revalidateFilesHome();
  revalidatePath(documentPath(quoteDraftId));
  redirectWithDocumentMessage(quoteDraftId, "engine_message", "Template applied.");
}

export async function createDocumentTemplateAction(formData: FormData) {
  const label = formString(formData, "label");

  if (!label) {
    redirectWithTemplateBuilderMessage("engine_error", "Template name is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithTemplateBuilderMessage("engine_error", beforeError.message);
  }

  const beforeSettings = normalizeDocumentTemplateSettings(beforePolicy?.settings);
  const now = new Date().toISOString();
  const key = `custom_${slugValue(label)}_${Date.now().toString(36)}`;
  const template = documentTemplateFromForm(formData, {
    createdAt: now,
    key,
    now,
  });
  const settings = normalizeDocumentTemplateSettings({
    ...beforeSettings,
    customTemplates: [...beforeSettings.customTemplates, template],
  });

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithTemplateBuilderMessage(
      "engine_error",
      saveError?.message ?? "Unable to save document template.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "document_template.created",
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    after: { templateKey: template.key, templateLabel: template.label },
    metadata: {
      policyType: DOCUMENT_TEMPLATE_POLICY_TYPE,
      referenceFileCount: template.referenceFiles.length,
    },
  });

  revalidateFilesHome();
  revalidateTemplateBuilder();
  revalidatePath(templatePath(template.key));
  redirectWithTemplateMessage(template.key, "engine_message", "Document template created.");
}

export async function updateDocumentTemplateAction(formData: FormData) {
  const templateKey = formString(formData, "templateKey");
  const label = formString(formData, "label");

  if (!templateKey) {
    redirectWithDocumentsMessage("engine_error", "Template id is required.");
  }

  if (!label) {
    redirectWithTemplateMessage(templateKey, "engine_error", "Template name is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithTemplateMessage(templateKey, "engine_error", beforeError.message);
  }

  const beforeSettings = normalizeDocumentTemplateSettings(beforePolicy?.settings);
  const existingTemplate = beforeSettings.customTemplates.find(
    (template) => template.key === templateKey,
  );

  if (!existingTemplate) {
    redirectWithDocumentsMessage("engine_error", "Document template was not found.");
  }

  const now = new Date().toISOString();
  const existingReferenceFiles = formData.has("existingReferenceFiles")
    ? referenceFilesFromJson(formData)
    : existingTemplate.referenceFiles;
  const template = documentTemplateFromForm(formData, {
    createdAt: existingTemplate.createdAt,
    existingReferenceFiles,
    key: existingTemplate.key,
    now,
  });
  const settings = normalizeDocumentTemplateSettings({
    ...beforeSettings,
    customTemplates: beforeSettings.customTemplates.map((item) =>
      item.key === templateKey ? template : item,
    ),
  });

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithTemplateMessage(
      templateKey,
      "engine_error",
      saveError?.message ?? "Unable to save document template.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "document_template.updated",
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: { template: existingTemplate },
    after: { template },
    metadata: {
      policyType: DOCUMENT_TEMPLATE_POLICY_TYPE,
      referenceFileCount: template.referenceFiles.length,
      templateKey: template.key,
    },
  });

  revalidateFilesHome();
  revalidatePath(templatePath(template.key));
  redirectWithTemplateMessage(template.key, "engine_message", "Document template saved.");
}

export async function updateQuoteDraftAction(formData: FormData) {
  const quoteDraftId = formString(formData, "quoteDraftId");
  const title = formString(formData, "title");
  const status = formString(formData, "status") || "draft";
  const selectedContactId = nullableText(formString(formData, "contactId"));

  if (!quoteDraftId) {
    redirect("/files?engine_error=Quote draft id is required.");
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
    .select(
      "id,title,status,line_items,notes,metadata,contact_id,conversation_id,lead_id",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (beforeError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", beforeError.message);
  }

  if (!before) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Quote draft was not found.");
  }

  if (selectedContactId) {
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("id", selectedContactId)
      .maybeSingle();

    if (contactError) {
      redirectWithDocumentMessage(quoteDraftId, "engine_error", contactError.message);
    }

    if (!contact) {
      redirectWithDocumentMessage(
        quoteDraftId,
        "engine_error",
        "Selected customer was not found.",
      );
    }
  }

  const editorMetadata = quoteDraftEditorMetadataFromForm(
    formData,
    objectRecord(before.metadata),
  );
  const nextLineItems = quoteLineItemsFromForm(formData);
  const nextNotes = nullableText(formString(formData, "notes"));
  const contentChanged = quoteEditableContentChanged(
    {
      contactId: before.contact_id ? String(before.contact_id) : null,
      lineItems: before.line_items,
      metadata: objectRecord(before.metadata),
      notes: textValue(before.notes),
      title: String(before.title),
    },
    {
      contactId: selectedContactId ?? (before.contact_id ? String(before.contact_id) : null),
      lineItems: nextLineItems,
      metadata: editorMetadata,
      notes: nextNotes,
      title,
    },
  );
  const nextMetadata = quoteRevisionMetadataAfterEditorSave({
    at: new Date().toISOString(),
    beforeMetadata: objectRecord(before.metadata),
    contentChanged,
    nextMetadata: editorMetadata,
    previousStatus: String(before.status),
  });
  const nextStatus =
    String(before.status) === "changes_requested" && contentChanged && status === "changes_requested"
      ? "draft"
      : status;

  const { error: updateError } = await supabase
    .from("quote_drafts")
    .update({
      contact_id: selectedContactId ?? before.contact_id ?? null,
      line_items: nextLineItems,
      metadata: nextMetadata,
      notes: nextNotes,
      status: nextStatus,
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
      status: nextStatus,
      title,
    },
    metadata: {
      contactId: selectedContactId ?? before.contact_id ?? null,
      conversationId: before.conversation_id ? String(before.conversation_id) : null,
      contentChanged,
      leadId: before.lead_id ? String(before.lead_id) : null,
      quoteVersion: quoteRevisionState(nextMetadata).currentVersion,
    },
  });

  revalidateFilesHome();
  revalidatePath(documentPath(quoteDraftId));

  if (before.conversation_id) {
    revalidatePath(`/inbox/${before.conversation_id}`);
  }

  redirectWithDocumentMessage(quoteDraftId, "engine_message", "Quote draft saved.");
}

export async function prepareQuoteDraftSendAction(formData: FormData) {
  const quoteDraftId = formString(formData, "quoteDraftId");

  if (!quoteDraftId) {
    redirect("/files?engine_error=Quote draft id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: quoteDraft, error: quoteDraftError } = await supabase
    .from("quote_drafts")
    .select(
      "id,title,status,metadata,contact_id,conversation_id,lead_id",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (quoteDraftError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", quoteDraftError.message);
  }

  if (!quoteDraft) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Quote draft was not found.");
  }

  const conversationId = textValue(quoteDraft.conversation_id);

  if (!conversationId) {
    redirectWithDocumentMessage(
      quoteDraftId,
      "engine_error",
      "Link this quote draft to an inquiry before sending it to a customer.",
    );
  }

  const [contactResult, leadResult] = await Promise.all([
    quoteDraft.contact_id
      ? supabase
          .from("contacts")
          .select("name,email,company")
          .eq("workspace_id", workspace.id)
          .eq("id", quoteDraft.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    quoteDraft.lead_id
      ? supabase
          .from("leads")
          .select("title,service_type")
          .eq("workspace_id", workspace.id)
          .eq("id", quoteDraft.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (contactResult.error) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", contactResult.error.message);
  }

  if (leadResult.error) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", leadResult.error.message);
  }

  const contact = objectRecord(contactResult.data);
  const lead = objectRecord(leadResult.data);
  const metadata = objectRecord(quoteDraft.metadata);
  const revisionState = quoteRevisionState(metadata);
  const customerEmail =
    textValue(contact.email) ?? textValue(metadata.customerEmail);

  if (String(quoteDraft.status) === "changes_requested" || revisionState.pendingChangeRequest) {
    redirectWithDocumentMessage(
      quoteDraftId,
      "engine_error",
      "Review the requested changes, edit and save the quote, then send the revised version.",
    );
  }

  if (!customerEmail) {
    redirectWithDocumentMessage(
      quoteDraftId,
      "engine_error",
      "The linked customer needs an email address before Kyro can prepare this send.",
    );
  }

  const pending = await supabase
    .from("actions")
    .select("id,input")
    .eq("workspace_id", workspace.id)
    .eq("type", "draft_reply")
    .eq("target_type", "conversation")
    .eq("target_id", conversationId)
    .in("status", ["pending_approval", "approved"])
    .limit(25);

  if (pending.error) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", pending.error.message);
  }

  const duplicateAction = (pending.data ?? []).find((action) => {
    const input = objectRecord(action.input);

    return textValue(input.attachmentQuoteDraftId) === quoteDraftId;
  });

  if (duplicateAction) {
    redirect(
      `/inbox/${encodeURIComponent(conversationId)}?engine_message=${encodeURIComponent(
        "A quote email is already prepared for this draft. Review it before creating another one.",
      )}`,
    );
  }

  const approvalLink = await createQuoteApprovalLinkForDraft(supabase, {
    actorId: user.id,
    actorType: "user",
    customerEmail,
    quoteDraftId,
    source: "documents.prepare_quote_send",
    workspaceId: workspace.id,
  });
  const artifact = await buildQuotePdfArtifactForDraft(supabase, {
    quoteDraftId,
    workspace,
  });
  const generatedDocument = await recordQuoteGeneratedDocument(supabase, {
    artifact,
    createdByUserId: user.id,
    documentType: "quote",
    quoteDraft,
    source: "documents.prepare_quote_send",
    workspaceId: workspace.id,
  });
  const documentMetadata = quoteVersionedDocumentMetadata(
    {
      ...quotePdfMetadata(artifact),
      ...generatedDocumentMetadata(generatedDocument),
    },
    metadata,
  );
  const customerName =
    textValue(metadata.customerName) ??
    textValue(contact.name) ??
    textValue(contact.company);
  const jobLabel =
    textValue(metadata.jobType) ??
    textValue(lead.service_type) ??
    textValue(lead.title) ??
    String(quoteDraft.title);
  const subject =
    revisionState.currentVersion > 1
      ? `Your revised quote: ${String(quoteDraft.title)}`
      : quoteSendSubject(String(quoteDraft.title));
  const body = quoteSendBody({
    approvalUrl: approvalLink.url,
    customerName,
    jobLabel,
  });

  const { data: action, error: actionError } = await supabase
    .from("actions")
    .insert({
      workspace_id: workspace.id,
      type: "draft_reply",
      status: "pending_approval",
      requested_by: "user",
      approval_required: true,
      target_type: "conversation",
      target_id: conversationId,
      input: {
        attachmentQuoteDraftId: quoteDraftId,
        approvalLinkId: approvalLink.approvalLink.id,
        approvalUrl: approvalLink.url,
        body,
        channelType: "email",
        generatedDocument: documentMetadata,
        generatedDocumentId: generatedDocument.id,
        quoteDraftId,
        settingsSnapshot: {
          approvalRequired: true,
          generatedDocument: documentMetadata,
          generatedDocumentId: generatedDocument.id,
          quoteApprovalLinkId: approvalLink.approvalLink.id,
          source: "documents.prepare_quote_send",
        },
        signatureVariant: "ai_generated",
        source: "documents.prepare_quote_send",
        subject,
      },
      policy_snapshot: {
        mode: "require_approval",
        reason: "Customer-facing document sends require user review.",
        source: "documents.prepare_quote_send",
      },
    })
    .select("id")
    .single();

  if (actionError || !action) {
    redirectWithDocumentMessage(
      quoteDraftId,
      "engine_error",
      actionError?.message ?? "Unable to prepare quote email.",
    );
  }

  const preparedMetadata = markQuotePreparedForCustomer({
    approvalLinkId: approvalLink.approvalLink.id,
    at: String(documentMetadata.generatedAt),
    contentHash: textValue(documentMetadata.contentHash),
    metadata: {
      ...metadata,
      lastGeneratedDocument: documentMetadata,
      preparedSendActionId: String(action.id),
      preparedSendAt: documentMetadata.generatedAt,
    },
    source: "documents.prepare_quote_send",
  });
  const nextMetadata = appendQuoteDocumentHistory(
    preparedMetadata,
    {
      actionId: String(action.id),
      actorType: "user",
      contentHash: textValue(documentMetadata.contentHash),
      document: documentMetadata,
      kind: "email_prepared",
      occurredAt: documentMetadata.generatedAt,
      quoteVersion: quoteRevisionState(preparedMetadata).currentVersion,
      source: "documents.prepare_quote_send",
    },
  );
  const { error: updateError } = await supabase
    .from("quote_drafts")
    .update({
      metadata: nextMetadata,
      status:
        String(quoteDraft.status) === "draft" ||
        String(quoteDraft.status) === "changes_requested"
          ? "ready"
          : quoteDraft.status,
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
    action: "quote_draft.send_prepared",
    entityType: "quote_draft",
    entityId: quoteDraftId,
    before: {
      metadata,
      status: quoteDraft.status,
    },
    after: {
      actionId: String(action.id),
      document: documentMetadata,
      metadata: nextMetadata,
      status:
        String(quoteDraft.status) === "draft" ||
        String(quoteDraft.status) === "changes_requested"
          ? "ready"
          : quoteDraft.status,
    },
    metadata: {
      conversationId,
      customerEmail,
      quoteApprovalLinkId: approvalLink.approvalLink.id,
      quoteVersion: quoteRevisionState(preparedMetadata).currentVersion,
      source: "documents.prepare_quote_send",
    },
  });

  revalidateFilesHome();
  revalidatePath(documentPath(quoteDraftId));
  revalidatePath(`/inbox/${conversationId}`);
  redirect(
    `/inbox/${encodeURIComponent(conversationId)}?engine_message=${encodeURIComponent(
      "Quote email prepared. Review the message and send it when ready.",
    )}`,
  );
}

export async function generateInvoiceDocumentAction(formData: FormData) {
  const quoteDraftId = formString(formData, "quoteDraftId");

  if (!quoteDraftId) {
    redirect("/files?engine_error=Quote draft id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: quoteDraft, error: quoteDraftError } = await supabase
    .from("quote_drafts")
    .select("id,title,status,metadata,contact_id,conversation_id,lead_id")
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (quoteDraftError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", quoteDraftError.message);
  }

  if (!quoteDraft) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Quote draft was not found.");
  }

  let failureMessage: string | null = null;

  try {
    const artifact = await buildInvoicePdfArtifactForDraft(supabase, {
      quoteDraftId,
      workspace,
    });
    const generatedDocument = await recordQuoteGeneratedDocument(supabase, {
      artifact,
      createdByUserId: user.id,
      documentType: "invoice",
      quoteDraft,
      source: "documents.generate_invoice",
      workspaceId: workspace.id,
    });

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "generated_document.invoice_generated",
      entityType: "generated_document",
      entityId: generatedDocument.id,
      after: {
        documentType: generatedDocument.documentType,
        filename: generatedDocument.filename,
        quoteDraftId,
        status: generatedDocument.lifecycleStatus,
      },
      metadata: {
        source: "documents.generate_invoice",
      },
    });

    revalidateFilesHome();
    revalidatePath(documentPath(quoteDraftId));
  } catch (error) {
    failureMessage =
      error instanceof Error ? error.message : "Unable to generate invoice PDF.";
  }

  if (failureMessage) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", failureMessage);
  }

  redirectWithDocumentMessage(
    quoteDraftId,
    "engine_message",
    "Invoice PDF generated and saved.",
  );
}

export async function fileGeneratedDocumentToDriveAction(formData: FormData) {
  const generatedDocumentId = formString(formData, "generatedDocumentId");
  const quoteDraftId = nullableText(formString(formData, "quoteDraftId"));

  if (!generatedDocumentId) {
    redirectWithDocumentsMessage("engine_error", "Generated document id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  let failureMessage: string | null = null;

  try {
    await fileGeneratedDocumentToGoogleDrive(supabase, {
      generatedDocumentId,
      userId: user.id,
      workspaceId: workspace.id,
    });

    revalidateFilesHome();

    if (quoteDraftId) {
      revalidatePath(documentPath(quoteDraftId));
    }
  } catch (error) {
    failureMessage =
      error instanceof Error
        ? error.message
        : "Unable to file document to Google Drive.";
  }

  if (failureMessage && quoteDraftId) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", failureMessage);
  }

  if (failureMessage) {
    redirectWithDocumentsMessage("engine_error", failureMessage);
  }

  if (quoteDraftId) {
    redirectWithDocumentMessage(
      quoteDraftId,
      "engine_message",
      "Document filed to Google Drive.",
    );
  }

  redirectWithDocumentsMessage(
    "engine_message",
    "Document filed to Google Drive.",
  );
}

export async function createQuoteApprovalLinkAction(formData: FormData) {
  const quoteDraftId = formString(formData, "quoteDraftId");

  if (!quoteDraftId) {
    redirect("/files?engine_error=Quote draft id is required.");
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: quoteDraft, error } = await supabase
    .from("quote_drafts")
    .select("id,title,metadata,contact_id")
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId)
    .maybeSingle();

  if (error) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", error.message);
  }

  if (!quoteDraft) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", "Quote draft was not found.");
  }

  const metadata = objectRecord(quoteDraft.metadata);
  const contactResult = quoteDraft.contact_id
    ? await supabase
        .from("contacts")
        .select("email")
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraft.contact_id)
        .maybeSingle()
    : { data: null, error: null };

  if (contactResult.error) {
    redirectWithDocumentMessage(
      quoteDraftId,
      "engine_error",
      contactResult.error.message,
    );
  }

  const customerEmail =
    textValue(contactResult.data?.email) ?? textValue(metadata.customerEmail);

  const approvalLink = await createQuoteApprovalLinkForDraft(supabase, {
    actorId: user.id,
    actorType: "user",
    customerEmail,
    quoteDraftId,
    source: "documents.manual_approval_link",
    workspaceId: workspace.id,
  });

  const nextMetadata = {
    ...metadata,
    quoteApprovalLinkId: approvalLink.approvalLink.id,
  };

  const { error: updateError } = await supabase
    .from("quote_drafts")
    .update({ metadata: nextMetadata })
    .eq("workspace_id", workspace.id)
    .eq("id", quoteDraftId);

  if (updateError) {
    redirectWithDocumentMessage(quoteDraftId, "engine_error", updateError.message);
  }

  revalidatePath(documentPath(quoteDraftId));
  redirect(
    `${documentPath(quoteDraftId)}?engine_message=${encodeURIComponent(
      "Customer approval link created.",
    )}&approval_token=${encodeURIComponent(approvalLink.token)}`,
  );
}

export async function updateDocumentTemplateSettingsAction(formData: FormData) {
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const accentTheme = formString(formData, "accentTheme");
  const currency = formString(formData, "currency");

  if (!DOCUMENT_ACCENT_THEMES.some((theme) => theme === accentTheme)) {
    redirectWithDocumentsMessage(
      "engine_error",
      "Choose a valid document accent.",
    );
  }

  if (!DOCUMENT_CURRENCIES.some((option) => option === currency)) {
    redirectWithDocumentsMessage(
      "engine_error",
      "Choose a valid document currency.",
    );
  }

  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirectWithDocumentsMessage("engine_error", beforeError.message);
  }

  const beforeSettings = normalizeDocumentTemplateSettings(beforePolicy?.settings);
  const settings = normalizeDocumentTemplateSettings({
    ...beforeSettings,
    accentTheme,
    currency,
    footerText: formString(formData, "footerText"),
    paymentTerms: formString(formData, "paymentTerms"),
    quoteStyleDirection: formString(formData, "quoteStyleDirection"),
    showPreparedBy: formData.get("showPreparedBy") === "on",
    validityDays: formString(formData, "validityDays"),
  });

  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirectWithDocumentsMessage(
      "engine_error",
      saveError?.message ?? "Unable to save document template settings.",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "document_template_settings.updated",
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    after: { settings },
    metadata: {
      policyType: DOCUMENT_TEMPLATE_POLICY_TYPE,
    },
  });

  revalidateFilesHome();
  redirectWithDocumentsMessage(
    "engine_message",
    "Document template direction saved.",
  );
}

export async function updateDefaultInvoiceTemplateAction(formData: FormData) {
  const templateKey = nullableText(formString(formData, "defaultInvoiceTemplateKey"));
  const returnTo = formString(formData, "returnTo");
  const redirectPath =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/payments";
  const { supabase, user, workspace } = await requireWorkspaceContext();
  const { data: beforePolicy, error: beforeError } = await supabase
    .from("workspace_policies")
    .select("id,settings")
    .eq("workspace_id", workspace.id)
    .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
    .maybeSingle();

  if (beforeError) {
    redirect(
      `${redirectPath}?engine_error=${encodeURIComponent(beforeError.message)}`,
    );
  }

  const beforeSettings = normalizeDocumentTemplateSettings(beforePolicy?.settings);
  const template = templateKey
    ? getQuoteTemplate(templateKey, beforeSettings.customTemplates)
    : null;

  if (templateKey && !template) {
    redirect(
      `${redirectPath}?engine_error=${encodeURIComponent(
        "Choose an existing document template for invoices.",
      )}`,
    );
  }

  const settings = normalizeDocumentTemplateSettings({
    ...beforeSettings,
    defaultInvoiceTemplateKey: template?.key ?? null,
  });
  const { data: savedPolicy, error: saveError } = await supabase
    .from("workspace_policies")
    .upsert(
      {
        policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
        settings,
        workspace_id: workspace.id,
      },
      {
        onConflict: "workspace_id,policy_type",
      },
    )
    .select("id")
    .single();

  if (saveError || !savedPolicy) {
    redirect(
      `${redirectPath}?engine_error=${encodeURIComponent(
        saveError?.message ?? "Unable to save the default invoice template.",
      )}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    action: "document_template.default_invoice_updated",
    entityType: "workspace_policy",
    entityId: String(savedPolicy.id),
    before: beforePolicy ? { settings: beforePolicy.settings } : null,
    after: {
      defaultInvoiceTemplateKey: settings.defaultInvoiceTemplateKey,
      defaultInvoiceTemplateLabel: template?.label ?? null,
    },
    metadata: {
      policyType: DOCUMENT_TEMPLATE_POLICY_TYPE,
    },
  });

  revalidateFilesHome();
  revalidatePath("/payments");
  revalidatePath("/settings");
  redirect(
    `${redirectPath}?engine_message=${encodeURIComponent(
      template ? "Default invoice template saved." : "Default invoice template cleared.",
    )}`,
  );
}
