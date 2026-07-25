export type AddressValidationStatus =
  | "manual"
  | "unverified"
  | "google_place"
  | "validated"
  | "needs_review";

export type StructuredAddress = {
  administrativeArea: string | null;
  countryCode: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  line1: string | null;
  line2: string | null;
  locality: string | null;
  longitude: number | null;
  placeId: string | null;
  postalCode: string | null;
  provider: "google" | "manual";
  raw?: Record<string, unknown>;
  source: "google_address_validation" | "google_places" | "manual";
  validationMessage?: string | null;
  validationStatus: AddressValidationStatus;
};

export type AddressSuggestion = {
  description: string;
  mainText: string;
  placeId: string;
  secondaryText: string | null;
};

export type AddressColumnUpdates = {
  address: string | null;
  address_administrative_area: string | null;
  address_country_code: string | null;
  address_latitude: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_locality: string | null;
  address_longitude: string | null;
  address_place_id: string | null;
  address_postal_code: string | null;
  address_source: string;
  address_structured: StructuredAddress | Record<string, unknown>;
  address_validated_at: string | null;
  address_validation_status: AddressValidationStatus;
};
