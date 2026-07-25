export const OPERATING_COUNTRY_OPTIONS = [
  { label: "Australia", value: "Australia", phoneRegion: "AU" },
  { label: "New Zealand", value: "New Zealand", phoneRegion: "NZ" },
  { label: "United Kingdom", value: "United Kingdom", phoneRegion: "GB" },
  { label: "USA", value: "USA", phoneRegion: "US" },
  { label: "Canada", value: "Canada", phoneRegion: "CA" },
] as const;

export type OperatingCountry =
  (typeof OPERATING_COUNTRY_OPTIONS)[number]["value"];

const operatingCountryValues = new Set<string>(
  OPERATING_COUNTRY_OPTIONS.map((option) => option.value),
);

export function isOperatingCountry(value: string): value is OperatingCountry {
  return operatingCountryValues.has(value);
}

export function operatingCountryPhoneRegion(value: string) {
  return (
    OPERATING_COUNTRY_OPTIONS.find((option) => option.value === value)
      ?.phoneRegion ?? null
  );
}

export function operatingCountryForPhoneRegion(value: string | null | undefined) {
  return (
    OPERATING_COUNTRY_OPTIONS.find((option) => option.phoneRegion === value)
      ?.value ?? ""
  );
}
