import { getQuoteDraftList, searchContacts } from "../../../../lib/crm/queries";
import {
  DOCUMENT_ACCENT_THEMES,
  DOCUMENT_CURRENCIES,
  DOCUMENT_TEMPLATE_POLICY_TYPE,
  getDocumentTemplateSettings,
  normalizeDocumentTemplateDesignSettings,
  normalizeDocumentTemplateSettings,
} from "../../../../lib/documents/settings";
import {
  draftTitleFromTemplate,
  getQuoteTemplate,
  normalizeQuoteLineItems,
  quoteTemplateCatalog,
} from "../../../../lib/documents/templates";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

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

function boundedText(value: unknown, fallback: string, maxLength: number) {
  return (textValue(value) ?? fallback).slice(0, maxLength);
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

function sanitizeLineItems(value: unknown) {
  return normalizeQuoteLineItems(Array.isArray(value) ? value : []).slice(0, 60);
}

function documentsPayload({
  documentTemplateSettings,
  quoteDrafts,
  workspace,
  message,
}: {
  documentTemplateSettings: Awaited<ReturnType<typeof getDocumentTemplateSettings>>;
  message?: string;
  quoteDrafts: Awaited<ReturnType<typeof getQuoteDraftList>>;
  workspace: { id: string; name: string; slug: string };
}) {
  const counts = {
    approved: 0,
    changesRequested: 0,
    draft: 0,
    ready: 0,
    sent: 0,
    total: quoteDrafts.length,
  };

  for (const quoteDraft of quoteDrafts) {
    if (quoteDraft.status === "approved") {
      counts.approved += 1;
    } else if (quoteDraft.status === "changes_requested") {
      counts.changesRequested += 1;
    } else if (quoteDraft.status === "ready") {
      counts.ready += 1;
    } else if (quoteDraft.status === "sent") {
      counts.sent += 1;
    } else if (quoteDraft.status === "draft") {
      counts.draft += 1;
    }
  }

  return {
    counts,
    ...(message ? { message } : {}),
    quoteDrafts: quoteDrafts.map((quoteDraft) => ({
      ...quoteDraft,
      lineItems: sanitizeLineItems(quoteDraft.lineItems),
    })),
    settings: {
      accentTheme: documentTemplateSettings.accentTheme,
      currency: documentTemplateSettings.currency,
      footerText: documentTemplateSettings.footerText,
      paymentTerms: documentTemplateSettings.paymentTerms,
      quoteStyleDirection: documentTemplateSettings.quoteStyleDirection,
      showPreparedBy: documentTemplateSettings.showPreparedBy,
      validityDays: documentTemplateSettings.validityDays,
    },
    templates: quoteTemplateCatalog(documentTemplateSettings.customTemplates).map(
      (template) => ({
        createdAt: "createdAt" in template ? template.createdAt : new Date(0).toISOString(),
        description: template.description,
        key: template.key,
        label: template.label,
        lineItems: sanitizeLineItems(template.lineItems),
        notes: template.notes,
        settings:
          "settings" in template
            ? normalizeDocumentTemplateDesignSettings(template.settings)
            : normalizeDocumentTemplateDesignSettings(documentTemplateSettings),
        updatedAt: "updatedAt" in template ? template.updatedAt : new Date(0).toISOString(),
      }),
    ),
    workspace,
  };
}

export async function GET(request: Request) {
  try {
    const { supabase, workspace } = await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const contactSearch = url.searchParams.get("contactSearch");

    if (contactSearch) {
      const contacts = await searchContacts(
        supabase,
        workspace.id,
        contactSearch,
        10,
      );

      return Response.json({ contacts, workspace });
    }

    const [quoteDrafts, documentTemplateSettings] = await Promise.all([
      getQuoteDraftList(supabase, workspace.id),
      getDocumentTemplateSettings(supabase, workspace.id),
    ]);

    return Response.json(
      documentsPayload({ documentTemplateSettings, quoteDrafts, workspace }),
    );
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspace } = await requireMobileWorkspaceContext(request);
    const body = objectRecord(await request.json().catch(() => ({})));
    const operation = textValue(body.operation) ?? "create_quote";
    let message = "Documents updated.";

    if (operation === "create_quote") {
      const documentTemplateSettings = await getDocumentTemplateSettings(
        supabase,
        workspace.id,
      );
      const templateKey = textValue(body.templateKey);
      const template = templateKey
        ? getQuoteTemplate(templateKey, documentTemplateSettings.customTemplates)
        : null;
      const status = textValue(body.status) ?? "draft";

      if (!QUOTE_DRAFT_STATUSES.has(status)) {
        return Response.json({ error: "Quote status is invalid." }, { status: 400 });
      }

      const title =
        textValue(body.title) ??
        (template ? draftTitleFromTemplate(template) : "Mobile quote draft");
      const metadata = {
        customerCompany: textValue(body.customerCompany),
        customerEmail: textValue(body.customerEmail),
        customerName: textValue(body.customerName),
        customerPhone: textValue(body.customerPhone),
        documentTemplateReferenceFiles:
          template && "referenceFiles" in template ? template.referenceFiles : [],
        documentTemplateSettings: normalizeDocumentTemplateDesignSettings(
          template && "settings" in template
            ? template.settings
            : documentTemplateSettings,
        ),
        dryRun: true,
        jobAddress: textValue(body.jobAddress),
        jobType: textValue(body.jobType) ?? template?.label ?? null,
        preferredTime: textValue(body.preferredTime),
        quoteRevision: {
          currentVersion: 1,
          status: "draft",
        },
        source: template ? "document.template.mobile" : "documents.mobile",
        templateKey: template?.key ?? null,
        updatedFrom: "mobile.documents",
      };
      const lineItems = sanitizeLineItems(
        Array.isArray(body.lineItems) && body.lineItems.length
          ? body.lineItems
          : template?.lineItems ?? [],
      );
      const { data: quoteDraft, error } = await supabase
        .from("quote_drafts")
        .insert({
          contact_id: textValue(body.contactId),
          line_items: lineItems,
          metadata,
          notes: textValue(body.notes) ?? template?.notes ?? null,
          status,
          title,
          workspace_id: workspace.id,
        })
        .select("id,title,status")
        .single();

      if (error || !quoteDraft) {
        return Response.json(
          { error: error?.message ?? "Unable to create quote draft." },
          { status: 400 },
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
          lineItems,
          metadata,
          notes: textValue(body.notes) ?? template?.notes ?? null,
          status,
          templateKey: template?.key ?? null,
          title,
        },
      });
      message = "Quote draft created.";
    } else if (operation === "save_template") {
      const label = boundedText(body.label, "", 120);

      if (!label) {
        return Response.json({ error: "Template name is required." }, { status: 400 });
      }

      const { data: beforePolicy, error: beforeError } = await supabase
        .from("workspace_policies")
        .select("id,settings")
        .eq("workspace_id", workspace.id)
        .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
        .maybeSingle();

      if (beforeError) {
        return Response.json({ error: beforeError.message }, { status: 400 });
      }

      const beforeSettings = normalizeDocumentTemplateSettings(beforePolicy?.settings);
      const templateKey = textValue(body.templateKey);
      const existingTemplate = templateKey
        ? beforeSettings.customTemplates.find((item) => item.key === templateKey)
        : null;
      const now = new Date().toISOString();
      const template = {
        createdAt: existingTemplate?.createdAt ?? now,
        description: boundedText(body.description, "Custom quote template.", 220),
        key: existingTemplate?.key ?? `custom_${slugValue(label)}_${Date.now().toString(36)}`,
        label,
        lineItems: sanitizeLineItems(body.lineItems),
        notes: typeof body.notes === "string" ? body.notes.slice(0, 900) : "",
        referenceFiles: existingTemplate?.referenceFiles ?? [],
        revisionRequest: textValue(body.revisionRequest),
        settings: normalizeDocumentTemplateDesignSettings({
          accentTheme: DOCUMENT_ACCENT_THEMES.includes(body.accentTheme as never)
            ? body.accentTheme
            : beforeSettings.accentTheme,
          currency: DOCUMENT_CURRENCIES.includes(body.currency as never)
            ? body.currency
            : beforeSettings.currency,
          footerText: body.footerText,
          paymentTerms: body.paymentTerms,
          quoteStyleDirection: body.quoteStyleDirection,
          showPreparedBy:
            typeof body.showPreparedBy === "boolean"
              ? body.showPreparedBy
              : beforeSettings.showPreparedBy,
          validityDays: body.validityDays,
        }),
        updatedAt: now,
      };
      const settings = normalizeDocumentTemplateSettings({
        ...beforeSettings,
        customTemplates: existingTemplate
          ? beforeSettings.customTemplates.map((item) =>
              item.key === existingTemplate.key ? template : item,
            )
          : [...beforeSettings.customTemplates, template],
      });
      const { data: savedPolicy, error: saveError } = await supabase
        .from("workspace_policies")
        .upsert(
          {
            policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
            settings,
            workspace_id: workspace.id,
          },
          { onConflict: "workspace_id,policy_type" },
        )
        .select("id")
        .single();

      if (saveError || !savedPolicy) {
        return Response.json(
          { error: saveError?.message ?? "Unable to save document template." },
          { status: 400 },
        );
      }

      await insertAuditLog(supabase, {
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: existingTemplate
          ? "document_template.updated"
          : "document_template.created",
        entityType: "workspace_policy",
        entityId: String(savedPolicy.id),
        before: existingTemplate ? { template: existingTemplate } : null,
        after: { template },
        metadata: {
          policyType: DOCUMENT_TEMPLATE_POLICY_TYPE,
          source: "mobile.documents",
          templateKey: template.key,
        },
      });
      message = existingTemplate ? "Template saved." : "Template created.";
    } else if (operation === "save_template_settings") {
      const { data: beforePolicy, error: beforeError } = await supabase
        .from("workspace_policies")
        .select("id,settings")
        .eq("workspace_id", workspace.id)
        .eq("policy_type", DOCUMENT_TEMPLATE_POLICY_TYPE)
        .maybeSingle();

      if (beforeError) {
        return Response.json({ error: beforeError.message }, { status: 400 });
      }

      const beforeSettings = normalizeDocumentTemplateSettings(beforePolicy?.settings);
      const settings = normalizeDocumentTemplateSettings({
        ...beforeSettings,
        accentTheme: body.accentTheme,
        currency: body.currency,
        footerText: body.footerText,
        paymentTerms: body.paymentTerms,
        quoteStyleDirection: body.quoteStyleDirection,
        showPreparedBy: body.showPreparedBy,
        validityDays: body.validityDays,
      });
      const { data: savedPolicy, error: saveError } = await supabase
        .from("workspace_policies")
        .upsert(
          {
            policy_type: DOCUMENT_TEMPLATE_POLICY_TYPE,
            settings,
            workspace_id: workspace.id,
          },
          { onConflict: "workspace_id,policy_type" },
        )
        .select("id")
        .single();

      if (saveError || !savedPolicy) {
        return Response.json(
          { error: saveError?.message ?? "Unable to save document settings." },
          { status: 400 },
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
        metadata: { policyType: DOCUMENT_TEMPLATE_POLICY_TYPE, source: "mobile.documents" },
      });
      message = "Document settings saved.";
    } else {
      return Response.json({ error: "Unsupported document operation." }, { status: 400 });
    }

    const [quoteDrafts, documentTemplateSettings] = await Promise.all([
      getQuoteDraftList(supabase, workspace.id),
      getDocumentTemplateSettings(supabase, workspace.id),
    ]);

    return Response.json(
      documentsPayload({ documentTemplateSettings, message, quoteDrafts, workspace }),
    );
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
