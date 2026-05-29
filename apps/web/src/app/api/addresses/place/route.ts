import { getAddressPlaceDetails } from "../../../../lib/addresses/google";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get("placeId") ?? "";
  const sessionToken = request.nextUrl.searchParams.get("sessionToken");

  try {
    await requireWorkspaceContext();

    const address = await getAddressPlaceDetails({
      placeId,
      sessionToken,
      validate: true,
    });

    return NextResponse.json({ data: address });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load address details.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
