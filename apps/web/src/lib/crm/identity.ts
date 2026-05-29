import {
  getCountries,
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

function parsedE164(
  value: string,
  defaultCountry?: CountryCode,
  options: { allowPossible?: boolean } = {},
) {
  const phone = parsePhoneNumberFromString(value, defaultCountry);

  if (!phone) {
    return null;
  }

  if (!phone.isValid() && !(options.allowPossible && phone.isPossible())) {
    return null;
  }

  return phone.number;
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

function fallbackInternationalDigits(digits: string) {
  if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")) {
    return `+${digits}`;
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

function prioritizedCountryOrder(
  digits: string,
  defaultCountry?: CountryCode | null,
) {
  const priority: CountryCode[] = [];

  if (defaultCountry) {
    priority.push(defaultCountry);
  }

  if (/^[2-9]\d{9}$/.test(digits)) {
    priority.push("US", "CA");
  } else if (/^1[3-9]\d{9}$/.test(digits)) {
    priority.push("US", "CA", "CN", "HK", "SG");
  } else if (/^4\d{8}$/.test(digits)) {
    priority.push("AU");
  } else if (/^0[2378]\d{8}$/.test(digits) || /^04\d{8}$/.test(digits)) {
    priority.push("AU", "NZ", "GB", "IE", "ZA");
  } else if (/^0\d{10}$/.test(digits)) {
    priority.push("GB", "IE", "NZ", "ZA", "AU");
  } else if (digits.startsWith("0")) {
    priority.push("AU", "GB", "NZ", "IE", "ZA");
  }

  return [
    ...priority,
    ...phoneCountrySearchOrder.filter((country) => !priority.includes(country)),
  ];
}

export function normalizeContactPhone(value?: string | null) {
  return normalizeContactPhoneForRegion(value, null);
}

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
    return (
      parsedE164(internationalCandidate, undefined, { allowPossible: true }) ??
      fallbackInternationalDigits(internationalCandidate.replace(/\D/g, "")) ??
      digits
    );
  }

  const normalizedDefaultCountry = defaultCountry
    ? normalizePhoneRegion(String(defaultCountry), DEFAULT_PHONE_REGION)
    : null;
  const countryOrder = prioritizedCountryOrder(
    digits,
    normalizedDefaultCountry,
  );

  for (const country of countryOrder) {
    const parsed = parsedE164(withoutExtension, country);

    if (parsed) {
      return parsed;
    }
  }

  for (const country of countryOrder) {
    const parsed = parsedE164(withoutExtension, country, {
      allowPossible: true,
    });

    if (parsed) {
      return parsed;
    }
  }

  const countryCodeCandidate = fallbackInternationalDigits(digits);

  if (countryCodeCandidate) {
    const parsed = parsedE164(countryCodeCandidate, undefined, {
      allowPossible: true,
    });

    if (parsed) {
      return parsed;
    }
  }

  return countryCodeCandidate ?? digits;
}

export function normalizeCompanyName(value?: string | null) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();

  return normalized ? normalized : null;
}
