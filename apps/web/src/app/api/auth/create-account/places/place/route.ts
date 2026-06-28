import { getAddressPlaceDetails } from "../../../../../../lib/addresses/google";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get("placeId")?.trim() ?? "";
  const sessionToken = request.nextUrl.searchParams.get("sessionToken");

  if (!placeId) {
    return NextResponse.json(
      { error: "Google place id is required." },
      { status: 400 },
    );
  }

  try {
    const place = await getAddressPlaceDetails({
      placeId,
      sessionToken,
      validate: false,
    });

    return NextResponse.json({ data: place });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load place details.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
