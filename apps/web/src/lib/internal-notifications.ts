import { createHash } from "node:crypto";

type InternalBugNotificationContext = {
  userEmail?: string | null;
  userId?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
};

export type InternalBugNotificationInput = {
  context?: Record<string, unknown> | null;
  eventKey?: string | null;
  kind: string;
  pageUrl?: string | null;
  rawMessage?: string | null;
  severity?: "error" | "warning" | "info";
  source: string;
  userAgent?: string | null;
  visibleMessage?: string | null;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clipped(value: string | null | undefined, maxLength = 1_600) {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function prettyJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  try {
    return clipped(JSON.stringify(value, null, 2), 2_400);
  } catch {
    return "";
  }
}

function configuredBugNotificationEmails() {
  const configured =
    process.env.KYRO_BUG_NOTIFICATION_EMAIL?.trim() ||
    process.env.KYRO_BUG_NOTIFICATION_TO?.trim() ||
    process.env.KYRO_INTERNAL_ALERT_EMAIL?.trim() ||
    process.env.KYRO_INTERNAL_ALERT_TO?.trim() ||
    process.env.KYRO_DEVELOPER_EMAILS?.trim() ||
    "hello@workflowautomation.au";

  return configured
    .split(/[,\s]+/)
    .map((email) => email.trim())
    .filter((email) => email && isValidEmail(email));
}

function internalNotificationFromAddress() {
  return (
    process.env.KYRO_INTERNAL_NOTIFICATION_FROM?.trim() ||
    process.env.WAITLIST_NOTIFICATION_FROM?.trim() ||
    process.env.KYRO_AUTH_EMAIL_FROM?.trim() ||
    "Kyro <onboarding@resend.dev>"
  );
}

function fingerprintSource(input: InternalBugNotificationInput) {
  return [
    input.kind,
    input.source,
    input.rawMessage || input.visibleMessage || "",
  ]
    .join(":")
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t[^\s"'<>]+/gi, "<timestamp>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<uuid>",
    )
    .replace(/\b-?\d+(?:\.\d+)?\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim();
}

function idempotencyKey(
  input: InternalBugNotificationInput,
  context: InternalBugNotificationContext,
) {
  const explicitKey = stringValue(input.eventKey);

  if (explicitKey) {
    return `bug-${createHash("sha256").update(explicitKey).digest("hex").slice(0, 40)}`;
  }

  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const fingerprint = [
    context.workspaceId ?? "unknown-workspace",
    context.userId ?? "unknown-user",
    bucket,
    fingerprintSource(input),
  ].join(":");

  return `bug-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 40)}`;
}

function notificationRows(
  input: InternalBugNotificationInput,
  context: InternalBugNotificationContext,
) {
  return [
    ["Severity", input.severity ?? "error"],
    ["Kind", clipped(input.kind, 240)],
    ["Source", clipped(input.source, 240)],
    ["Workspace", clipped(context.workspaceName || "Unknown")],
    ["Workspace ID", clipped(context.workspaceId || "Unknown")],
    ["User", clipped(context.userEmail || "Unknown")],
    ["User ID", clipped(context.userId || "Unknown")],
    ["Visible to user", clipped(input.visibleMessage || "Not provided")],
    ["Raw detail", clipped(input.rawMessage || "Not provided")],
    ["Page", clipped(input.pageUrl || "Unknown")],
    ["User agent", clipped(input.userAgent || "Unknown", 800)],
    ["Context", prettyJson(input.context) || "None"],
  ] as const;
}

export async function sendInternalBugNotification({
  context,
  input,
}: {
  context: InternalBugNotificationContext;
  input: InternalBugNotificationInput;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = configuredBugNotificationEmails();

  if (!apiKey || to.length === 0) {
    return { reason: "not_configured", sent: false };
  }

  const rows = notificationRows(input, context);
  const subject = `Kyro bug alert: ${clipped(input.kind || input.source, 80)}`;
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const htmlRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-size:13px;font-weight:600;vertical-align:top;word-break:break-word;white-space:pre-wrap;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: internalNotificationFromAddress(),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.45;color:#0f172a;">
          <h1 style="font-size:20px;margin:0 0 12px;">Kyro bug alert</h1>
          <p style="margin:0 0 18px;color:#475569;">A user-facing system issue was shown in the app.</p>
          <table style="border-collapse:collapse;width:100%;max-width:760px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tbody>${htmlRows}</tbody>
          </table>
        </div>`,
      subject,
      text,
      to,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey(input, context),
    },
    method: "POST",
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Resend bug notification failed with ${response.status}: ${responseText}`,
    );
  }

  return { reason: null, sent: true };
}
