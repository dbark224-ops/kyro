import { getAddressPlaceDetails } from "../../../../lib/addresses/google";
import { developerAccessEnabled } from "../../../../lib/auth/developer-access";
import { recordGoogleApiUsage } from "../../../../lib/usage/google";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get("placeId") ?? "";
  const sessionToken = request.nextUrl.searchParams.get("sessionToken");
  let showProviderErrors = false;

  try {
    const { supabase, user, workspace } = await requireWorkspaceContext();
    showProviderErrors = developerAccessEnabled(user);

    const address = await getAddressPlaceDetails({
      placeId,
      sessionToken,
      validate: true,
    });
    const commonMetadata = {
      placeId,
      sourceRoute: "api.addresses.place",
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

    return NextResponse.json({ data: address });
  } catch (error) {
    if (!showProviderErrors) {
      return NextResponse.json({ data: null, unavailable: true });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to load address details.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
