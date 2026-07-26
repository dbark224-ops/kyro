import { getAddressPlaceDetails } from "../../../../../../lib/addresses/google";
import { withinPlacesRateLimit } from "../rate-limit";
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

  // See ../rate-limit: unauthenticated, paid, and previously unthrottled.
  if (!(await withinPlacesRateLimit(request.headers, "place"))) {
    return NextResponse.json({ data: null, unavailable: true });
  }

  try {
    const place = await getAddressPlaceDetails({
      placeId,
      sessionToken,
      validate: false,
    });

    return NextResponse.json({ data: place });
  } catch {
    return NextResponse.json({ data: null, unavailable: true });
  }
}
