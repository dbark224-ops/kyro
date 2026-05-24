import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuoteDraftProfile, type QuoteDraftProfile } from "../crm/queries";
import { insertAuditLog } from "../engine/event-action-audit";
import { getDocumentTemplateSettings } from "./settings";
import {
  appendQuoteDocumentHistory,
  quoteDocumentContentHash,
} from "./history";

export const QUOTE_APPROVAL_TOKEN_BYTES = 32;
export const QUOTE_APPROVAL_LINK_DAYS = 30;

export const QUOTE_APPROVAL_STATUSES = [
  "active",
  "approved",
  "changes_requested",
  "revoked",
] as const;

export type QuoteApprovalStatus = (typeof QUOTE_APPROVAL_STATUSES)[number];

export type QuoteApprovalLink = {
  approvedAt: string | null;
  changesRequestedAt: string | null;
  createdAt: string;
  customerEmail: string | null;
  expiresAt: string | null;
  id: string;
  lastChangeRequest: string | null;
  metadata: Record<string, unknown>;
  quoteDraftId: string;
  status: QuoteApprovalStatus;
  updatedAt: string;
  viewedAt: string | null;
  workspaceId: string;
};

export type QuoteApprovalPortal = {
  approvalLink: QuoteApprovalLink;
  businessProfile: {
    businessName: string | null;
    defaultReplyInstructions: string | null;
    description: string | null;
    industry: string | null;
    serviceArea: string | null;
    toneOfVoice: string | null;
  } | null;
  profile: QuoteDraftProfile;
  workspace: {
    id: string;
    name: string;
  };
};

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeApprovalStatus(value: unknown): QuoteApprovalStatus {
  return QUOTE_APPROVAL_STATUSES.includes(value as QuoteApprovalStatus)
    ? (value as QuoteApprovalStatus)
    : "active";
}

function addDays(date: Date, days: number) {
  const next = new Date(date);

  next.setDate(next.getDate() + days);

  return next;
}

function normalizeApprovalLink(row: Record<string, unknown>): QuoteApprovalLink {
  return {
    approvedAt: textValue(row.approved_at),
    changesRequestedAt: textValue(row.changes_requested_at),
    createdAt: String(row.created_at),
    customerEmail: textValue(row.customer_email),
    expiresAt: textValue(row.expires_at),
    id: String(row.id),
    lastChangeRequest: textValue(row.last_change_request),
    metadata: objectRecord(row.metadata),
    quoteDraftId: String(row.quote_draft_id),
    status: normalizeApprovalStatus(row.status),
    updatedAt: String(row.updated_at),
    viewedAt: textValue(row.viewed_at),
    workspaceId: String(row.workspace_id),
  };
}

export function createQuoteApprovalToken() {
  return randomBytes(QUOTE_APPROVAL_TOKEN_BYTES).toString("base64url");
}

export function hashQuoteApprovalToken(token: string) {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function isQuoteApprovalLinkExpired(
  link: Pick<QuoteApprovalLink, "expiresAt">,
  now = new Date(),
) {
  return Boolean(link.expiresAt && new Date(link.expiresAt).getTime() < now.getTime());
}

export function quoteApprovalPublicUrl(token: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const appUrl = configured || "http://127.0.0.1:3000";

  return `${appUrl}/quote/approve/${encodeURIComponent(token)}`;
}

export async function getLatestQuoteApprovalLinkForDraft(
  supabase: SupabaseClient,
  {
    quoteDraftId,
    workspaceId,
  }: {
    quoteDraftId: string;
    workspaceId: string;
  },
) {
  const { data, error } = await supabase
    .from("quote_approval_links")
    .select(
      "id,workspace_id,quote_draft_id,status,customer_email,expires_at,viewed_at,approved_at,changes_requested_at,last_change_request,metadata,created_at,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("quote_draft_id", quoteDraftId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load quote approval link: ${error.message}`);
  }

  return data ? normalizeApprovalLink(data) : null;
}

export async function createQuoteApprovalLinkForDraft(
  supabase: SupabaseClient,
  {
    actorId,
    actorType = "user",
    customerEmail,
    expiresInDays = QUOTE_APPROVAL_LINK_DAYS,
    quoteDraftId,
    source,
    workspaceId,
  }: {
    actorId?: string;
    actorType?: "ai" | "system" | "user";
    customerEmail: string | null;
    expiresInDays?: number;
    quoteDraftId: string;
    source: string;
    workspaceId: string;
  },
) {
  const now = new Date();
  const token = createQuoteApprovalToken();
  const tokenHash = hashQuoteApprovalToken(token);
  const expiresAt = addDays(now, expiresInDays).toISOString();

  const { error: revokeError } = await supabase
    .from("quote_approval_links")
    .update({
      metadata: {
        revokedBy: source,
        revokedReason: "Superseded by a newer customer approval link.",
      },
      status: "revoked",
    })
    .eq("workspace_id", workspaceId)
    .eq("quote_draft_id", quoteDraftId)
    .eq("status", "active");

  if (revokeError) {
    throw new Error(`Unable to refresh existing approval links: ${revokeError.message}`);
  }

  const { data, error } = await supabase
    .from("quote_approval_links")
    .insert({
      customer_email: customerEmail,
      expires_at: expiresAt,
      metadata: {
        createdBy: source,
      },
      quote_draft_id: quoteDraftId,
      status: "active",
      token_hash: tokenHash,
      workspace_id: workspaceId,
    })
    .select(
      "id,workspace_id,quote_draft_id,status,customer_email,expires_at,viewed_at,approved_at,changes_requested_at,last_change_request,metadata,created_at,updated_at",
    )
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to create quote approval link: ${error?.message ?? "unknown error"}`,
    );
  }

  const approvalLink = normalizeApprovalLink(data);

  await insertAuditLog(supabase, {
    workspaceId,
    actorType,
    actorId,
    action: "quote_approval_link.created",
    entityType: "quote_approval_link",
    entityId: approvalLink.id,
    after: {
      customerEmail,
      expiresAt,
      quoteDraftId,
      status: approvalLink.status,
    },
    metadata: {
      quoteDraftId,
      source,
    },
  });

  return {
    approvalLink,
    token,
    url: quoteApprovalPublicUrl(token),
  };
}

export async function getQuoteApprovalPortalByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<QuoteApprovalPortal | null> {
  const tokenHash = hashQuoteApprovalToken(token);
  const { data: approvalLinkRow, error: approvalLinkError } = await supabase
    .from("quote_approval_links")
    .select(
      "id,workspace_id,quote_draft_id,status,customer_email,expires_at,viewed_at,approved_at,changes_requested_at,last_change_request,metadata,created_at,updated_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (approvalLinkError) {
    throw new Error(
      `Unable to load customer approval link: ${approvalLinkError.message}`,
    );
  }

  if (!approvalLinkRow) {
    return null;
  }

  const approvalLink = normalizeApprovalLink(approvalLinkRow);
  const [workspaceResult, profile, businessProfile] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id,name")
      .eq("id", approvalLink.workspaceId)
      .maybeSingle(),
    getQuoteDraftProfile(
      supabase,
      approvalLink.workspaceId,
      approvalLink.quoteDraftId,
    ),
    supabase
      .from("business_profiles")
      .select(
        "business_name,industry,description,service_area,tone_of_voice,default_reply_instructions",
      )
      .eq("workspace_id", approvalLink.workspaceId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (workspaceResult.error) {
    throw new Error(`Unable to load workspace: ${workspaceResult.error.message}`);
  }

  if (businessProfile.error) {
    throw new Error(
      `Unable to load business profile: ${businessProfile.error.message}`,
    );
  }

  if (!workspaceResult.data || !profile) {
    return null;
  }

  return {
    approvalLink,
    businessProfile: businessProfile.data
      ? {
          businessName: businessProfile.data.business_name,
          defaultReplyInstructions:
            businessProfile.data.default_reply_instructions,
          description: businessProfile.data.description,
          industry: businessProfile.data.industry,
          serviceArea: businessProfile.data.service_area,
          toneOfVoice: businessProfile.data.tone_of_voice,
        }
      : null,
    profile,
    workspace: {
      id: String(workspaceResult.data.id),
      name: String(workspaceResult.data.name),
    },
  };
}

export async function recordQuoteApprovalView(
  supabase: SupabaseClient,
  portal: QuoteApprovalPortal,
) {
  if (portal.approvalLink.viewedAt) {
    return portal.approvalLink;
  }

  const now = new Date().toISOString();
  const { error: linkError } = await supabase
    .from("quote_approval_links")
    .update({ viewed_at: now })
    .eq("id", portal.approvalLink.id)
    .is("viewed_at", null);

  if (linkError) {
    throw new Error(`Unable to record approval view: ${linkError.message}`);
  }

  const metadata = portal.profile.quoteDraft.metadata;
  const settings = await getDocumentTemplateSettings(
    supabase,
    portal.workspace.id,
  );
  const nextMetadata = appendQuoteDocumentHistory(metadata, {
    actorType: "system",
    contentHash: quoteDocumentContentHash({
      profile: portal.profile,
      settings,
    }),
    kind: "customer_viewed",
    occurredAt: now,
    source: "quote.approval_portal",
  });

  const { error: quoteError } = await supabase
    .from("quote_drafts")
    .update({ metadata: nextMetadata })
    .eq("workspace_id", portal.workspace.id)
    .eq("id", portal.profile.quoteDraft.id);

  if (quoteError) {
    throw new Error(`Unable to record quote view: ${quoteError.message}`);
  }

  return {
    ...portal.approvalLink,
    viewedAt: now,
  };
}

export async function submitQuoteApprovalDecision(
  supabase: SupabaseClient,
  {
    decision,
    message,
    token,
  }: {
    decision: "approve" | "request_changes";
    message?: string | null;
    token: string;
  },
) {
  const portal = await getQuoteApprovalPortalByToken(supabase, token);

  if (!portal) {
    return { status: "not_found" as const };
  }

  if (portal.approvalLink.status === "revoked") {
    return { status: "revoked" as const, portal };
  }

  if (isQuoteApprovalLinkExpired(portal.approvalLink)) {
    return { status: "expired" as const, portal };
  }

  const now = new Date().toISOString();
  const nextStatus: QuoteApprovalStatus =
    decision === "approve" ? "approved" : "changes_requested";
  const customerMessage = textValue(message)?.slice(0, 2000) ?? null;
  const settings = await getDocumentTemplateSettings(supabase, portal.workspace.id);
  const contentHash = quoteDocumentContentHash({
    profile: portal.profile,
    settings,
  });
  const historyKind =
    decision === "approve" ? "customer_approved" : "customer_changes_requested";
  const nextMetadata = appendQuoteDocumentHistory(
    {
      ...portal.profile.quoteDraft.metadata,
      customerApproval: {
        approvalLinkId: portal.approvalLink.id,
        decidedAt: now,
        lastChangeRequest: customerMessage,
        status: nextStatus,
      },
    },
    {
      actorType: "system",
      contentHash,
      kind: historyKind,
      occurredAt: now,
      source: "quote.approval_portal",
    },
  );

  const { error: linkError } = await supabase
    .from("quote_approval_links")
    .update({
      approved_at: decision === "approve" ? now : portal.approvalLink.approvedAt,
      changes_requested_at:
        decision === "request_changes"
          ? now
          : portal.approvalLink.changesRequestedAt,
      last_change_request:
        decision === "request_changes"
          ? customerMessage
          : portal.approvalLink.lastChangeRequest,
      metadata: {
        ...portal.approvalLink.metadata,
        decidedAt: now,
        decision,
      },
      status: nextStatus,
      viewed_at: portal.approvalLink.viewedAt ?? now,
    })
    .eq("id", portal.approvalLink.id);

  if (linkError) {
    throw new Error(`Unable to save quote approval: ${linkError.message}`);
  }

  const quoteStatus =
    decision === "approve" ? "approved" : "changes_requested";
  const { error: quoteError } = await supabase
    .from("quote_drafts")
    .update({
      metadata: nextMetadata,
      status:
        portal.profile.quoteDraft.status === "archived"
          ? portal.profile.quoteDraft.status
          : quoteStatus,
    })
    .eq("workspace_id", portal.workspace.id)
    .eq("id", portal.profile.quoteDraft.id);

  if (quoteError) {
    throw new Error(`Unable to update quote approval state: ${quoteError.message}`);
  }

  if (decision === "request_changes" && portal.profile.quoteDraft.conversation) {
    const subject = `Changes requested: ${portal.profile.quoteDraft.title}`;
    const { error: messageError } = await supabase.from("messages").insert({
      body_text:
        customerMessage ??
        "The customer requested changes to this quote but did not leave a message.",
      contact_id: portal.profile.quoteDraft.contact?.id ?? null,
      conversation_id: portal.profile.quoteDraft.conversation.id,
      direction: "inbound",
      metadata: {
        quoteApprovalLinkId: portal.approvalLink.id,
        quoteDraftId: portal.profile.quoteDraft.id,
        source: "quote.approval_portal",
      },
      received_at: now,
      subject,
      workspace_id: portal.workspace.id,
    });

    if (messageError) {
      throw new Error(
        `Unable to record customer change request: ${messageError.message}`,
      );
    }

    const { error: conversationError } = await supabase
      .from("conversations")
      .update({
        last_message_at: now,
        status: "open",
      })
      .eq("workspace_id", portal.workspace.id)
      .eq("id", portal.profile.quoteDraft.conversation.id);

    if (conversationError) {
      throw new Error(
        `Unable to reopen conversation: ${conversationError.message}`,
      );
    }
  }

  await insertAuditLog(supabase, {
    workspaceId: portal.workspace.id,
    actorType: "system",
    action:
      decision === "approve"
        ? "quote_approval.customer_approved"
        : "quote_approval.customer_changes_requested",
    entityType: "quote_approval_link",
    entityId: portal.approvalLink.id,
    after: {
      decision,
      message: customerMessage,
      quoteDraftId: portal.profile.quoteDraft.id,
      status: nextStatus,
    },
    metadata: {
      quoteDraftId: portal.profile.quoteDraft.id,
      source: "quote.approval_portal",
    },
  });

  return {
    portal,
    status: nextStatus,
  } as const;
}
