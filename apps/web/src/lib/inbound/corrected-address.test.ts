import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addressWorthLearning } from "../addresses/replace";

/**
 * A corrected address never reached the contact record.
 *
 * Measured end to end. The customer's first email gave 1120 Lomas Blvd NE. The
 * follow-up said: "Sorry -- I gave you the wrong address. That's our old
 * place. We're at 3820 Rio Grande Blvd NW now. Please don't send anyone to the
 * Lomas address."
 *
 * The reply was right and said exactly that. inquiry_facts held the new
 * address. The contact card still read Lomas -- the one address he had just
 * told the business not to visit.
 *
 * I assumed for a while that never replacing was protecting a curated home
 * address from being overwritten by a job site, and said so more than once as
 * a reason to leave it alone. Checking the data killed that: for the
 * two-address inquiry the contact's address is the rental job site, not the
 * postal address. The stored value is simply whichever arrived first, so there
 * was nothing being protected.
 *
 * "manual" in address_validation_status is the one genuinely curated case --
 * a human typed it -- and that is what is now off limits.
 */
const auto = {
  address: "1120 Lomas Boulevard Northeast, Albuquerque, NM 87102, USA",
  addressValidationStatus: "needs_review",
};

describe("an address Kyro derived", () => {
  it("is replaced by a correction", () => {
    assert.equal(
      addressWorthLearning(
        auto,
        "3820 Rio Grande Boulevard Northwest, Albuquerque, NM 87107-3044, USA",
      ),
      true,
    );
  });

  it("is still filled when the contact has none", () => {
    assert.equal(
      addressWorthLearning(
        { address: null, addressValidationStatus: null },
        "615 Girard Blvd NE",
      ),
      true,
    );
  });

  it("is replaced whatever verdict it carried", () => {
    for (const status of ["needs_review", "unverified", "validated", null]) {
      assert.equal(
        addressWorthLearning({ ...auto, addressValidationStatus: status }, "3820 Rio Grande Blvd NW"),
        true,
        String(status),
      );
    }
  });
});

describe("what must not be touched", () => {
  it("never overwrites an address a human typed", () => {
    assert.equal(
      addressWorthLearning(
        { ...auto, addressValidationStatus: "manual" },
        "3820 Rio Grande Blvd NW",
      ),
      false,
    );
  });

  it("does no write when the address has not changed", () => {
    assert.equal(addressWorthLearning(auto, auto.address), false);
    assert.equal(addressWorthLearning(auto, `  ${auto.address}  `), false);
  });

  it("does not clear a known address because this message carried none", () => {
    // An inquiry that mentions no address must leave the stored one alone.
    assert.equal(addressWorthLearning(auto, null), false);
    assert.equal(
      addressWorthLearning({ address: null, addressValidationStatus: null }, null),
      false,
    );
  });
});
