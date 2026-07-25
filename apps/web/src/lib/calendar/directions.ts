// Client-safe calendar helpers.
//
// This module must stay free of runtime imports so client components can use it
// without pulling the server-side calendar graph into the browser bundle.
// `events.ts` imports the action engine and provider-sync (Google/Microsoft
// Calendar APIs); importing a single helper from there shipped all of it to the
// client. Keep new additions here pure.

export type CalendarAddressMetadata = {
  administrativeArea: string | null;
  countryCode: string | null;
  formattedAddress: string | null;
  latitude: string | null;
  line1: string | null;
  line2: string | null;
  locality: string | null;
  longitude: string | null;
  placeId: string | null;
  postalCode: string | null;
  source: string | null;
  structured: Record<string, unknown>;
  validationStatus: string | null;
};

export function googleMapsDirectionsUrl(
  location: string | null,
  address: CalendarAddressMetadata | null,
) {
  const destination =
    address?.latitude && address.longitude
      ? `${address.latitude},${address.longitude}`
      : (address?.formattedAddress ?? location);

  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        destination,
      )}`
    : null;
}
