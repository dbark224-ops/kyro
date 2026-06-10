import { NextResponse } from "next/server";
import { createPaymentRequestCheckoutLink } from "../../../../lib/payments/accounts";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function boolValue(value: unknown) {
  return value === true || value === "true" || value === "on";
}

function stripePaymentMethod(value: unknown) {
  const method = textValue(value)?.toLowerCase();

  return method === "card" ? method : null;
}

async function createContactIfNeeded({
  body,
  supabase,
  workspaceId,
}: {
  body: Record<string, unknown>;
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  workspaceId: string;
}) {
  const existingContactId = textValue(body.contactId);

  if (existingContactId) {
    return existingContactId;
  }

  const contact = objectValue(body.newContact);
  const name = textValue(contact.name);
  const email = textValue(contact.email);
  const phone = textValue(contact.phone);
  const company = textValue(contact.company ?? body.recipientBusinessName);

  if (!name && !email && !phone && !company) {
    return null;
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      company,
      contact_type: "client",
      email,
      name: name ?? company ?? phone ?? email,
      phone,
      source: "payment_request",
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create payment contact: ${error.message}`);
  }

  return String(data.id);
}

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceContext();
    const body = objectValue(await request.json().catch(() => null));
    const rawLineItems = arrayValue(body.lineItems);
    const lineItems = rawLineItems
      .map((item) => {
        const row = objectValue(item);
        const description = textValue(row.description);
        const amountCents = Math.max(0, Math.round(numberValue(row.amountCents)));
        const quantity = Math.max(1, Math.round(numberValue(row.quantity) || 1));

        return description && amountCents > 0
          ? { amountCents, description, quantity }
          : null;
      })
      .filter(
        (item): item is { amountCents: number; description: string; quantity: number } =>
          Boolean(item),
      );
    const amountCents =
      lineItems.length > 0
        ? lineItems.reduce(
            (total, item) => total + item.amountCents * item.quantity,
            0,
          )
        : Math.round(numberValue(body.amountCents));
    const description =
      textValue(body.description) ??
      lineItems[0]?.description ??
      "Kyro payment request";

    if (!Number.isFinite(amountCents) || amountCents < 50) {
      return NextResponse.json(
        { error: "Enter a payment amount of at least 50 cents." },
        { status: 400 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

    if (!appUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_APP_URL is not configured." },
        { status: 500 },
      );
    }

    const supabase = createServiceSupabaseClient();
    const contactId = await createContactIfNeeded({
      body,
      supabase,
      workspaceId: workspace.id,
    });
    const requestedPaymentMethodTypes = [
      ...new Set(arrayValue(body.paymentMethods).map(stripePaymentMethod)),
    ].filter((item): item is "card" => item === "card");
    const paymentMethodTypes =
      requestedPaymentMethodTypes.length > 0 ? requestedPaymentMethodTypes : ["card"];
    const result = await createPaymentRequestCheckoutLink({
      amountCents,
      cancelUrl: `${appUrl}/payments?engine_message=Payment%20link%20draft%20cancelled.`,
      contactId,
      conversationId: textValue(body.conversationId),
      currency: textValue(body.currency),
      description,
      dueAt: textValue(body.dueAt),
      lineItems,
      metadata: {
        notifyChannels: JSON.stringify(arrayValue(body.notifyChannels)),
        notifyEmail: textValue(body.notifyEmail) ?? "",
        notifyPhone: textValue(body.notifyPhone) ?? "",
        paymentInstructions: textValue(body.paymentInstructions) ?? "",
        paymentMethods: JSON.stringify(arrayValue(body.paymentMethods)),
        recipientBusinessName: textValue(body.recipientBusinessName) ?? "",
        recipientTaxId: textValue(body.recipientTaxId) ?? "",
        source: "kyro_payments_page",
        taxIncluded: String(boolValue(body.taxIncluded)),
      },
      paymentMethodTypes,
      quoteDraftId: textValue(body.quoteDraftId),
      successUrl: `${appUrl}/payments?engine_message=Payment%20received.`,
      supabase,
      userId: user.id,
      workspaceId: workspace.id,
    });

    return NextResponse.json({
      paymentRequestId: result.id,
      providerCheckoutSessionId: result.providerCheckoutSessionId,
      url: result.paymentUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create payment link.",
      },
      { status: 500 },
    );
  }
}
