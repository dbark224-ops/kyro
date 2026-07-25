import {
  autocompleteAddresses,
  type GoogleAutocompletePrimaryType,
} from "../../../../../lib/addresses/google";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";
import { recordGoogleApiUsage } from "../../../../../lib/usage/google";
import { getWorkspaceGeneralSettings } from "../../../../../lib/workspace/general-settings";

// Mirrors apps/web/src/app/api/addresses/autocomplete/route.ts, reusing the same
// server-only Google Places helper and usage metering so mobile lookups are
// billed and rate-shaped identically to the web app. This route did not exist on
// main -- the mobile client called it and got a 404 -- so it is added here rather
// than ported from the mobile branch's own copy, which re-implemented raw fetch
// calls to Google directly and never recorded usage.
export const dynamic = "force-dynamic";

function primaryType(value: string | null): GoogleAutocompletePrimaryType {
  return value === "cities"
    ? "cities"
    : value === "regions"
      ? "regions"
      : "address";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("q") ?? "";
  const sessionToken = url.searchParams.get("sessionToken");
  const type = primaryType(url.searchParams.get("type"));

  // Auth/workspace failures go through the normal mobile error response (401,
  // etc.) so the client can prompt reauth. Only the Google lookup itself
  // degrades gracefully -- a provider outage should not look like a signed-out
  // session, and it should not surface raw provider error detail to an end user.
  let context: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>;

  try {
    context = await requireMobileWorkspaceContext(request);
  } catch (authError) {
    return mobileErrorResponse(authError);
  }

  const { supabase, user, workspace } = context;

  try {
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
        sourceRoute: "api.mobile.addresses.autocomplete",
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

    return Response.json({ data: suggestions });
  } catch {
    return Response.json({ data: [], unavailable: true });
  }
}
