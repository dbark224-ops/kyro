import { createServiceSupabaseClient } from "../../../lib/supabase/service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WaitlistPayload = {
  adminFocus?: unknown;
  businessName?: unknown;
  email?: unknown;
  enquiryVolume?: unknown;
  industry?: unknown;
  location?: unknown;
  name?: unknown;
  notes?: unknown;
  phone?: unknown;
  serviceArea?: unknown;
};

type WaitlistNotification = {
  adminFocus: string;
  businessName: string;
  email: string;
  enquiryVolume: string;
  industry: string;
  location: string;
  name: string;
  notes: string;
  phone: string;
  referrer: string;
  serviceArea: string;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function configuredWaitlistNotificationEmails() {
  const value =
    process.env.WAITLIST_NOTIFICATION_EMAIL?.trim() ||
    process.env.WAITLIST_NOTIFICATION_TO?.trim() ||
    process.env.KYRO_DEVELOPER_EMAILS?.trim() ||
    "";

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

function notificationRows(details: WaitlistNotification) {
  return [
    ["Name", details.name],
    ["Email", details.email],
    ["Phone", details.phone || "Not provided"],
    ["Business", details.businessName],
    ["Industry", details.industry],
    ["Location", details.location],
    ["Service area", details.serviceArea || "Not provided"],
    ["Monthly enquiries", details.enquiryVolume || "Not provided"],
    ["Admin focus", details.adminFocus],
    ["Notes", details.notes || "Not provided"],
    ["Referrer", details.referrer || "Direct or unavailable"],
  ] as const;
}

async function sendWaitlistNotification(details: WaitlistNotification) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = configuredWaitlistNotificationEmails();

  if (!apiKey || to.length === 0) {
    return;
  }

  const from =
    process.env.WAITLIST_NOTIFICATION_FROM?.trim() ||
    "Kyro <onboarding@resend.dev>";
  const rows = notificationRows(details);
  const subject = `New Kyro waitlist signup: ${details.businessName}`;
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
          <h1 style="font-size:20px;margin:0 0 12px;">New Kyro waitlist signup</h1>
          <p style="margin:0 0 18px;color:#475569;">A visitor submitted the early access waitlist form.</p>
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
      "Idempotency-Key": `waitlist-${details.email.toLowerCase()}`,
    },
    method: "POST",
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Resend notification failed with ${response.status}: ${responseText}`,
    );
  }
}

export async function POST(request: Request) {
  let payload: WaitlistPayload;

  try {
    payload = (await request.json()) as WaitlistPayload;
  } catch {
    return NextResponse.json(
      { error: "Send valid waitlist details." },
      { status: 400 },
    );
  }

  const name = stringValue(payload.name);
  const email = stringValue(payload.email);
  const businessName = stringValue(payload.businessName);
  const industry = stringValue(payload.industry);
  const location = stringValue(payload.location);
  const adminFocus = stringValue(payload.adminFocus);
  const enquiryVolume = stringValue(payload.enquiryVolume);
  const notes = stringValue(payload.notes);
  const phone = stringValue(payload.phone);
  const serviceArea = stringValue(payload.serviceArea);
  const referrer = request.headers.get("referer") ?? "";

  if (!name || !email || !businessName || !industry || !location || !adminFocus) {
    return NextResponse.json(
      { error: "Complete the required waitlist fields." },
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

  let supabase;

  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { error: "Kyro waitlist is not configured yet." },
      { status: 500 },
    );
  }

  const { error } = await supabase.from("waitlist_signups").upsert(
    {
      admin_focus: adminFocus,
      business_name: businessName,
      email,
      enquiry_volume: enquiryVolume || null,
      industry,
      location,
      metadata: {
        referrer,
        sourceUrl: request.url,
        userAgent: request.headers.get("user-agent"),
      },
      name,
      normalized_email: emailNormalized,
      notes: notes || null,
      phone: phone || null,
      service_area: serviceArea || null,
      source: "website",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "normalized_email" },
  );

  if (error) {
    return NextResponse.json(
      { error: "Kyro could not save this waitlist request." },
      { status: 500 },
    );
  }

  try {
    await sendWaitlistNotification({
      adminFocus,
      businessName,
      email,
      enquiryVolume,
      industry,
      location,
      name,
      notes,
      phone,
      referrer,
      serviceArea,
    });
  } catch (notificationError) {
    console.error("Unable to send waitlist notification", notificationError);
  }

  return NextResponse.json({ ok: true });
}
