import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";
import { getWorkspaceGeneralSettings } from "../../../../../lib/workspace/general-settings";

export const dynamic = "force-dynamic";

type GoogleAutocompletePrimaryType = "address" | "cities" | "regions";
type AddressSuggestion = {
  description: string;
  mainText: string;
  placeId: string;
  secondaryText: string | null;
};
type GoogleAutocompletePayload = {
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
type LegacyAutocompletePayload = {
  error_message?: string;
  predictions?: Array<{
    description?: string;
    place_id?: string;
    structured_formatting?: {
      main_text?: string;
      secondary_text?: string;
    };
  }>;
  status?: string;
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

const PLACES_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
const LEGACY_PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";

export async function GET(request: Request) {
  try {
    const context = await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const input = textValue(url.searchParams.get("q")) ?? "";
    const sessionToken = textValue(url.searchParams.get("sessionToken"));
    const primaryType = normalizePrimaryType(url.searchParams.get("type"));

    if (input.length < 3) {
      return Response.json({ data: [] });
    }

    const general = await getWorkspaceGeneralSettings(
      context.supabase,
      context.workspace.id,
    );

    try {
      const data = await autocompleteAddresses({
        input,
        primaryType,
        region: general.defaultPhoneRegion,
        sessionToken,
      });

      return Response.json({ data });
    } catch (error) {
      return Response.json({
        data: [],
        message:
          error instanceof Error
            ? error.message
            : "Google address lookup is unavailable.",
        unavailable: true,
      });
    }
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

async function autocompleteAddresses({
  input,
  primaryType,
  region,
  sessionToken,
}: {
  input: string;
  primaryType: GoogleAutocompletePrimaryType;
  region?: string | null;
  sessionToken?: string | null;
}): Promise<AddressSuggestion[]> {
  const apiKey = mapsApiKey();
  const includedRegionCode = googleIncludedRegionCode(region);
  const response = await fetch(PLACES_AUTOCOMPLETE_URL, {
    body: JSON.stringify({
      includePureServiceAreaBusinesses: false,
      includedPrimaryTypes: googleIncludedPrimaryTypes(primaryType),
      includedRegionCodes: includedRegionCode ? [includedRegionCode] : undefined,
      input,
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
    return autocompleteAddressesLegacy({
      input,
      primaryType,
      region,
      sessionToken,
    });
  }

  const payload = (await response.json()) as GoogleAutocompletePayload;

  return (payload.suggestions ?? [])
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction): prediction is NonNullable<typeof prediction> =>
      Boolean(prediction?.placeId && prediction.text?.text),
    )
    .map((prediction) => ({
      description: prediction.text?.text ?? "",
      mainText:
        textValue(prediction.structuredFormat?.mainText?.text) ??
        prediction.text?.text ??
        "",
      placeId: prediction.placeId ?? "",
      secondaryText:
        textValue(prediction.structuredFormat?.secondaryText?.text) ?? null,
    }));
}

async function autocompleteAddressesLegacy({
  input,
  primaryType,
  region,
  sessionToken,
}: {
  input: string;
  primaryType: GoogleAutocompletePrimaryType;
  region?: string | null;
  sessionToken?: string | null;
}): Promise<AddressSuggestion[]> {
  const url = new URL(LEGACY_PLACES_AUTOCOMPLETE_URL);
  const includedRegionCode = googleIncludedRegionCode(region);

  url.searchParams.set("input", input);
  url.searchParams.set("key", mapsApiKey());
  url.searchParams.set("types", googleLegacyAutocompleteType(primaryType));

  if (includedRegionCode) {
    url.searchParams.set("components", `country:${includedRegionCode}`);
  }

  if (sessionToken) {
    url.searchParams.set("sessiontoken", sessionToken);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google address autocomplete failed (${response.status}).`);
  }

  const payload = (await response.json()) as LegacyAutocompletePayload;

  if (payload.status && !["OK", "ZERO_RESULTS"].includes(payload.status)) {
    throw new Error(
      payload.error_message || "Google address autocomplete is unavailable.",
    );
  }

  return (payload.predictions ?? [])
    .filter((prediction) =>
      Boolean(prediction.place_id && prediction.description),
    )
    .map((prediction) => ({
      description: prediction.description ?? "",
      mainText:
        textValue(prediction.structured_formatting?.main_text) ??
        prediction.description ??
        "",
      placeId: prediction.place_id ?? "",
      secondaryText:
        textValue(prediction.structured_formatting?.secondary_text) ?? null,
    }));
}

function mapsApiKey() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";

  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }

  return apiKey;
}

function normalizePrimaryType(
  value: string | null,
): GoogleAutocompletePrimaryType {
  return value === "cities" || value === "regions" ? value : "address";
}

function googleIncludedPrimaryTypes(type: GoogleAutocompletePrimaryType) {
  if (type === "cities") {
    return ["(cities)"];
  }

  if (type === "regions") {
    return ["(regions)"];
  }

  return undefined;
}

function googleLegacyAutocompleteType(type: GoogleAutocompletePrimaryType) {
  if (type === "cities") {
    return "(cities)";
  }

  if (type === "regions") {
    return "(regions)";
  }

  return "address";
}

function googleRegionCode(region?: string | null) {
  const normalized = region?.trim().toUpperCase();

  if (!normalized) {
    return undefined;
  }

  return normalized === "GB" ? "uk" : normalized.toLowerCase();
}

function googleIncludedRegionCode(region?: string | null) {
  const normalized = region?.trim().toUpperCase();

  return normalized ? normalized.toLowerCase() : undefined;
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

  return {
    circle: {
      center: {
        latitude,
        longitude,
      },
      radius: Math.min(configuredRadius, 50000),
    },
  };
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
