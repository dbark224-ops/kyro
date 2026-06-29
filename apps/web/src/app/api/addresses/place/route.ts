import { getAddressPlaceDetails } from "../../../../lib/addresses/google";
import { developerAccessEnabled } from "../../../../lib/auth/developer-access";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get("placeId") ?? "";
  const sessionToken = request.nextUrl.searchParams.get("sessionToken");
  let showProviderErrors = false;

  try {
    const { user } = await requireWorkspaceContext();
    showProviderErrors = developerAccessEnabled(user);

    const address = await getAddressPlaceDetails({
      placeId,
      sessionToken,
      validate: true,
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
