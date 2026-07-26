import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneRegion = CountryCode;

const preferredPhoneCountries: CountryCode[] = [
  "AU",
  "US",
  "GB",
  "NZ",
  "CA",
  "IE",
  "SG",
  "IN",
  "PH",
  "ZA",
  "AE",
  "CN",
  "HK",
  "MY",
];

const phoneCountrySearchOrder = [
  ...preferredPhoneCountries,
  ...getCountries().filter(
    (country) => !preferredPhoneCountries.includes(country),
  ),
];

export const DEFAULT_PHONE_REGION: CountryCode = "AU";

export const PHONE_REGION_OPTIONS = phoneCountrySearchOrder.map((country) => ({
  label: country,
  value: country,
}));

const extensionPattern = /\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i;

export function normalizeContactEmail(value?: string | null) {
  const trimmed = value?.trim().toLowerCase();

  return trimmed ? trimmed : null;
}

function parsedE164(value: string, defaultCountry?: CountryCode) {
  const phone = parsePhoneNumberFromString(value, defaultCountry);

  return phone?.isValid() ? phone.number : null;
}

function explicitInternationalCandidate(raw: string, digits: string) {
  const withoutWhitespace = raw.replace(/\s+/g, "");

  if (withoutWhitespace.startsWith("+")) {
    return `+${digits}`;
  }

  if (digits.startsWith("0011") && digits.length > 5) {
    return `+${digits.slice(4)}`;
  }

  if (digits.startsWith("011") && digits.length > 5) {
    return `+${digits.slice(3)}`;
  }

  if (digits.startsWith("00") && digits.length > 4) {
    return `+${digits.slice(2)}`;
  }

  return null;
}

export function normalizePhoneRegion(
  value?: string | null,
  fallback: CountryCode = DEFAULT_PHONE_REGION,
): CountryCode {
  const normalized = value?.trim().toUpperCase();

  return normalized && getCountries().includes(normalized as CountryCode)
    ? (normalized as CountryCode)
    : fallback;
}

/**
 * Canonicalize a phone number for a workspace.
 *
 * Kyro workspaces are hard-set to one operating country, and the customers of a
 * local service business are overwhelmingly in that country. So a number is
 * read one of two ways and no other:
 *
 *   1. Written with an explicit country code (`+61...`, `0011 1 415...`) --
 *      honoured as written, so genuine overseas contacts still work.
 *   2. Written the local way (`0412 345 678`, `412 345 678`, `02 9374 4000`) --
 *      read as a number in the workspace's own country.
 *
 * Both spellings of the same local number land on the identical E.164 string,
 * so `+61412345678`, `0412345678` and `412345678` are one contact, not three.
 *
 * If it parses as neither, the number is NOT quietly reinterpreted as some
 * other country's. The previous implementation searched every country until
 * something validated, which turned an unusable GB number into a valid-looking
 * Indian one and hid the mistake -- a wrong number that looks right is worse
 * than an obviously broken one. Instead the digits are returned unchanged: a
 * stable key that still groups the contact, is visibly not E.164, and fails
 * `isDialablePhoneNumber` so the contact is flagged for a human to fix.
 */
export function normalizeContactPhoneForRegion(
  value?: string | null,
  defaultCountry?: CountryCode | string | null,
) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withoutExtension = trimmed.replace(extensionPattern, "");
  const digits = withoutExtension.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  const internationalCandidate = explicitInternationalCandidate(
    withoutExtension,
    digits,
  );

  if (internationalCandidate) {
    return parsedE164(internationalCandidate) ?? digits;
  }

  const region = normalizePhoneRegion(
    defaultCountry ? String(defaultCountry) : null,
    DEFAULT_PHONE_REGION,
  );
  const localReading = parsedE164(withoutExtension, region);

  if (localReading) {
    return localReading;
  }

  // Same number, no plus: `61412345678` alongside `+61412345678`. Restricted to
  // the workspace's own calling code, and only reached once the local reading
  // has failed. Without that restriction a bare US number in an AU workspace
  // would parse as `+41...` and quietly become Swiss -- the manufactured wrong
  // answer this function exists to avoid.
  const callingCode = getCountryCallingCode(region);

  if (digits.startsWith(callingCode)) {
    const withPlus = parsedE164(`+${digits}`);

    if (withPlus) {
      return withPlus;
    }
  }

  return digits;
}

/**
 * Whether a number can actually be dialled, as opposed to merely stored.
 *
 * `normalizeContactPhoneForRegion` returns E.164 only when the number genuinely
 * parses -- as an explicit international number, or as a local number in the
 * workspace's own country. Anything else comes back as bare digits, which is
 * deliberately not a phone number. So "did normalization produce E.164?" is
 * exactly the question this needs to ask.
 *
 * `+1575855239` (nine digits after the country code) is stored, shown to the
 * user as they typed it, and reported here as undialable rather than being
 * retried against Twilio until the job dead-letters.
 */
export function isDialablePhoneNumber(
  value?: string | null,
  defaultCountry?: CountryCode | string | null,
) {
  const normalized = normalizeContactPhoneForRegion(value, defaultCountry);

  return Boolean(normalized?.startsWith("+"));
}

export function normalizeCompanyName(value?: string | null) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();

  return normalized ? normalized : null;
}
