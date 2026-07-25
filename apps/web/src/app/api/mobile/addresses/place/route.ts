import { getAddressPlaceDetails } from "../../../../../lib/addresses/google";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";
import { recordGoogleApiUsage } from "../../../../../lib/usage/google";

// Mirrors apps/web/src/app/api/addresses/place/route.ts. See addresses/autocomplete
// for why this is a fresh implementation reusing main's Google helpers rather than
// a port of the mobile branch's raw-fetch copy.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId") ?? "";
  const sessionToken = url.searchParams.get("sessionToken");

  let context: Awaited<ReturnType<typeof requireMobileWorkspaceContext>>;

  try {
    context = await requireMobileWorkspaceContext(request);
  } catch (authError) {
    return mobileErrorResponse(authError);
  }

  const { supabase, user, workspace } = context;

  try {
    const address = await getAddressPlaceDetails({
      placeId,
      sessionToken,
      validate: true,
    });
    const commonMetadata = {
      placeId,
      sourceRoute: "api.mobile.addresses.place",
    };

    Promise.all([
      recordGoogleApiUsage(supabase, {
        kind: "places_details",
        metadata: {
          ...commonMetadata,
          validationStatus: address.validationStatus,
        },
        userId: user.id,
        workspaceId: workspace.id,
      }),
      address.formattedAddress
        ? recordGoogleApiUsage(supabase, {
            kind: "address_validation",
            metadata: commonMetadata,
            userId: user.id,
            workspaceId: workspace.id,
          })
        : Promise.resolve(),
    ]).catch((usageError) => {
      console.error(
        usageError instanceof Error
          ? usageError.message
          : "Unable to record Google place usage.",
      );
    });

    return Response.json({ data: address });
  } catch {
    return Response.json({ data: null, unavailable: true });
  }
}
