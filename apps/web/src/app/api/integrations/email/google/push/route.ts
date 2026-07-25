import type { User } from "@supabase/supabase-js";
import {
  envSecret,
  hasValidRequestSecret,
} from "../../../../../../lib/http/request-secret";
import { GOOGLE_PROVIDER } from "../../../../../../lib/integrations/google";
import { syncInboundEmail } from "../../../../../../lib/integrations/inbound-email-sync";
import { createServiceSupabaseClient } from "../../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

type GmailPushPayload = {
  emailAddress: string | null;
  historyId: string | null;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function expectedSecret() {
  return envSecret(
    "INBOUND_EMAIL_PUSH_SECRET",
    "INBOUND_EMAIL_SYNC_SECRET",
    "CRON_SECRET",
  );
}

function scheduledUser(ownerUserId: string): User {
  return { id: ownerUserId } as User;
}

function decodeGmailPushPayload(payload: unknown): GmailPushPayload {
  const message =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).message
      : null;
  const data =
    message && typeof message === "object" && !Array.isArray(message)
      ? textValue((message as Record<string, unknown>).data)
      : null;

  if (!data) {
    return { emailAddress: null, historyId: null };
  }

  try {
    const decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));

    return {
      emailAddress: textValue(decoded.emailAddress),
      historyId: textValue(decoded.historyId),
    };
  } catch {
    return { emailAddress: null, historyId: null };
  }
}

export async function POST(request: Request) {
  const secret = expectedSecret();

  if (!secret) {
    return Response.json(
      { error: "INBOUND_EMAIL_PUSH_SECRET or sync secret is not configured." },
      { status: 501 },
    );
  }

  if (!hasValidRequestSecret(request, secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const notification = decodeGmailPushPayload(payload);

  if (!notification.emailAddress) {
    return Response.json({ error: "Missing Gmail emailAddress." }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: connection, error } = await supabase
    .from("integration_connections")
    .select("id,workspace_id,account_email,metadata,workspaces(owner_user_id)")
    .eq("provider", GOOGLE_PROVIDER)
    .eq("account_email", notification.emailAddress)
    .in("status", ["connected", "needs_reconnect"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return Response.json(
      { error: `Unable to match Gmail push connection: ${error.message}` },
      { status: 500 },
    );
  }

  if (!connection) {
    return Response.json({ matched: false, ok: true });
  }

  const workspace = Array.isArray(connection.workspaces)
    ? connection.workspaces[0]
    : connection.workspaces;
  const ownerUserId = textValue(
    (workspace as Record<string, unknown> | null)?.owner_user_id,
  );

  await supabase
    .from("integration_connections")
    .update({
      metadata: {
        ...((connection.metadata && typeof connection.metadata === "object"
          ? connection.metadata
          : {}) as Record<string, unknown>),
        gmailPush: {
          historyId: notification.historyId,
          lastNotificationAt: new Date().toISOString(),
        },
      },
    })
    .eq("id", connection.id);

  if (!ownerUserId) {
    return Response.json({
      matched: true,
      ok: false,
      warning: "Workspace owner missing; push metadata was recorded only.",
    });
  }

  const result = await syncInboundEmail({
    supabase,
    trigger: "provider_push",
    user: scheduledUser(ownerUserId),
    workspaceId: String(connection.workspace_id),
  });

  return Response.json({
    historyId: notification.historyId,
    matched: true,
    ok: true,
    result,
  });
}
