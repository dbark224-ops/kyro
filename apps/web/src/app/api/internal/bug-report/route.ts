import { NextResponse } from "next/server";
import {
  sendInternalBugNotification,
  type InternalBugNotificationInput,
} from "../../../../lib/internal-notifications";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { getPrimaryWorkspace } from "../../../../lib/workspace/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function severityValue(value: unknown): InternalBugNotificationInput["severity"] {
  const severity = stringValue(value).toLowerCase();

  if (severity === "info" || severity === "warning" || severity === "error") {
    return severity;
  }

  return "error";
}

function clipped(value: string, maxLength = 2_400) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function notificationInputFromPayload(
  payload: Record<string, unknown>,
  request: Request,
): InternalBugNotificationInput {
  const kind = stringValue(payload.kind) || "client_visible_error";
  const source = stringValue(payload.source) || "unknown";

  return {
    context: recordValue(payload.context),
    eventKey: stringValue(payload.eventKey) || null,
    kind: clipped(kind, 160),
    pageUrl: clipped(stringValue(payload.pageUrl), 1_200) || null,
    rawMessage: clipped(stringValue(payload.rawMessage), 2_400) || null,
    severity: severityValue(payload.severity),
    source: clipped(source, 240),
    userAgent:
      clipped(stringValue(payload.userAgent) || request.headers.get("user-agent") || "", 800) ||
      null,
    visibleMessage: clipped(stringValue(payload.visibleMessage), 1_200) || null,
  };
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;

  try {
    payload = recordValue(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Send valid bug report details." },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let workspace = null;

  try {
    workspace = await getPrimaryWorkspace(supabase);
  } catch (workspaceError) {
    console.error("Unable to load workspace for bug notification", workspaceError);
  }

  const input = notificationInputFromPayload(payload, request);

  try {
    const result = await sendInternalBugNotification({
      context: {
        userEmail: user.email,
        userId: user.id,
        workspaceId: workspace?.id,
        workspaceName: workspace?.name,
      },
      input,
    });

    return NextResponse.json({ ok: true, notified: result.sent });
  } catch (notificationError) {
    console.error("Unable to send internal bug notification", notificationError);

    return NextResponse.json({ ok: true, notified: false });
  }
}
