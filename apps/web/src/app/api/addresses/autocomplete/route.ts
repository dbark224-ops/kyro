import {
  autocompleteAddresses,
  type GoogleAutocompletePrimaryType,
} from "../../../../lib/addresses/google";
import { developerAccessEnabled } from "../../../../lib/auth/developer-access";
import { recordGoogleApiUsage } from "../../../../lib/usage/google";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../../../lib/workspace/general-settings";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function primaryType(value: string | null): GoogleAutocompletePrimaryType {
  return value === "cities"
    ? "cities"
    : value === "regions"
      ? "regions"
      : "address";
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("q") ?? "";
  const sessionToken = request.nextUrl.searchParams.get("sessionToken");
  const type = primaryType(request.nextUrl.searchParams.get("type"));
  let showProviderErrors = false;

  try {
    const { supabase, user, workspace } = await requireWorkspaceContext();
    showProviderErrors = developerAccessEnabled(user);
    const generalSettings = await getWorkspaceGeneralSettings(
      supabase,
      workspace.id,
    );
    const suggestions = await autocompleteAddresses({
      input,
      primaryType: type,
      region: generalSettings.defaultPhoneRegion,
      sessionToken,
    });

    recordGoogleApiUsage(supabase, {
      kind: "places_autocomplete",
      metadata: {
        resultCount: suggestions.length,
        searchType: type,
        sourceRoute: "api.addresses.autocomplete",
      },
      userId: user.id,
      workspaceId: workspace.id,
    }).catch((usageError) => {
      console.error(
        usageError instanceof Error
          ? usageError.message
          : "Unable to record Google autocomplete usage.",
      );
    });

    return NextResponse.json({ data: suggestions });
  } catch (error) {
    if (!showProviderErrors) {
      return NextResponse.json({ data: [], unavailable: true });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to search Google addresses.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
