import { fetchWithTimeout } from "../http/fetch-with-timeout";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicAppUrl } from "../app-url";
import {
  reconcileWorkspaceBillingAccess,
  type WorkspaceBillingAccess,
} from "./access";
import { textValue } from "@kyro/core";
import { writeOrThrow } from "../supabase/write";

type DunningStage =
  | "payment_failed"
  | "grace_ending"
  | "restricted"
  | "recovered";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stageForAccess(
  access: WorkspaceBillingAccess,
  recovered: boolean,
): { number: number; stage: DunningStage } | null {
  if (recovered) {
    return { number: 4, stage: "recovered" };
  }

  if (access.status === "restricted") {
    return access.dunningStage < 3 ? { number: 3, stage: "restricted" } : null;
  }

  if (access.status !== "grace" || !access.graceEndsAt) {
    return null;
  }

  const remainingMs = new Date(access.graceEndsAt).getTime() - Date.now();

  if (remainingMs <= 3 * 24 * 60 * 60 * 1000 && access.dunningStage < 2) {
    return { number: 2, stage: "grace_ending" };
  }

  return access.dunningStage < 1
    ? { number: 1, stage: "payment_failed" }
    : null;
}

function messageForStage(stage: DunningStage, workspaceName: string) {
  const settingsUrl = `${getPublicAppUrl()}/settings?section=usage&panel=payment-method`;

  if (stage === "recovered") {
    return {
      body: `Billing for ${workspaceName} is back in good standing. Kyro paid automation is available again.`,
      button: "Open Kyro",
      subject: "Kyro billing is back in good standing",
      url: `${getPublicAppUrl()}/dashboard`,
    };
  }

  if (stage === "restricted") {
    return {
      body: `Kyro could not collect the outstanding balance for ${workspaceName}. Your data remains available, but new paid automation is paused until the payment method is updated.`,
      button: "Update payment method",
      subject: "Kyro automation is paused until billing is updated",
      url: settingsUrl,
    };
  }

  if (stage === "grace_ending") {
    return {
      body: `Kyro still cannot collect the outstanding balance for ${workspaceName}. Please update the payment method before the grace period ends to avoid pausing paid automation.`,
      button: "Update payment method",
      subject: "Action needed: Kyro billing grace period is ending",
      url: settingsUrl,
    };
  }

  return {
    body: `Kyro could not collect the latest balance for ${workspaceName}. The account is in a grace period and continues to work while you update the payment method.`,
    button: "Review billing",
    subject: "Kyro payment needs attention",
    url: settingsUrl,
  };
}

async function workspaceRecipient(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("name,owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error || !workspace) {
    throw new Error(
      `Unable to load dunning recipient: ${error?.message ?? "workspace not found"}`,
    );
  }

  const ownerUserId = textValue(workspace.owner_user_id);

  if (!ownerUserId) {
    return null;
  }

  const { data: owner, error: ownerError } =
    await supabase.auth.admin.getUserById(ownerUserId);

  if (ownerError || !owner.user?.email) {
    return null;
  }

  return {
    email: owner.user.email,
    workspaceName: textValue(workspace.name) ?? "your workspace",
  };
}

async function sendDunningEmail(
  supabase: SupabaseClient,
  input: {
    access: WorkspaceBillingAccess;
    number: number;
    stage: DunningStage;
  },
) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const recipient = await workspaceRecipient(
    supabase,
    input.access.workspaceId,
  );

  if (!apiKey || !recipient) {
    return false;
  }

  const reference =
    input.access.latestInvoiceId ?? input.access.trialEndsAt ?? "account";
  const dedupeKey = `${input.access.workspaceId}:${reference}:${input.stage}`;
  let { data: delivery, error: deliveryError } = await supabase
    .from("billing_dunning_deliveries")
    .insert({
      dedupe_key: dedupeKey,
      invoice_id: input.access.latestInvoiceId,
      recipient_email: recipient.email,
      stage: input.stage,
      workspace_id: input.access.workspaceId,
    })
    .select("id")
    .single();

  if (deliveryError) {
    if (deliveryError.code === "23505") {
      const { data: existingDelivery, error: existingDeliveryError } =
        await supabase
          .from("billing_dunning_deliveries")
          .select("id,status")
          .eq("dedupe_key", dedupeKey)
          .maybeSingle();

      if (existingDeliveryError) {
        throw new Error(
          `Unable to inspect dunning retry: ${existingDeliveryError.message}`,
        );
      }

      if (!existingDelivery || existingDelivery.status !== "failed") {
        return false;
      }

      const { data: retriedDelivery, error: retryError } = await supabase
        .from("billing_dunning_deliveries")
        .update({ error: null, status: "pending" })
        .eq("id", existingDelivery.id)
        .eq("status", "failed")
        .select("id")
        .maybeSingle();

      if (retryError) {
        throw new Error(
          `Unable to reserve dunning retry: ${retryError.message}`,
        );
      }

      if (!retriedDelivery) {
        return false;
      }

      delivery = retriedDelivery;
      deliveryError = null;
    } else {
      throw new Error(
        `Unable to reserve dunning email: ${deliveryError.message}`,
      );
    }
  }

  if (!delivery) {
    return false;
  }

  const message = messageForStage(input.stage, recipient.workspaceName);

  try {
    const response = await fetchWithTimeout("https://api.resend.com/emails", {
      body: JSON.stringify({
        from:
          process.env.KYRO_BILLING_EMAIL_FROM?.trim() ||
          process.env.KYRO_AUTH_EMAIL_FROM?.trim() ||
          "Kyro <no-reply@mail.kyroassistant.com>",
        html: `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.55;max-width:620px;margin:0 auto;padding:28px;"><h1 style="font-size:22px;margin:0 0 14px;">${escapeHtml(message.subject)}</h1><p style="font-size:15px;margin:0 0 22px;">${escapeHtml(message.body)}</p><a href="${escapeHtml(message.url)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px;font-weight:700;">${escapeHtml(message.button)}</a></div>`,
        subject: message.subject,
        text: `${message.body}\n\n${message.url}`,
        to: [recipient.email],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `kyro-${dedupeKey}`.slice(0, 250),
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      throw new Error(
        textValue(payload.message) ??
          `Resend returned HTTP ${response.status}.`,
      );
    }

    await writeOrThrow(
      supabase
        .from("billing_dunning_deliveries")
        .update({
          provider_message_id: textValue(payload.id),
          sent_at: new Date().toISOString(),
          status: "sent",
        })
        .eq("id", delivery.id),
      "Unable to record dunning email as sent",
    );
    await writeOrThrow(
      supabase
        .from("workspace_billing_access")
        .update({
          dunning_stage: input.number,
          next_dunning_at: null,
        })
        .eq("workspace_id", input.access.workspaceId),
      "Unable to advance the workspace dunning stage",
    );

    return true;
  } catch (error) {
    // Logged rather than thrown: `error` below is the real failure, and
    // replacing it with a bookkeeping error would lose the reason dunning
    // failed in the first place.
    const { error: markFailedError } = await supabase
      .from("billing_dunning_deliveries")
      .update({
        error: error instanceof Error ? error.message : "Dunning email failed.",
        status: "failed",
      })
      .eq("id", delivery.id);

    if (markFailedError) {
      console.error(
        `Unable to mark dunning delivery ${delivery.id} as failed: ${markFailedError.message}`,
      );
    }

    throw error;
  }
}

export async function reconcileAndProcessWorkspaceBilling(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const reconciled = await reconcileWorkspaceBillingAccess(
    supabase,
    workspaceId,
  );

  if (reconciled.recovered) {
    const { error } = await supabase
      .from("outbound_messages")
      .update({
        last_error: null,
        next_attempt_at: new Date().toISOString(),
        status: "queued",
      })
      .eq("workspace_id", workspaceId)
      .eq("status", "billing_paused");

    if (error) {
      throw new Error(
        `Unable to resume billing-paused outbound work: ${error.message}`,
      );
    }
  }

  const stage = stageForAccess(reconciled.access, reconciled.recovered);
  const dunningSent = stage
    ? await sendDunningEmail(supabase, {
        access: reconciled.access,
        ...stage,
      })
    : false;

  return { ...reconciled, dunningSent };
}

export async function processBillingAccessCycle(
  supabase: SupabaseClient,
  options: { limit?: number; workspaceId?: string | null } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 500, 2_000));
  let query = supabase
    .from("workspaces")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (options.workspaceId) {
    query = query.eq("id", options.workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Unable to load billing-access workspaces: ${error.message}`,
    );
  }

  const results = [];

  for (const workspace of data ?? []) {
    try {
      results.push({
        ok: true,
        workspaceId: String(workspace.id),
        ...(await reconcileAndProcessWorkspaceBilling(
          supabase,
          String(workspace.id),
        )),
      });
    } catch (error) {
      results.push({
        error:
          error instanceof Error ? error.message : "Billing access failed.",
        ok: false,
        workspaceId: String(workspace.id),
      });
    }
  }

  return results;
}
