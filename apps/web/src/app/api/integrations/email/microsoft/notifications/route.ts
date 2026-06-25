import type { User } from "@supabase/supabase-js";
import { MICROSOFT_PROVIDER } from "../../../../../../lib/integrations/microsoft";
import { syncInboundEmail } from "../../../../../../lib/integrations/inbound-email-sync";
import { createServiceSupabaseClient } from "../../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requestSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-kyro-sync-secret")?.trim() ?? "";
}

function expectedSecret() {
  return (
    process.env.INBOUND_EMAIL_PUSH_SECRET?.trim() ??
    process.env.INBOUND_EMAIL_SYNC_SECRET?.trim() ??
    process.env.CRON_SECRET?.trim() ??
    ""
  );
}

function scheduledUser(ownerUserId: string): User {
  return { id: ownerUserId } as User;
}

export async function GET(request: Request) {
  const validationToken = new URL(request.url).searchParams.get(
    "validationToken",
  );

  if (validationToken) {
    return new Response(validationToken, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  return Response.json({
    endpoint: "microsoft_graph_mail_notifications",
    expects: "Microsoft Graph validationToken or POST notification payload.",
    ok: true,
  });
}

export async function POST(request: Request) {
  const validationToken = new URL(request.url).searchParams.get(
    "validationToken",
  );

  if (validationToken) {
    return new Response(validationToken, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  const secret = expectedSecret();

  if (!secret) {
    return Response.json(
      { error: "INBOUND_EMAIL_PUSH_SECRET or sync secret is not configured." },
      { status: 501 },
    );
  }

  if (requestSecret(request) !== secret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const notifications = Array.isArray(
    (payload as Record<string, unknown>).value,
  )
    ? ((payload as Record<string, unknown>).value as Record<string, unknown>[])
    : [];
  const subscriptionIds = [
    ...new Set(
      notifications
        .map((item) => textValue(item.subscriptionId))
        .filter((item): item is string => Boolean(item)),
    ),
  ];

  if (subscriptionIds.length === 0) {
    return Response.json({ ok: true, processed: 0 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: connections, error } = await supabase
    .from("integration_connections")
    .select("id,workspace_id,account_email,metadata,workspaces(owner_user_id)")
    .eq("provider", MICROSOFT_PROVIDER)
    .in("status", ["connected", "needs_reconnect"]);

  if (error) {
    return Response.json(
      { error: `Unable to load Microsoft connections: ${error.message}` },
      { status: 500 },
    );
  }

  const results = [];

  for (const connection of connections ?? []) {
    const metadata =
      connection.metadata && typeof connection.metadata === "object"
        ? (connection.metadata as Record<string, unknown>)
        : {};
    const graph = metadata.microsoftGraph;
    const configuredSubscriptionId =
      graph && typeof graph === "object"
        ? textValue((graph as Record<string, unknown>).subscriptionId)
        : null;

    if (
      configuredSubscriptionId &&
      !subscriptionIds.includes(configuredSubscriptionId)
    ) {
      continue;
    }

    const workspace = Array.isArray(connection.workspaces)
      ? connection.workspaces[0]
      : connection.workspaces;
    const ownerUserId = textValue(
      (workspace as Record<string, unknown> | null)?.owner_user_id,
    );
    const notificationCount = notifications.filter(
      (item) =>
        !configuredSubscriptionId ||
        textValue(item.subscriptionId) === configuredSubscriptionId,
    ).length;

    await supabase
      .from("integration_connections")
      .update({
        metadata: {
          ...metadata,
          microsoftGraph: {
            ...(graph && typeof graph === "object"
              ? (graph as Record<string, unknown>)
              : {}),
            lastNotificationAt: new Date().toISOString(),
            lastNotificationCount: notificationCount,
          },
        },
      })
      .eq("id", connection.id);

    if (!ownerUserId) {
      results.push({
        accountEmail: connection.account_email,
        ok: false,
        warning: "Workspace owner missing; push metadata was recorded only.",
      });
      continue;
    }

    const result = await syncInboundEmail({
      supabase,
      trigger: "provider_push",
      user: scheduledUser(ownerUserId),
      workspaceId: String(connection.workspace_id),
    });

    results.push({
      accountEmail: connection.account_email,
      notificationCount,
      ok: true,
      result,
      workspaceId: connection.workspace_id,
    });
  }

  return Response.json({
    matchedConnections: results.length,
    ok: true,
    processed: notifications.length,
    results,
  });
}
