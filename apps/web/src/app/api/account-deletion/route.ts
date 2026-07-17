import { createServiceSupabaseClient } from "../../../lib/supabase/service";
import { consumeApiRateLimit } from "../../../lib/security/rate-limit";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AccountDeletionPayload = {
  businessName?: unknown;
  companyWebsite?: unknown;
  confirmation?: unknown;
  email?: unknown;
  name?: unknown;
  reason?: unknown;
  workspaceName?: unknown;
};

type AccountDeletionNotification = {
  businessName: string;
  email: string;
  name: string;
  reason: string;
  referrer: string;
  requestId: string;
  workspaceName: string;
};

const MAX_REQUEST_BYTES = 16_384;
const FIELD_LIMITS = {
  businessName: 160,
  email: 320,
  name: 160,
  reason: 2_000,
  workspaceName: 160,
} as const;

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function exceedsFieldLimits(values: {
  businessName: string;
  email: string;
  name: string;
  reason: string;
  workspaceName: string;
}) {
  return Object.entries(FIELD_LIMITS).some(
    ([field, limit]) => values[field as keyof typeof values].length > limit,
  );
}

function limitedHeader(value: string | null, maxLength: number) {
  return (value ?? "").trim().slice(0, maxLength);
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function configuredDeletionNotificationEmails() {
  const value =
    process.env.ACCOUNT_DELETION_NOTIFICATION_EMAIL?.trim() ||
    process.env.ACCOUNT_DELETION_NOTIFICATION_TO?.trim() ||
    process.env.WAITLIST_NOTIFICATION_EMAIL?.trim() ||
    process.env.WAITLIST_NOTIFICATION_TO?.trim() ||
    process.env.KYRO_DEVELOPER_EMAILS?.trim() ||
    "hello@workflowautomation.au";

  return value
    .split(/[,\s]+/)
    .map((email) => email.trim())
    .filter((email) => email && isValidEmail(email));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function notificationRows(details: AccountDeletionNotification) {
  return [
    ["Request ID", details.requestId],
    ["Name", details.name],
    ["Email", details.email],
    ["Business", details.businessName || "Not provided"],
    ["Workspace", details.workspaceName || "Not provided"],
    ["Reason", details.reason || "Not provided"],
    ["Referrer", details.referrer || "Direct or unavailable"],
  ] as const;
}

async function sendDeletionNotification(
  details: AccountDeletionNotification,
) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = configuredDeletionNotificationEmails();

  if (!apiKey || to.length === 0) {
    return;
  }

  const from =
    process.env.ACCOUNT_DELETION_NOTIFICATION_FROM?.trim() ||
    process.env.WAITLIST_NOTIFICATION_FROM?.trim() ||
    "Kyro <no-reply@mail.kyroassistant.com>";
  const rows = notificationRows(details);
  const subject = `Kyro account deletion request: ${details.email}`;
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const htmlRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:13px;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.45;color:#0f172a;">
          <h1 style="font-size:20px;margin:0 0 12px;">Kyro account deletion request</h1>
          <p style="margin:0 0 18px;color:#475569;">A user submitted the dedicated account deletion form.</p>
          <table style="border-collapse:collapse;width:100%;max-width:680px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
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
      "Idempotency-Key": `account-deletion-${details.requestId}`,
    },
    method: "POST",
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Resend deletion notification failed with ${response.status}: ${responseText}`,
    );
  }
}

export async function POST(request: Request) {
  let payload: AccountDeletionPayload;

  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);

    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "This deletion request is too large." },
        { status: 413 },
      );
    }

    const body = await request.text();

    if (body.length > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "This deletion request is too large." },
        { status: 413 },
      );
    }

    const parsed = JSON.parse(body) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid deletion request payload");
    }

    payload = parsed as AccountDeletionPayload;
  } catch {
    return NextResponse.json(
      { error: "Send valid account deletion details." },
      { status: 400 },
    );
  }

  if (stringValue(payload.companyWebsite)) {
    return NextResponse.json({ ok: true });
  }

  const name = stringValue(payload.name);
  const email = stringValue(payload.email);
  const businessName = stringValue(payload.businessName);
  const workspaceName = stringValue(payload.workspaceName);
  const reason = stringValue(payload.reason);
  const confirmation = stringValue(payload.confirmation);
  const referrer = limitedHeader(request.headers.get("referer"), 1_000);

  if (!name || !email || confirmation !== "delete") {
    return NextResponse.json(
      { error: "Complete the required deletion request fields." },
      { status: 400 },
    );
  }

  if (
    exceedsFieldLimits({ businessName, email, name, reason, workspaceName })
  ) {
    return NextResponse.json(
      { error: "One or more deletion request fields are too long." },
      { status: 400 },
    );
  }

  const emailNormalized = normalizedEmail(email);

  if (!isValidEmail(emailNormalized)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  let rateLimit;

  try {
    rateLimit = await consumeApiRateLimit({
      headers: request.headers,
      identifier: emailNormalized,
      maxRequests: 3,
      route: "public.account-deletion",
      windowSeconds: 60 * 60,
    });
  } catch (rateLimitError) {
    console.error(
      "Unable to enforce account deletion request rate limit",
      rateLimitError,
    );
    return NextResponse.json(
      { error: "Kyro could not save this deletion request." },
      { status: 503 },
    );
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      },
    );
  }

  let supabase;

  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { error: "Kyro could not save this deletion request." },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("account_deletion_requests")
    .insert({
      business_name: businessName || null,
      email,
      metadata: {
        referrer,
        sourceUrl: request.url,
        userAgent: limitedHeader(request.headers.get("user-agent"), 500),
      },
      name,
      normalized_email: emailNormalized,
      reason: reason || null,
      source: "website",
      workspace_name: workspaceName || null,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return NextResponse.json(
      { error: "Kyro could not save this deletion request." },
      { status: 500 },
    );
  }

  try {
    await sendDeletionNotification({
      businessName,
      email,
      name,
      reason,
      referrer,
      requestId: data.id,
      workspaceName,
    });
  } catch (notificationError) {
    console.error(
      "Unable to send account deletion notification",
      notificationError,
    );
  }

  return NextResponse.json({ ok: true, requestId: data.id });
}
