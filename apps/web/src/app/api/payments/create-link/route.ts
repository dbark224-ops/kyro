import { NextResponse } from "next/server";
import { createPaymentRequestCheckoutLink } from "../../../../lib/payments/accounts";
import { createServiceSupabaseClient } from "../../../../lib/supabase/service";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  const { user, workspace } = await requireWorkspaceContext();
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const amountCents = Number(body?.amountCents);
  const description = textValue(body?.description);

  if (!Number.isFinite(amountCents) || amountCents <= 0 || !description) {
    return NextResponse.json(
      { error: "amountCents and description are required." },
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

  const result = await createPaymentRequestCheckoutLink({
    amountCents: Math.round(amountCents),
    cancelUrl: `${appUrl}/settings?section=integrations`,
    contactId: textValue(body?.contactId),
    conversationId: textValue(body?.conversationId),
    currency: textValue(body?.currency),
    description,
    dueAt: textValue(body?.dueAt),
    metadata: {
      source: "kyro_api",
    },
    quoteDraftId: textValue(body?.quoteDraftId),
    successUrl: `${appUrl}/settings?section=integrations`,
    supabase: createServiceSupabaseClient(),
    userId: user.id,
    workspaceId: workspace.id,
  });

  return NextResponse.json({
    paymentRequestId: result.id,
    providerCheckoutSessionId: result.providerCheckoutSessionId,
    url: result.paymentUrl,
  });
}
