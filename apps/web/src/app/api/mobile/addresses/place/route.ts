import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};
type GooglePlaceDetails = {
  addressComponents?: AddressComponent[];
  formattedAddress?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  postalAddress?: {
    addressLines?: string[];
    administrativeArea?: string;
    locality?: string;
    postalCode?: string;
    regionCode?: string;
  };
  shortFormattedAddress?: string;
};
type LegacyAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};
type LegacyPlaceDetailsPayload = {
  error_message?: string;
  result?: {
    address_components?: LegacyAddressComponent[];
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    place_id?: string;
  };
  status?: string;
};
type StructuredAddress = {
  administrativeArea: string | null;
  countryCode: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  line1: string | null;
  locality: string | null;
  longitude: number | null;
  placeId: string | null;
  postalCode: string | null;
  provider: "google";
  source: "google_address_validation" | "google_places";
  validationMessage: string | null;
  validationStatus: "google_place" | "needs_review" | "validated";
};

const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";
const LEGACY_PLACES_DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json";
const ADDRESS_VALIDATION_URL =
  "https://addressvalidation.googleapis.com/v1:validateAddress";

export async function GET(request: Request) {
  try {
    await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const placeId = textValue(url.searchParams.get("placeId"));
    const sessionToken = textValue(url.searchParams.get("sessionToken"));

    if (!placeId) {
      return Response.json(
        { error: "Google place id is required." },
        { status: 400 },
      );
    }

    try {
      const data = await getAddressPlaceDetails({ placeId, sessionToken });

      return Response.json({ data });
    } catch (error) {
      return Response.json({
        data: null,
        message:
          error instanceof Error
            ? error.message
            : "Google address details are unavailable.",
        unavailable: true,
      });
    }
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

async function getAddressPlaceDetails({
  placeId,
  sessionToken,
}: {
  placeId: string;
  sessionToken?: string | null;
}) {
  const apiKey = mapsApiKey();
  const normalizedPlaceId = placeId.replace(/^places\//, "").trim();
  const url = new URL(
    `${PLACES_DETAILS_URL}/${encodeURIComponent(normalizedPlaceId)}`,
  );

  if (sessionToken) {
    url.searchParams.set("sessionToken", sessionToken);
  }

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "id,formattedAddress,shortFormattedAddress,addressComponents,postalAddress,location",
    },
  });

  if (!response.ok) {
    return getAddressPlaceDetailsLegacy({ placeId: normalizedPlaceId });
  }

  const place = (await response.json()) as GooglePlaceDetails;
  const initialAddress = normalizePlaceDetails(place);
  const validation = await validateGoogleAddress(initialAddress);

  return normalizePlaceDetails(place, validation);
}

async function getAddressPlaceDetailsLegacy({ placeId }: { placeId: string }) {
  const url = new URL(LEGACY_PLACES_DETAILS_URL);

  url.searchParams.set("key", mapsApiKey());
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    "place_id,formatted_address,address_components,geometry",
  );

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google place details failed (${response.status}).`);
  }

  const payload = (await response.json()) as LegacyPlaceDetailsPayload;

  if (payload.status && payload.status !== "OK") {
    throw new Error(
      payload.error_message || "Google place details are unavailable.",
    );
  }

  const result = payload.result ?? {};
  const place: GooglePlaceDetails = {
    addressComponents: (result.address_components ?? []).map((component) => ({
      longText: component.long_name,
      shortText: component.short_name,
      types: component.types,
    })),
    formattedAddress: result.formatted_address,
    id: result.place_id ?? placeId,
    location: {
      latitude: result.geometry?.location?.lat,
      longitude: result.geometry?.location?.lng,
    },
  };
  const initialAddress = normalizePlaceDetails(place);
  const validation = await validateGoogleAddress(initialAddress);

  return normalizePlaceDetails(place, validation);
}

async function validateGoogleAddress(address: StructuredAddress) {
  const apiKey = addressValidationApiKey();

  if (!apiKey || !address.formattedAddress) {
    return null;
  }

  try {
    const response = await fetch(ADDRESS_VALIDATION_URL, {
      body: JSON.stringify({
        address: {
          addressLines: [address.formattedAddress],
          regionCode: address.countryCode ?? undefined,
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      method: "POST",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      result?: {
        address?: { formattedAddress?: string };
        verdict?: {
          addressComplete?: boolean;
          hasInferredComponents?: boolean;
          hasReplacedComponents?: boolean;
          hasUnconfirmedComponents?: boolean;
          validationGranularity?: string;
        };
      };
    };
    const verdict = payload.result?.verdict;

    if (!verdict) {
      return null;
    }

    const needsReview =
      verdict.hasUnconfirmedComponents ||
      verdict.hasInferredComponents ||
      verdict.hasReplacedComponents ||
      !verdict.addressComplete;

    return {
      formattedAddress: textValue(payload.result?.address?.formattedAddress),
      source: "google_address_validation" as const,
      validationMessage: needsReview
        ? `Google validation returned ${verdict.validationGranularity ?? "partial"} granularity.`
        : "Google Address Validation accepted this address.",
      validationStatus: needsReview ? "needs_review" as const : "validated" as const,
    };
  } catch {
    return null;
  }
}

function normalizePlaceDetails(
  details: GooglePlaceDetails,
  validation?: {
    formattedAddress: string | null;
    source: "google_address_validation";
    validationMessage: string;
    validationStatus: "needs_review" | "validated";
  } | null,
): StructuredAddress {
  const components = details.addressComponents ?? [];
  const countryCode =
    componentText(components, "country", "short") ??
    textValue(details.postalAddress?.regionCode);

  return {
    administrativeArea:
      componentText(components, "administrative_area_level_1", "short") ??
      textValue(details.postalAddress?.administrativeArea),
    countryCode: countryCode?.toUpperCase() ?? null,
    formattedAddress:
      validation?.formattedAddress ??
      textValue(details.formattedAddress) ??
      textValue(details.shortFormattedAddress),
    latitude: details.location?.latitude ?? null,
    line1: buildLine1(components, details),
    locality:
      componentText(components, "locality") ??
      componentText(components, "postal_town") ??
      componentText(components, "administrative_area_level_2") ??
      textValue(details.postalAddress?.locality),
    longitude: details.location?.longitude ?? null,
    placeId: textValue(details.id),
    postalCode:
      componentText(components, "postal_code") ??
      textValue(details.postalAddress?.postalCode),
    provider: "google",
    source:
      validation?.source === "google_address_validation"
        ? "google_address_validation"
        : "google_places",
    validationMessage: validation?.validationMessage ?? null,
    validationStatus: validation?.validationStatus ?? "google_place",
  };
}

function buildLine1(components: AddressComponent[], details: GooglePlaceDetails) {
  const streetNumber = componentText(components, "street_number");
  const route = componentText(components, "route");
  const premise = componentText(components, "premise");
  const subpremise = componentText(components, "subpremise");
  const lineFromPostal = textValue(details.postalAddress?.addressLines?.[0]);
  const mainLine = [streetNumber, route].filter(Boolean).join(" ").trim();
  const unitLine = subpremise ? `Unit ${subpremise}` : null;

  return textValue(
    [unitLine, mainLine || premise || lineFromPostal]
      .filter(Boolean)
      .join(", "),
  );
}

function componentText(
  components: AddressComponent[],
  type: string,
  mode: "long" | "short" = "long",
) {
  const component = components.find((entry) => entry.types?.includes(type));

  return textValue(mode === "short" ? component?.shortText : component?.longText);
}

function mapsApiKey() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";

  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }

  return apiKey;
}

function addressValidationApiKey() {
  return (
    process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY?.trim() ??
    process.env.GOOGLE_MAPS_API_KEY?.trim() ??
    ""
  );
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
