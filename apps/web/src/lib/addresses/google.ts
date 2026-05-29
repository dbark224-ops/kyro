import type { AddressSuggestion, StructuredAddress } from "./types";
import type { PhoneRegion } from "../crm/identity";

const PLACES_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";
const ADDRESS_VALIDATION_URL =
  "https://addressvalidation.googleapis.com/v1:validateAddress";

type GoogleAddressComponent = {
  languageCode?: string;
  longText?: string;
  shortText?: string;
  types?: string[];
};

type GooglePlaceDetails = {
  addressComponents?: GoogleAddressComponent[];
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
  types?: string[];
};

type GoogleLocationBias = {
  circle: {
    center: {
      latitude: number;
      longitude: number;
    };
    radius: number;
  };
};

function mapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

function addressValidationApiKey() {
  return (
    process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY?.trim() || mapsApiKey()
  );
}

export function hasGoogleAddressLookupConfig() {
  return Boolean(mapsApiKey());
}

function googleRegionCode(region?: PhoneRegion | string | null) {
  const normalized = region?.trim().toUpperCase();

  if (!normalized) {
    return undefined;
  }

  return normalized === "GB" ? "uk" : normalized.toLowerCase();
}

function googleIncludedRegionCode(region?: PhoneRegion | string | null) {
  const normalized = region?.trim().toUpperCase();

  if (!normalized) {
    return undefined;
  }

  return normalized.toLowerCase();
}

function numberEnv(key: string) {
  const value = process.env[key]?.trim();

  if (!value) {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

function googleLocationBias(): GoogleLocationBias | undefined {
  const latitude = numberEnv("GOOGLE_MAPS_LOCATION_BIAS_LAT");
  const longitude = numberEnv("GOOGLE_MAPS_LOCATION_BIAS_LNG");
  const configuredRadius =
    numberEnv("GOOGLE_MAPS_LOCATION_BIAS_RADIUS_METERS") ?? 50000;

  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    configuredRadius <= 0
  ) {
    return undefined;
  }

  const radius = Math.min(configuredRadius, 50000);

  return {
    circle: {
      center: {
        latitude,
        longitude,
      },
      radius,
    },
  };
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function componentText(
  components: GoogleAddressComponent[],
  type: string,
  mode: "long" | "short" = "long",
) {
  const component = components.find((entry) => entry.types?.includes(type));

  return textValue(mode === "short" ? component?.shortText : component?.longText);
}

function buildLine1(components: GoogleAddressComponent[], details: GooglePlaceDetails) {
  const streetNumber = componentText(components, "street_number");
  const route = componentText(components, "route");
  const premise = componentText(components, "premise");
  const subpremise = componentText(components, "subpremise");
  const lineFromPostal = textValue(details.postalAddress?.addressLines?.[0]);
  const mainLine = [streetNumber, route].filter(Boolean).join(" ").trim();
  const unitLine = subpremise ? `Unit ${subpremise}` : null;

  return textValue([unitLine, mainLine || premise || lineFromPostal].filter(Boolean).join(", "));
}

function normalizePlaceDetails(
  details: GooglePlaceDetails,
  validation?: Partial<StructuredAddress> | null,
): StructuredAddress {
  const components = details.addressComponents ?? [];
  const countryCode =
    componentText(components, "country", "short") ??
    textValue(details.postalAddress?.regionCode);
  const structured: StructuredAddress = {
    administrativeArea:
      componentText(components, "administrative_area_level_1", "short") ??
      textValue(details.postalAddress?.administrativeArea),
    countryCode: countryCode?.toUpperCase() ?? null,
    formattedAddress:
      textValue(validation?.formattedAddress) ??
      textValue(details.formattedAddress) ??
      textValue(details.shortFormattedAddress),
    latitude: details.location?.latitude ?? null,
    line1: buildLine1(components, details),
    line2: null,
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
    raw: {
      addressComponents: components,
      googlePlace: details,
      validation,
    },
    source: validation?.source === "google_address_validation"
      ? "google_address_validation"
      : "google_places",
    validationMessage: validation?.validationMessage ?? null,
    validationStatus:
      validation?.validationStatus === "validated"
        ? "validated"
        : validation?.validationStatus === "needs_review"
          ? "needs_review"
          : "google_place",
  };

  return structured;
}

function normalizeValidationResult(value: unknown): Partial<StructuredAddress> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const result = value as {
    result?: {
      address?: {
        formattedAddress?: string;
      };
      verdict?: {
        addressComplete?: boolean;
        hasInferredComponents?: boolean;
        hasReplacedComponents?: boolean;
        hasUnconfirmedComponents?: boolean;
        validationGranularity?: string;
      };
    };
  };
  const verdict = result.result?.verdict;

  if (!verdict) {
    return null;
  }

  const needsReview =
    verdict.hasUnconfirmedComponents ||
    verdict.hasInferredComponents ||
    verdict.hasReplacedComponents ||
    !verdict.addressComplete;

  return {
    formattedAddress: textValue(result.result?.address?.formattedAddress),
    source: "google_address_validation",
    validationMessage: needsReview
      ? `Google validation returned ${verdict.validationGranularity ?? "partial"} granularity.`
      : "Google Address Validation accepted this address.",
    validationStatus: needsReview ? "needs_review" : "validated",
  };
}

export async function autocompleteAddresses({
  input,
  region,
  sessionToken,
}: {
  input: string;
  region?: PhoneRegion | string | null;
  sessionToken?: string | null;
}): Promise<AddressSuggestion[]> {
  const apiKey = mapsApiKey();
  const trimmed = input.trim();

  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }

  if (trimmed.length < 3) {
    return [];
  }

  const includedRegionCode = googleIncludedRegionCode(region);

  const response = await fetch(PLACES_AUTOCOMPLETE_URL, {
    body: JSON.stringify({
      input: trimmed,
      includedRegionCodes: includedRegionCode ? [includedRegionCode] : undefined,
      includePureServiceAreaBusinesses: false,
      locationBias: googleLocationBias(),
      regionCode: googleRegionCode(region),
      sessionToken: sessionToken || undefined,
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Google address autocomplete failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
        text?: { text?: string };
      };
    }>;
  };

  return (payload.suggestions ?? [])
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction): prediction is NonNullable<typeof prediction> =>
      Boolean(prediction?.placeId && prediction.text?.text),
    )
    .map((prediction) => ({
      description: prediction.text?.text ?? "",
      mainText:
        prediction.structuredFormat?.mainText?.text ??
        prediction.text?.text ??
        "",
      placeId: prediction.placeId ?? "",
      secondaryText:
        textValue(prediction.structuredFormat?.secondaryText?.text) ?? null,
    }));
}

async function validateGoogleAddress(
  address: StructuredAddress,
): Promise<Partial<StructuredAddress> | null> {
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
      return {
        validationMessage: `Address Validation API returned ${response.status}.`,
        validationStatus: "google_place",
      };
    }

    return normalizeValidationResult(await response.json());
  } catch {
    return {
      validationMessage: "Address Validation API could not be reached.",
      validationStatus: "google_place",
    };
  }
}

export async function getAddressPlaceDetails({
  placeId,
  sessionToken,
  validate = true,
}: {
  placeId: string;
  sessionToken?: string | null;
  validate?: boolean;
}): Promise<StructuredAddress> {
  const apiKey = mapsApiKey();
  const normalizedPlaceId = placeId.replace(/^places\//, "").trim();

  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }

  if (!normalizedPlaceId) {
    throw new Error("Google place id is required.");
  }

  const url = new URL(`${PLACES_DETAILS_URL}/${encodeURIComponent(normalizedPlaceId)}`);

  if (sessionToken) {
    url.searchParams.set("sessionToken", sessionToken);
  }

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "id,formattedAddress,shortFormattedAddress,addressComponents,postalAddress,location,types",
    },
  });

  if (!response.ok) {
    throw new Error(`Google place details failed (${response.status}).`);
  }

  const place = (await response.json()) as GooglePlaceDetails;
  const initialAddress = normalizePlaceDetails(place);
  const validation = validate
    ? await validateGoogleAddress(initialAddress)
    : null;

  return normalizePlaceDetails(place, validation);
}
