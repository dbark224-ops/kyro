import {
  autocompleteAddresses,
  type GoogleAutocompletePrimaryType,
} from "../../../../../../lib/addresses/google";
import { textValueOrEmpty as textValue } from "@kyro/core";
import { operatingCountryPhoneRegion } from "../../../../../../lib/workspace/operating-countries";
import { withinPlacesRateLimit } from "../rate-limit";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

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

  // This route is pre-signup, so it cannot require auth -- but it spends real
  // money at Google on every call. Without a limit anyone can run up the bill,
  // and because there is no workspace yet the spend cannot be metered to one,
  // so it would not appear in the usage dashboard either. Keyed on client IP.
  //
  // Over the limit we return the same shape as a provider outage rather than an
  // error: the signup form falls back to free-text entry, so a throttled user
  // can still finish signing up.
  if (!(await withinPlacesRateLimit(request.headers, "autocomplete"))) {
    return NextResponse.json({ data: [], unavailable: true });
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
