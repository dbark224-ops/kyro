import {
  autocompleteAddresses,
  type GoogleAutocompletePrimaryType,
} from "../../../../../../lib/addresses/google";
import { operatingCountryPhoneRegion } from "../../../../../../lib/workspace/operating-countries";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function textValue(value: string | null) {
  return value?.trim() || "";
}

function primaryType(value: string | null): GoogleAutocompletePrimaryType {
  return value === "cities" ? "cities" : "regions";
}

function regionFromCountry(value: string | null) {
  const country = textValue(value);

  if (!country) {
    return null;
  }

  return operatingCountryPhoneRegion(country) ?? country;
}

export async function GET(request: NextRequest) {
  const input = textValue(request.nextUrl.searchParams.get("q")).slice(0, 120);
  const country = request.nextUrl.searchParams.get("country");
  const sessionToken = request.nextUrl.searchParams.get("sessionToken");
  const type = primaryType(request.nextUrl.searchParams.get("type"));

  if (input.length < 3) {
    return NextResponse.json({ data: [] });
  }

  try {
    const suggestions = await autocompleteAddresses({
      input,
      primaryType: type,
      region: regionFromCountry(country),
      sessionToken,
    });

    return NextResponse.json({ data: suggestions });
  } catch {
    return NextResponse.json({ data: [], unavailable: true });
  }
}
