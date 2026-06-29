import { resetWorkspaceStripePaymentAccount } from "../../../../../lib/payments/accounts";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { workspace } = await requireWorkspaceContext();
    const reset = await resetWorkspaceStripePaymentAccount({
      supabase: createServiceSupabaseClient(),
      workspaceId: workspace.id,
    });

    revalidatePath("/settings");
    revalidatePath("/payments");

    return NextResponse.json({
      message: reset
        ? "Stripe setup has been reset. Start setup again to create a fresh payout account."
        : "There was no Stripe setup to reset.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset Stripe setup.",
      },
      { status: 500 },
    );
  }
}
