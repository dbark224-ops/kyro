import {
  autocompleteAddresses,
  getAddressPlaceDetails,
  hasGoogleAddressLookupConfig,
} from "./google";
import type { AddressColumnUpdates, StructuredAddress } from "./types";

/**
 * Turning a line of text into an address we can trust.
 *
 * This lived inside the CRM contact-update tool, which meant only one of the
 * three ways an address reaches Kyro ever went near Google. The other two --
 * triage extracting "we're at 12 Smith St" out of an inbound email, and the
 * voice agent -- wrote the raw sentence fragment into `address` and left the
 * thirteen structured columns null. Every AI-captured address in production was
 * stored as `unverified` because nothing had asked.
 *
 * Verification is best-effort by design. A customer who mistypes their street
 * should still get a reply; the address just carries a status saying nobody has
 * confirmed it, and the UI shows that. Failing the whole turn because Google
 * was slow would trade a small problem for a much larger one.
 */

export type AddressVerificationSource = "assistant" | "triage" | "voice";

/**
 * Which Google endpoints were actually reached.
 *
 * Callers meter what they spend, and several outcomes -- no key configured, a
 * street with no suburb, no matching place -- return before some or all of the
 * calls happen. Reporting this rather than guessing from the status keeps a
 * lookup that never left the building off the bill.
 */
export type AddressVerificationCalls = {
  autocomplete: boolean;
  placeDetails: boolean;
  validation: boolean;
};

export type AddressVerification = {
  calls: AddressVerificationCalls;
  /**
   * The address as it should be shown. Google's formatted version whenever
   * Google matched a place -- see `verifiedAddressFields`.
   */
  formattedAddress: string | null;
  /**
   * True when the text looks like a street address with no suburb or city, so
   * a lookup would be a coin flip between every town that has that street.
   * Callers that can ask a human should ask; callers that cannot should store
   * the text unverified.
   */
  needsLocality: boolean;
  updates: AddressColumnUpdates;
  /** Present when there is something a person should know. */
  verificationNote?: string;
};

export function addressLikelyNeedsLocality(address: string) {
  const normalized = address.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return false;
  }

  const hasStreetNumber = /^\d+[a-zA-Z]?\s+\S+/.test(normalized);
  const hasSeparator = /[,;]/.test(normalized);
  const wordCount = normalized.split(" ").filter(Boolean).length;

  return hasStreetNumber && !hasSeparator && wordCount <= 4;
}

export function unverifiedAddressFields(
  address: string | null,
  source: AddressVerificationSource,
): AddressColumnUpdates {
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
      address_source: source,
      address_structured: {},
      address_validated_at: null,
      address_validation_status: "unverified",
    };
  }

  return {
    address,
    address_administrative_area: null,
    address_country_code: null,
    address_latitude: null,
    address_line1: address,
    address_line2: null,
    address_locality: null,
    address_longitude: null,
    address_place_id: null,
    address_postal_code: null,
    address_source: source,
    address_structured: {
      administrativeArea: null,
      countryCode: null,
      formattedAddress: address,
      latitude: null,
      line1: address,
      line2: null,
      locality: null,
      longitude: null,
      placeId: null,
      postalCode: null,
      provider: source,
      source,
      validationStatus: "unverified",
    },
    address_validated_at: null,
    address_validation_status: "unverified",
  };
}

export function verifiedAddressFields(
  address: StructuredAddress,
  /** What the person or model wrote, used only if Google returned no text. */
  originalAddress: string,
): AddressColumnUpdates {
  const confirmed = address.validationStatus === "validated";

  return {
    // Google's formatting wins whenever it matched a real place, even on a
    // needs_review verdict: that verdict fires when Google infers a missing
    // postcode, which is most Australian addresses typed by hand and is an
    // improvement rather than a doubt. The status column carries the doubt,
    // and the UI shows it.
    address: address.formattedAddress ?? address.line1 ?? originalAddress,
    address_administrative_area: address.administrativeArea,
    address_country_code: address.countryCode,
    address_latitude:
      address.latitude === null ? null : String(address.latitude),
    address_line1: address.line1,
    address_line2: address.line2,
    address_locality: address.locality,
    address_longitude:
      address.longitude === null ? null : String(address.longitude),
    address_place_id: address.placeId,
    address_postal_code: address.postalCode,
    address_source: address.source,
    address_structured: address,
    address_validated_at: confirmed ? new Date().toISOString() : null,
    address_validation_status: address.validationStatus,
  };
}

/**
 * Ask Google what this text is.
 *
 * Two calls: autocomplete to turn the text into a place, then place details
 * with validation to get the structured parts and a verdict. Anything that
 * goes wrong -- no key configured, no match, a timeout -- returns the original
 * text marked unverified rather than throwing, because every caller is in the
 * middle of handling a customer.
 */
export async function verifyAddressText({
  address,
  region,
  source,
}: {
  address: string;
  region: string | null;
  source: AddressVerificationSource;
}): Promise<AddressVerification> {
  const noCalls: AddressVerificationCalls = {
    autocomplete: false,
    placeDetails: false,
    validation: false,
  };

  if (addressLikelyNeedsLocality(address)) {
    return {
      calls: noCalls,
      formattedAddress: address,
      needsLocality: true,
      updates: unverifiedAddressFields(address, source),
      verificationNote:
        "This address has no suburb or city, so it could not be confirmed.",
    };
  }

  if (!hasGoogleAddressLookupConfig()) {
    return {
      calls: noCalls,
      formattedAddress: address,
      needsLocality: false,
      updates: unverifiedAddressFields(address, source),
      verificationNote: "Google address verification is not configured.",
    };
  }

  try {
    const suggestions = await autocompleteAddresses({ input: address, region });
    const [bestSuggestion] = suggestions;

    if (!bestSuggestion) {
      return {
        calls: { ...noCalls, autocomplete: true },
        formattedAddress: address,
        needsLocality: false,
        updates: unverifiedAddressFields(address, source),
        verificationNote: "Google could not find a matching address.",
      };
    }

    const structuredAddress = await getAddressPlaceDetails({
      placeId: bestSuggestion.placeId,
      validate: true,
    });
    const updates = verifiedAddressFields(structuredAddress, address);

    return {
      calls: { autocomplete: true, placeDetails: true, validation: true },
      formattedAddress: updates.address,
      needsLocality: false,
      updates,
      verificationNote:
        structuredAddress.validationStatus === "validated"
          ? undefined
          : "Google found a close match but could not confirm it, so this is worth checking.",
    };
  } catch (error) {
    return {
      // Autocomplete is the first call, so it is the one that may have been
      // billed before the failure. Nothing after it is charged for.
      calls: { ...noCalls, autocomplete: true },
      formattedAddress: address,
      needsLocality: false,
      updates: unverifiedAddressFields(address, source),
      verificationNote:
        error instanceof Error
          ? `Google address verification failed: ${error.message}`
          : "Google address verification failed.",
    };
  }
}
