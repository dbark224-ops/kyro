import { autocompleteAddresses } from "../../../../lib/addresses/google";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../../../lib/workspace/general-settings";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("q") ?? "";
  const sessionToken = request.nextUrl.searchParams.get("sessionToken");

  try {
    const { supabase, workspace } = await requireWorkspaceContext();
    const generalSettings = await getWorkspaceGeneralSettings(
      supabase,
      workspace.id,
    );
    const suggestions = await autocompleteAddresses({
      input,
      region: generalSettings.defaultPhoneRegion,
      sessionToken,
    });

    return NextResponse.json({ data: suggestions });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to search Google addresses.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
