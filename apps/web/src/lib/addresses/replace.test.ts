import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addressWorthLearning } from "./replace";

const contact = (address: string | null, addressValidationStatus: string | null = "validated") => ({
  address,
  addressValidationStatus,
});

describe("whether a new address replaces the one on a contact", () => {
  it("fills a blank and honours a real correction", () => {
    assert.equal(addressWorthLearning(contact(null), "3820 Rio Grande Blvd NW"), true);
    assert.equal(
      addressWorthLearning(contact("1200 Lomas Blvd NE"), "3820 Rio Grande Blvd NW"),
      true,
    );
  });

  it("never touches an address a human typed", () => {
    assert.equal(
      addressWorthLearning(contact("1200 Lomas Blvd NE", "manual"), "3820 Rio Grande Blvd NW"),
      false,
    );
  });

  it("ignores an empty candidate", () => {
    assert.equal(addressWorthLearning(contact("1200 Lomas Blvd NE"), "   "), false);
    assert.equal(addressWorthLearning(contact("1200 Lomas Blvd NE"), null), false);
  });

  /**
   * Measured on ten cases and four were wrong, all the same way: the same
   * address wearing different punctuation counted as a correction. That is not
   * free -- it writes the contact, records a change in the audit trail that
   * never happened, and sends the address back to Google to be validated
   * again, so a customer typing in lower case costs an API call.
   */
  it("does not treat the same address in different clothing as a change", () => {
    for (const candidate of [
      "3820 rio grande blvd nw",
      "3820 Rio Grande Blvd NW.",
      "3820  Rio Grande Blvd  NW",
      "3820 Rio Grande Blvd NW,",
      "  3820 Rio Grande Blvd NW  ",
    ]) {
      assert.equal(
        addressWorthLearning(contact("3820 Rio Grande Blvd NW"), candidate),
        false,
        candidate,
      );
    }
  });

  it("still hears the difference that matters", () => {
    // Only case, spacing and trailing punctuation are normalised. Nothing
    // inside the address is touched, so a unit number stays significant.
    assert.equal(
      addressWorthLearning(contact("12 Vista Del Monte Apt 3"), "12 Vista Del Monte Apt 4"),
      true,
    );
    assert.equal(
      addressWorthLearning(contact("12 Vista Del Monte"), "14 Vista Del Monte"),
      true,
    );
  });
});

/**
 * The separator in the middle counts as much as the one on the end.
 *
 * The first version of this stripped trailing punctuation and left internal
 * punctuation alone, so "1500 Indian School Rd NE, Albuquerque, NM" and the
 * same line written without its commas still read as a correction -- the exact
 * fault the function exists to prevent, surviving in the middle of the string.
 * Found by re-testing a fix from earlier the same night rather than trusting
 * that it was finished.
 */
describe("punctuation inside the address is not a correction either", () => {
  const A = "1500 Indian School Rd NE, Albuquerque NM";

  it("ignores how the parts are separated", () => {
    for (const stored of [
      "1500 Indian School Rd NE, Albuquerque, NM",
      "1500 Indian School Rd NE. Albuquerque. NM",
      "1500 Indian School Rd NE; Albuquerque; NM",
      "1500  Indian School Rd NE   Albuquerque NM",
      "1500 indian school rd ne albuquerque nm",
    ]) {
      assert.equal(
        addressWorthLearning(contact(stored), A),
        false,
        stored,
      );
    }
  });

  it("still hears a real change of address", () => {
    // The counterweight: normalising must not swallow a genuine correction.
    for (const candidate of [
      "1502 Indian School Rd NE, Albuquerque NM",
      "1500 Indian School Rd SE, Albuquerque NM",
      "88 Silver Ave SW, Albuquerque NM",
    ]) {
      assert.equal(addressWorthLearning(contact(A), candidate), true, candidate);
    }
  });
});
