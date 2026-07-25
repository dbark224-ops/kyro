import type { AddressColumnUpdates, StructuredAddress } from "./types";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const text = textValue(value);

  if (!text) {
    return null;
  }

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}

function safeJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function formText(formData: FormData, key: string) {
  return textValue(formData.get(key));
}

export function parseAddressFormData(
  formData: FormData,
  name = "address",
): AddressColumnUpdates {
  const typedAddress = formText(formData, name);
  const formattedAddress = formText(formData, `${name}Formatted`);
  const placeId = formText(formData, `${name}GooglePlaceId`);
  const line1 = formText(formData, `${name}Line1`);
  const line2 = formText(formData, `${name}Line2`);
  const locality = formText(formData, `${name}Locality`);
  const administrativeArea = formText(
    formData,
    `${name}AdministrativeArea`,
  );
  const postalCode = formText(formData, `${name}PostalCode`);
  const countryCode =
    formText(formData, `${name}CountryCode`)?.toUpperCase() ?? null;
  const latitude = numberValue(formData.get(`${name}Latitude`));
  const longitude = numberValue(formData.get(`${name}Longitude`));
  const validationStatus =
    formText(formData, `${name}ValidationStatus`) ?? "unverified";
  const source = formText(formData, `${name}Source`) ?? "manual";
  const rawStructured = safeJsonObject(formText(formData, `${name}Structured`));
  const address = formattedAddress ?? typedAddress;
  const hasGoogleAddress = Boolean(placeId || formattedAddress);

  if (!address) {
    return {
      address: null,
      address_administrative_area: null,
      address_country_code: null,
      address_latitude: null,
      address_line1: null,
      address_line2: null,
      address_locality: null,
      address_longitude: null,
      address_place_id: null,
      address_postal_code: null,
      address_source: "manual",
      address_structured: {},
      address_validated_at: null,
      address_validation_status: "unverified",
    };
  }

  if (!hasGoogleAddress) {
    return {
      address,
      address_administrative_area: null,
      address_country_code: null,
      address_latitude: null,
      address_line1: null,
      address_line2: null,
      address_locality: null,
      address_longitude: null,
      address_place_id: null,
      address_postal_code: null,
      address_source: "manual",
      address_structured: {
        administrativeArea: null,
        countryCode: null,
        formattedAddress: address,
        latitude: null,
        line1: null,
        line2: null,
        locality: null,
        longitude: null,
        placeId: null,
        postalCode: null,
        provider: "manual",
        source: "manual",
        validationStatus: "manual",
      },
      address_validated_at: null,
      address_validation_status: "manual",
    };
  }

  const structured: StructuredAddress = {
    administrativeArea,
    countryCode,
    formattedAddress: address,
    latitude,
    line1,
    line2,
    locality,
    longitude,
    placeId,
    postalCode,
    provider: "google",
    raw: rawStructured,
    source:
      source === "google_address_validation"
        ? "google_address_validation"
        : "google_places",
    validationMessage: textValue(rawStructured.validationMessage),
    validationStatus:
      validationStatus === "validated"
        ? "validated"
        : validationStatus === "needs_review"
          ? "needs_review"
          : "google_place",
  };

  return {
    address,
    address_administrative_area: administrativeArea,
    address_country_code: countryCode,
    address_latitude: latitude === null ? null : String(latitude),
    address_line1: line1,
    address_line2: line2,
    address_locality: locality,
    address_longitude: longitude === null ? null : String(longitude),
    address_place_id: placeId,
    address_postal_code: postalCode,
    address_source: structured.source,
    address_structured: structured,
    address_validated_at:
      structured.validationStatus === "validated"
        ? new Date().toISOString()
        : null,
    address_validation_status: structured.validationStatus,
  };
}
