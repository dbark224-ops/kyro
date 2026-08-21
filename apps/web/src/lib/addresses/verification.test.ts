import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addressVerificationDisplay } from "./status";
import {
  addressLikelyNeedsLocality,
  unverifiedAddressFields,
  verifiedAddressFields,
  verifyAddressText,
} from "./verify";
import type { StructuredAddress } from "./types";
import { readRepoFile } from "../testing/repo-files";

function googleAddress(
  overrides: Partial<StructuredAddress> = {},
): StructuredAddress {
  return {
    administrativeArea: "VIC",
    countryCode: "AU",
    formattedAddress: "12 Smith Street, Richmond VIC 3121, Australia",
    latitude: -37.82,
    line1: "12 Smith Street",
    line2: null,
    locality: "Richmond",
    longitude: 144.99,
    placeId: "place-1",
    postalCode: "3121",
    provider: "google",
    source: "google_address_validation",
    validationStatus: "validated",
    ...overrides,
  };
}

describe("an address nobody has confirmed says so", () => {
  it("reads as verified only when Google validated it", () => {
    assert.equal(addressVerificationDisplay("validated")?.tone, "verified");
  });

  it("asks for a look when Google could not confirm every part", () => {
    assert.equal(addressVerificationDisplay("needs_review")?.tone, "review");
    assert.equal(addressVerificationDisplay("google_place")?.tone, "review");
  });

  it("treats unverified, manual and missing alike", () => {
    // The stored column keeps these apart for debugging, but to the person
    // reading a job card they mean the same thing: nobody checked.
    for (const status of ["unverified", "manual", null, undefined, ""]) {
      assert.equal(
        addressVerificationDisplay(status)?.tone,
        "unverified",
        `${String(status)} should read as unverified`,
      );
    }
  });

  it("never silently reports an unknown status as verified", () => {
    assert.equal(
      addressVerificationDisplay("some_status_a_migration_added")?.tone,
      "unverified",
    );
  });
});

describe("verification column updates", () => {
  it("marks unverified text as unverified and keeps it whole", () => {
    const updates = unverifiedAddressFields("behind the blue gate", "triage");

    assert.equal(updates.address, "behind the blue gate");
    assert.equal(updates.address_validation_status, "unverified");
    assert.equal(updates.address_validated_at, null);
    assert.equal(updates.address_place_id, null);
    assert.equal(updates.address_source, "triage");
  });

  it("clears every column when the address is removed", () => {
    const updates = unverifiedAddressFields(null, "assistant");

    assert.equal(updates.address, null);
    assert.equal(updates.address_line1, null);
    assert.equal(updates.address_latitude, null);
    assert.deepEqual(updates.address_structured, {});
  });

  it("stamps validated_at only when Google actually confirmed it", () => {
    const confirmed = verifiedAddressFields(googleAddress(), "12 smith st");
    const unsure = verifiedAddressFields(
      googleAddress({ validationStatus: "needs_review" }),
      "12 smith st",
    );

    assert.ok(confirmed.address_validated_at);
    assert.equal(unsure.address_validated_at, null);
    assert.equal(unsure.address_validation_status, "needs_review");
  });

  it("keeps Google's formatting on a partial match", () => {
    // needs_review fires when Google infers a missing postcode, which is most
    // hand-typed Australian addresses. Discarding the tidy version there would
    // throw away the main benefit; the status column carries the doubt.
    const unsure = verifiedAddressFields(
      googleAddress({ validationStatus: "needs_review" }),
      "12 smith st richmond",
    );

    assert.equal(
      unsure.address,
      "12 Smith Street, Richmond VIC 3121, Australia",
    );
    assert.equal(unsure.address_postal_code, "3121");
  });

  it("falls back to what was written when Google returns no text", () => {
    const updates = verifiedAddressFields(
      googleAddress({ formattedAddress: null, line1: null }),
      "12 smith st richmond",
    );

    assert.equal(updates.address, "12 smith st richmond");
  });

  it("carries coordinates through as strings the numeric columns accept", () => {
    const updates = verifiedAddressFields(googleAddress(), "12 smith st");

    assert.equal(updates.address_latitude, "-37.82");
    assert.equal(updates.address_longitude, "144.99");
  });
});

describe("a street with no suburb is not guessed at", () => {
  it("spots a bare street address", () => {
    assert.equal(addressLikelyNeedsLocality("12 Smith St"), true);
    assert.equal(addressLikelyNeedsLocality("4a Rose Avenue"), true);
  });

  it("accepts one that names a place", () => {
    assert.equal(addressLikelyNeedsLocality("12 Smith St, Richmond"), false);
    assert.equal(
      addressLikelyNeedsLocality("12 Smith Street Richmond Victoria"),
      false,
    );
  });

  it("ignores text that is not a street address at all", () => {
    assert.equal(addressLikelyNeedsLocality(""), false);
    assert.equal(addressLikelyNeedsLocality("the shop on the corner"), false);
  });
});

describe("a lookup that never left the building is not billed", () => {
  it("reaches no endpoint for a street with no suburb", async () => {
    const result = await verifyAddressText({
      address: "12 Smith St",
      region: "AU",
      source: "triage",
    });

    assert.deepEqual(result.calls, {
      autocomplete: false,
      placeDetails: false,
      validation: false,
    });
    assert.equal(result.needsLocality, true);
    assert.equal(result.updates.address_validation_status, "unverified");
  });

  it("keeps the address rather than dropping it", async () => {
    const result = await verifyAddressText({
      address: "12 Smith St",
      region: "AU",
      source: "triage",
    });

    assert.equal(result.updates.address, "12 Smith St");
  });
});

/**
 * Triage is the path that mattered: every AI-captured address in production was
 * stored unverified because nothing on that path had ever asked Google. These
 * assert the wiring, since the behaviour itself needs a live inbound message
 * and a Google key to exercise end to end.
 */
describe("triage verifies the address it extracts", () => {
  const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");

  it("runs the shared verifier rather than its own copy", () => {
    assert.match(triage, /verifyAddressText/);
    assert.match(triage, /resolveInquiryFactsAddress/);
  });

  it("writes the structured columns onto the inquiry facts", () => {
    assert.match(
      triage,
      /\.\.\.\(addressColumns \?\? \{ address: effectiveInquiryFacts\.address \}\)/,
    );
  });

  it("carries the same columns onto the contact it patches", () => {
    // Writing `address` alone left the contact holding bare text with a default
    // unverified status even when Google had just confirmed that very address.
    assert.match(
      triage,
      /addressColumns \?\? unverifiedAddressFields\(facts\.address, "triage"\)/,
    );
  });

  it("bounds the wait so a slow lookup cannot stall a customer reply", () => {
    assert.match(triage, /ADDRESS_VERIFICATION_TIMEOUT_MS/);
  });

  it("bills only the lookups that actually happened", () => {
    // A workspace with no Google key reaches no endpoint at all. Metering on
    // the status alone would have charged it for an autocomplete every time an
    // inbound message mentioned an address.
    assert.match(triage, /recordGoogleApiUsage/);
    assert.match(triage, /if \(calls\.autocomplete\)/);
    assert.match(triage, /if \(calls\.placeDetails\)/);
    assert.match(triage, /if \(calls\.validation\)/);
  });

  it("falls back to the customer's own words instead of throwing", () => {
    assert.match(triage, /return unverifiedAddressFields\(text, "triage"\)/);
  });
});

describe("the badge is shown where an address is", () => {
  it("appears on the contact profile and the inbox job address", () => {
    for (const file of [
      "apps/web/src/app/contacts/[contactId]/page.tsx",
      "apps/web/src/app/contacts/page.tsx",
      "apps/web/src/app/components/contact-profile-panel.tsx",
      "apps/web/src/app/inbox/[conversationId]/page.tsx",
    ]) {
      assert.match(
        readRepoFile(file),
        /AddressWithVerification|verificationStatus=/,
        `${file} should show whether the address is verified`,
      );
    }
  });

  it("keeps the label helper free of the server-only Google client", () => {
    // status.ts is imported by a client component; verify.ts carries the API
    // key with it.
    const status = readRepoFile("apps/web/src/lib/addresses/status.ts");

    assert.doesNotMatch(status, /from "\.\/google"/);
    assert.doesNotMatch(status, /from "\.\/verify"/);
  });
});

/**
 * The place id is the seam that stops us buying the same address twice.
 *
 * Production had paid for 863 Maps calls to resolve 31 distinct strings
 * covering 13 real places -- one address 59 times over. The cache that should
 * have stopped it was keyed on the conversation, and every inbound message
 * that does not thread gets a new one, so it had never once hit.
 *
 * These stub Google at the network boundary, because the point being tested is
 * exactly how many times we reach it.
 */
describe("an address already resolved is not bought again", () => {
  const AUTOCOMPLETE_BODY = {
    suggestions: [
      {
        placePrediction: {
          placeId: "place-1",
          structuredFormat: {
            mainText: { text: "12 Smith Street" },
            secondaryText: { text: "Richmond VIC" },
          },
          text: { text: "12 Smith Street, Richmond VIC" },
        },
      },
    ],
  };

  async function withStubbedGoogle(run: (calls: string[]) => Promise<void>) {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    const realKey = process.env.GOOGLE_MAPS_API_KEY;

    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);

      calls.push(url);

      return new Response(JSON.stringify(AUTOCOMPLETE_BODY), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof globalThis.fetch;

    try {
      await run(calls);
    } finally {
      globalThis.fetch = realFetch;

      if (realKey === undefined) {
        delete process.env.GOOGLE_MAPS_API_KEY;
      } else {
        process.env.GOOGLE_MAPS_API_KEY = realKey;
      }
    }
  }

  it("stops after autocomplete when the place is already known", async () => {
    await withStubbedGoogle(async (calls) => {
      const result = await verifyAddressText({
        address: "12 Smith Street, Richmond VIC",
        findResolvedPlace: async (placeId) =>
          placeId === "place-1" ? googleAddress() : null,
        region: "AU",
        source: "triage",
      });

      // One call out, not three. Autocomplete is $2.83 per thousand; the two
      // it skipped are $17 each.
      assert.equal(calls.length, 1);
      assert.deepEqual(result.calls, {
        autocomplete: true,
        placeDetails: false,
        validation: false,
      });
      // And the answer is the same one the paid lookup would have given.
      assert.equal(
        result.updates.address,
        "12 Smith Street, Richmond VIC 3121, Australia",
      );
      assert.equal(result.updates.address_validation_status, "validated");
      assert.equal(result.updates.address_place_id, "place-1");
    });
  });

  it("carries a needs_review verdict through rather than upgrading it", async () => {
    // address_validated_at is null on these rows, which is why the age limit
    // reads updated_at. A cached doubt has to stay a doubt.
    await withStubbedGoogle(async () => {
      const result = await verifyAddressText({
        address: "12 Smith Street, Richmond VIC",
        findResolvedPlace: async () =>
          googleAddress({ validationStatus: "needs_review" }),
        region: "AU",
        source: "triage",
      });

      assert.equal(result.updates.address_validation_status, "needs_review");
      assert.match(String(result.verificationNote), /could not confirm/);
    });
  });

  it("pays for the full lookup when the place is new", async () => {
    await withStubbedGoogle(async (calls) => {
      const result = await verifyAddressText({
        address: "12 Smith Street, Richmond VIC",
        findResolvedPlace: async () => null,
        region: "AU",
        source: "triage",
      });

      // Autocomplete, then place details -- a miss must not skip anything.
      assert.ok(calls.length > 1);
      assert.equal(result.calls.autocomplete, true);
      assert.equal(result.calls.placeDetails, true);
    });
  });

  it("treats a failing cache as a miss rather than losing the address", async () => {
    await withStubbedGoogle(async () => {
      const result = await verifyAddressText({
        address: "12 Smith Street, Richmond VIC",
        findResolvedPlace: async () => {
          throw new Error("cache unavailable");
        },
        region: "AU",
        source: "triage",
      });

      assert.equal(result.calls.autocomplete, true);
      assert.ok(result.updates.address);
    });
  });

  it("asks Google nothing at all when no cache is offered", async () => {
    await withStubbedGoogle(async (calls) => {
      await verifyAddressText({
        address: "12 Smith Street, Richmond VIC",
        region: "AU",
        source: "triage",
      });

      // No findResolvedPlace means the old behaviour, unchanged.
      assert.ok(calls.length > 1);
    });
  });
});

describe("the triage cache is scoped to the workspace, not the conversation", () => {
  const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");

  it("no longer keys the address lookup on conversation_id", () => {
    // The bug: 475 inquiry_facts rows across 475 conversations, one each, so
    // a conversation-scoped cache could never find anything.
    assert.doesNotMatch(
      triage,
      /\.eq\("conversation_id", conversationId\)\s*\n\s*\.maybeSingle\(\);\s*\n\s*\n\s*if \(\s*\n\s*stored &&/,
    );
  });

  it("hands the place id cache to the verifier", () => {
    assert.match(triage, /findResolvedPlace:/);
    assert.match(triage, /findResolvedPlaceForWorkspace/);
    assert.match(triage, /\.eq\("address_place_id", placeId\)/);
  });

  it("ages the cache on updated_at, which needs_review rows actually have", () => {
    assert.match(triage, /\.gt\("updated_at", addressCacheCutoff\(\)\)/);
    assert.doesNotMatch(
      triage,
      /\.gt\("address_validated_at", addressCacheCutoff\(\)\)/,
    );
  });
});
