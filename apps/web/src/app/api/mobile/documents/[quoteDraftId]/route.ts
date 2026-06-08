import { getQuoteDraftProfile } from "../../../../../lib/crm/queries";
import { createQuoteApprovalLinkForDraft, getLatestQuoteApprovalLinkForDraft, isQuoteApprovalLinkExpired, quoteApprovalPublicUrl } from "../../../../../lib/documents/approval";
import { appendQuoteDocumentHistory, quoteDocumentChangedSinceLastEvent, quoteDocumentContentHash, quoteDocumentHistory, type QuoteDocumentHistoryEvent } from "../../../../../lib/documents/history";
import { buildQuotePdfArtifactForDraft, quotePdfMetadata } from "../../../../../lib/documents/pdf";
import { documentTemplateDesignSettingsForQuote, getDocumentTemplateSettings, normalizeDocumentTemplateDesignSettings } from "../../../../../lib/documents/settings";
import { getQuoteTemplate, normalizeQuoteLineItems } from "../../../../../lib/documents/templates";
import { markQuotePreparedForCustomer, quoteEditableContentChanged, quoteRevisionLabel, quoteRevisionMetadataAfterEditorSave, quoteRevisionState, quoteVersionedDocumentMetadata } from "../../../../../lib/documents/revisions";
import { insertAuditLog } from "../../../../../lib/engine/event-action-audit";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUOTE_DRAFT_STATUSES = new Set([
  "approved",
  "archived",
  "changes_requested",
  "draft",
  "ready",
  "sent",
]);

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeLineItems(value: unknown) {
  return normalizeQuoteLineItems(Array.isArray(value) ? value : []).slice(0, 60);
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
  const scope = jobLabel ? ` for ${jobLabel}` : "";

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

function documentEventLabel(event: QuoteDocumentHistoryEvent) {
  if (event.kind === "customer_approved") {
    return "Customer approved";
  }

  if (event.kind === "customer_changes_requested") {
    return "Customer requested changes";
  }

  if (event.kind === "customer_viewed") {
    return "Customer viewed";
  }

  if (event.kind === "email_sent") {
    return "Sent to customer";
  }

  if (event.kind === "email_prepared") {
    return "Email prepared";
  }

  return "PDF generated";
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function documentEventMeta(event: QuoteDocumentHistoryEvent) {
  const details = [
    event.quoteVersion ? `v${event.quoteVersion}` : null,
    event.sentTo ? `to ${event.sentTo}` : null,
    event.channelType ? formatLabel(event.channelType) : null,
  ].filter(Boolean);

  return details.join(" - ") || textValue(event.source) || "Kyro document";
}

async function quoteDetailPayload({
  request,
  quoteDraftId,
  approvalToken,
  message,
}: {
  approvalToken?: string | null;
  message?: string;
  quoteDraftId: string;
  request: Request;
}) {
  const { supabase, workspace } = await requireMobileWorkspaceContext(request);
  const [profile, documentTemplateSettings, latestApprovalLink] =
    await Promise.all([
      getQuoteDraftProfile(supabase, workspace.id, quoteDraftId),
      getDocumentTemplateSettings(supabase, workspace.id),
      getLatestQuoteApprovalLinkForDraft(supabase, {
        quoteDraftId,
        workspaceId: workspace.id,
      }),
    ]);

  if (!profile) {
    return Response.json({ error: "Quote draft was not found." }, { status: 404 });
  }

  const quoteDraft = profile.quoteDraft;
  const settings = documentTemplateDesignSettingsForQuote(
    quoteDraft.metadata,
    documentTemplateSettings,
  );
  const history = quoteDocumentHistory(quoteDraft.metadata);
  const currentContentHash = quoteDocumentContentHash({ profile, settings });
  const freshness = quoteDocumentChangedSinceLastEvent({
    currentContentHash,
    history,
  });
  const revision = quoteRevisionState(quoteDraft.metadata);
  const lineItems = sanitizeLineItems(quoteDraft.lineItems);
  const subtotal = lineItems.reduce((sum, item) => {
    if (typeof item.total !== "number") {
      return sum;
    }

    return sum + item.total;
  }, 0);
  const customerLabel =
    textValue(quoteDraft.metadata.customerName) ??
    quoteDraft.contact?.name ??
    quoteDraft.contact?.company ??
    textValue(quoteDraft.metadata.customerCompany) ??
    "Customer";
  const jobLabel =
    textValue(quoteDraft.metadata.jobType) ??
    profile.inquiryFacts?.jobType ??
    quoteDraft.lead?.serviceType ??
    quoteDraft.lead?.title ??
    "Job";

  return Response.json({
    ...(message ? { message } : {}),
    approval: latestApprovalLink
      ? {
          approvedAt: latestApprovalLink.approvedAt,
          changesRequestedAt: latestApprovalLink.changesRequestedAt,
          customerEmail: latestApprovalLink.customerEmail,
          expiresAt: latestApprovalLink.expiresAt,
          id: latestApprovalLink.id,
          lastChangeRequest: latestApprovalLink.lastChangeRequest,
          status: isQuoteApprovalLinkExpired(latestApprovalLink)
            ? "expired"
            : latestApprovalLink.status,
          ...(approvalToken
            ? {
                token: approvalToken,
                url: quoteApprovalPublicUrl(approvalToken),
              }
            : {}),
          viewedAt: latestApprovalLink.viewedAt,
        }
      : null,
    auditLogs: profile.auditLogs,
    documentFreshness: {
      changed: freshness.changed,
      latestAt: freshness.latest?.occurredAt ?? null,
      latestKind: freshness.latest?.kind ?? null,
    },
    history: history.slice(0, 12).map((event) => ({
      kind: event.kind,
      label: documentEventLabel(event),
      meta: documentEventMeta(event),
      occurredAt: event.occurredAt,
      quoteVersion: event.quoteVersion ?? null,
    })),
    messages: profile.messages.map((item) => ({
      bodyText: item.bodyText,
      createdAt: item.createdAt,
      direction: item.direction,
      id: item.id,
      subject: item.subject,
    })),
    preview: {
      currency: settings.currency,
      customerLabel,
      jobLabel,
      subtotal: subtotal > 0 ? Math.round(subtotal * 100) / 100 : null,
      validityDays: settings.validityDays,
    },
    quoteDraft: {
      ...quoteDraft,
      lineItems,
    },
    revision: {
      currentVersion: revision.currentVersion,
      label: quoteRevisionLabel(quoteDraft.metadata),
      needsRevision: revision.needsRevision,
      pendingChangeRequest: revision.pendingChangeRequest,
    },
    settings,
    templates: documentTemplateSettings.customTemplates.map((template) => ({
      createdAt: template.createdAt,
      description: template.description,
      key: template.key,
      label: template.label,
      lineItems: sanitizeLineItems(template.lineItems),
      notes: template.notes,
      settings: normalizeDocumentTemplateDesignSettings(template.settings),
      updatedAt: template.updatedAt,
    })),
    workspace,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ quoteDraftId: string }> },
) {
  try {
    const { quoteDraftId } = await params;
    return quoteDetailPayload({ quoteDraftId, request });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ quoteDraftId: string }> },
) {
  try {
    const { quoteDraftId } = await params;
    const { supabase, user, workspace } = await requireMobileWorkspaceContext(request);
    const body = objectRecord(await request.json().catch(() => ({})));
    const operation = textValue(body.operation) ?? "update_quote";
    let message = "Quote updated.";
    let approvalToken: string | null = null;

    if (operation === "update_quote") {
      const { data: before, error: beforeError } = await supabase
        .from("quote_drafts")
        .select("id,title,status,line_items,notes,metadata,contact_id,conversation_id,lead_id")
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId)
        .maybeSingle();

      if (beforeError) {
        return Response.json({ error: beforeError.message }, { status: 400 });
      }

      if (!before) {
        return Response.json({ error: "Quote draft was not found." }, { status: 404 });
      }

      const title = textValue(body.title) ?? String(before.title);
      const status = textValue(body.status) ?? String(before.status);

      if (!QUOTE_DRAFT_STATUSES.has(status)) {
        return Response.json({ error: "Quote status is invalid." }, { status: 400 });
      }

      const selectedContactId = textValue(body.contactId) ?? textValue(before.contact_id);
      const editorMetadata = {
        ...objectRecord(before.metadata),
        customerCompany: textValue(body.customerCompany),
        customerEmail: textValue(body.customerEmail),
        customerName: textValue(body.customerName),
        customerPhone: textValue(body.customerPhone),
        jobAddress: textValue(body.jobAddress),
        jobType: textValue(body.jobType),
        preferredTime: textValue(body.preferredTime),
        updatedFrom: "mobile.documents",
      };
      const lineItems = sanitizeLineItems(body.lineItems);
      const notes = textValue(body.notes);
      const contentChanged = quoteEditableContentChanged(
        {
          contactId: textValue(before.contact_id),
          lineItems: before.line_items,
          metadata: objectRecord(before.metadata),
          notes: textValue(before.notes),
          title: String(before.title),
        },
        {
          contactId: selectedContactId,
          lineItems,
          metadata: editorMetadata,
          notes,
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
        String(before.status) === "changes_requested" &&
        contentChanged &&
        status === "changes_requested"
          ? "draft"
          : status;
      const { error: updateError } = await supabase
        .from("quote_drafts")
        .update({
          contact_id: selectedContactId,
          line_items: lineItems,
          metadata: nextMetadata,
          notes,
          status: nextStatus,
          title,
        })
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId);

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 400 });
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
          lineItems,
          metadata: nextMetadata,
          notes,
          status: nextStatus,
          title,
        },
        metadata: {
          contentChanged,
          source: "mobile.documents",
          quoteVersion: quoteRevisionState(nextMetadata).currentVersion,
        },
      });
      message = "Quote draft saved.";
    } else if (operation === "apply_template") {
      const documentTemplateSettings = await getDocumentTemplateSettings(
        supabase,
        workspace.id,
      );
      const template = getQuoteTemplate(
        textValue(body.templateKey),
        documentTemplateSettings.customTemplates,
      );

      if (!template) {
        return Response.json({ error: "Document template was not found." }, { status: 404 });
      }

      const { data: before, error: beforeError } = await supabase
        .from("quote_drafts")
        .select("id,title,line_items,notes,metadata")
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId)
        .maybeSingle();

      if (beforeError || !before) {
        return Response.json(
          { error: beforeError?.message ?? "Quote draft was not found." },
          { status: beforeError ? 400 : 404 },
        );
      }

      const nextMetadata = {
        ...objectRecord(before.metadata),
        documentTemplateReferenceFiles:
          "referenceFiles" in template ? template.referenceFiles : [],
        documentTemplateSettings: normalizeDocumentTemplateDesignSettings(
          "settings" in template ? template.settings : documentTemplateSettings,
        ),
        jobType: template.label,
        templateAppliedAt: new Date().toISOString(),
        templateKey: template.key,
        updatedFrom: "mobile.documents",
      };
      const { error: updateError } = await supabase
        .from("quote_drafts")
        .update({
          line_items: sanitizeLineItems(template.lineItems),
          metadata: nextMetadata,
          notes: template.notes,
          title: textValue(body.title) ?? String(before.title),
        })
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId);

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 400 });
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
          title: textValue(body.title) ?? String(before.title),
        },
      });
      message = "Template applied.";
    } else if (operation === "create_approval_link") {
      const { data: quoteDraft, error } = await supabase
        .from("quote_drafts")
        .select("id,title,metadata,contact_id")
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId)
        .maybeSingle();

      if (error || !quoteDraft) {
        return Response.json(
          { error: error?.message ?? "Quote draft was not found." },
          { status: error ? 400 : 404 },
        );
      }

      const contactResult = quoteDraft.contact_id
        ? await supabase
            .from("contacts")
            .select("email")
            .eq("workspace_id", workspace.id)
            .eq("id", quoteDraft.contact_id)
            .maybeSingle()
        : { data: null, error: null };

      if (contactResult.error) {
        return Response.json({ error: contactResult.error.message }, { status: 400 });
      }

      const metadata = objectRecord(quoteDraft.metadata);
      const approvalLink = await createQuoteApprovalLinkForDraft(supabase, {
        actorId: user.id,
        actorType: "user",
        customerEmail:
          textValue(contactResult.data?.email) ?? textValue(metadata.customerEmail),
        quoteDraftId,
        source: "mobile.documents.approval_link",
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
        return Response.json({ error: updateError.message }, { status: 400 });
      }

      approvalToken = approvalLink.token;
      message = "Customer approval link created.";
    } else if (operation === "prepare_send") {
      const { data: quoteDraft, error: quoteDraftError } = await supabase
        .from("quote_drafts")
        .select("id,title,status,metadata,contact_id,conversation_id,lead_id")
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId)
        .maybeSingle();

      if (quoteDraftError || !quoteDraft) {
        return Response.json(
          { error: quoteDraftError?.message ?? "Quote draft was not found." },
          { status: quoteDraftError ? 400 : 404 },
        );
      }

      const conversationId = textValue(quoteDraft.conversation_id);

      if (!conversationId) {
        return Response.json(
          { error: "Link this quote draft to an inquiry before sending it to a customer." },
          { status: 400 },
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

      if (contactResult.error || leadResult.error) {
        return Response.json(
          { error: contactResult.error?.message ?? leadResult.error?.message },
          { status: 400 },
        );
      }

      const metadata = objectRecord(quoteDraft.metadata);
      const revisionState = quoteRevisionState(metadata);

      if (
        String(quoteDraft.status) === "changes_requested" ||
        revisionState.pendingChangeRequest
      ) {
        return Response.json(
          {
            error:
              "Review the requested changes, edit and save the quote, then send the revised version.",
          },
          { status: 400 },
        );
      }

      const contact = objectRecord(contactResult.data);
      const lead = objectRecord(leadResult.data);
      const customerEmail = textValue(contact.email) ?? textValue(metadata.customerEmail);

      if (!customerEmail) {
        return Response.json(
          { error: "The linked customer needs an email address before Kyro can prepare this send." },
          { status: 400 },
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
        return Response.json({ error: pending.error.message }, { status: 400 });
      }

      const duplicateAction = (pending.data ?? []).find((action) => {
        const input = objectRecord(action.input);

        return textValue(input.attachmentQuoteDraftId) === quoteDraftId;
      });

      if (duplicateAction) {
        return Response.json(
          { error: "A quote email is already prepared for this draft. Review it in Inbox before creating another one." },
          { status: 409 },
        );
      }

      const approvalLink = await createQuoteApprovalLinkForDraft(supabase, {
        actorId: user.id,
        actorType: "user",
        customerEmail,
        quoteDraftId,
        source: "mobile.documents.prepare_quote_send",
        workspaceId: workspace.id,
      });
      const artifact = await buildQuotePdfArtifactForDraft(supabase, {
        quoteDraftId,
        workspace,
      });
      const documentMetadata = quoteVersionedDocumentMetadata(
        quotePdfMetadata(artifact),
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
      const bodyText = quoteSendBody({
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
            body: bodyText,
            channelType: "email",
            generatedDocument: documentMetadata,
            quoteDraftId,
            settingsSnapshot: {
              approvalRequired: true,
              generatedDocument: documentMetadata,
              quoteApprovalLinkId: approvalLink.approvalLink.id,
              source: "mobile.documents.prepare_quote_send",
            },
            signatureVariant: "ai_generated",
            source: "mobile.documents.prepare_quote_send",
            subject,
          },
          policy_snapshot: {
            mode: "require_approval",
            reason: "Customer-facing document sends require user review.",
            source: "mobile.documents.prepare_quote_send",
          },
        })
        .select("id")
        .single();

      if (actionError || !action) {
        return Response.json(
          { error: actionError?.message ?? "Unable to prepare quote email." },
          { status: 400 },
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
        source: "mobile.documents.prepare_quote_send",
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
          source: "mobile.documents.prepare_quote_send",
        },
      );
      const nextStatus =
        String(quoteDraft.status) === "draft" ||
        String(quoteDraft.status) === "changes_requested"
          ? "ready"
          : quoteDraft.status;
      const { error: updateError } = await supabase
        .from("quote_drafts")
        .update({ metadata: nextMetadata, status: nextStatus })
        .eq("workspace_id", workspace.id)
        .eq("id", quoteDraftId);

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 400 });
      }

      await insertAuditLog(supabase, {
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "quote_draft.send_prepared",
        entityType: "quote_draft",
        entityId: quoteDraftId,
        before: { metadata, status: quoteDraft.status },
        after: {
          actionId: String(action.id),
          document: documentMetadata,
          metadata: nextMetadata,
          status: nextStatus,
        },
        metadata: {
          conversationId,
          customerEmail,
          quoteApprovalLinkId: approvalLink.approvalLink.id,
          quoteVersion: quoteRevisionState(preparedMetadata).currentVersion,
          source: "mobile.documents.prepare_quote_send",
        },
      });
      approvalToken = approvalLink.token;
      message = "Quote email prepared. Review and send it from Inbox.";
    } else {
      return Response.json({ error: "Unsupported quote operation." }, { status: 400 });
    }

    return quoteDetailPayload({ approvalToken, message, quoteDraftId, request });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
