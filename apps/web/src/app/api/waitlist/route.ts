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

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
      enquiry_volume: stringValue(payload.enquiryVolume) || null,
      industry,
      location,
      metadata: {
        referrer: request.headers.get("referer"),
        sourceUrl: request.url,
        userAgent: request.headers.get("user-agent"),
      },
      name,
      normalized_email: emailNormalized,
      notes: stringValue(payload.notes) || null,
      phone: stringValue(payload.phone) || null,
      service_area: stringValue(payload.serviceArea) || null,
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

  return NextResponse.json({ ok: true });
}
