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
