/**
 * Whether a newly extracted address should replace the one on a contact.
 *
 * Pure and dependency-free so both writers can share it. There are two: an SMS
 * or manual inquiry updates the contact from inbound/manual.ts, and an email
 * inquiry updates it from ai/triage.ts. Both carried their own copy of this
 * rule, which is exactly how the fix for a corrected address went into one of
 * them and changed nothing -- the scenario that found the bug goes through the
 * other.
 *
 * The bug: both only ever filled a blank. A customer wrote "Sorry -- I gave
 * you the wrong address. That's our old place. We're at 3820 Rio Grande Blvd
 * NW now. Please don't send anyone to the Lomas address." The correction
 * reached the reply and inquiry_facts, and the contact card still read Lomas,
 * the one address he had just ruled out.
 *
 * I assumed for a while that never replacing protected a curated home address
 * from being overwritten by a job site, and gave that as the reason to leave
 * it alone. The data said otherwise: for the two-address inquiry the contact's
 * address IS the rental job site, not the postal address. The stored value is
 * simply whichever address arrived first, so there was nothing to protect.
 *
 * So an address Kyro derived may be replaced by a newer one it derived, and an
 * address a human typed is never touched. "manual" is what that looks like in
 * address_validation_status, and it is the only curated case there is.
 *
 * The cost is that a contact's address follows their most recent job rather
 * than their first, which is a mild inaccuracy. The cost of the old behaviour
 * was a van sent to a door the customer had explicitly ruled out.
 */
export function addressWorthLearning(
  contact: {
    address: string | null;
    addressValidationStatus: string | null;
  },
  candidateAddress: string | null,
) {
  if (!candidateAddress?.trim()) {
    return false;
  }

  if (!contact.address) {
    return true;
  }

  // A human typed this one. Nothing automated gets to replace it.
  if (contact.addressValidationStatus === "manual") {
    return false;
  }

  return sameAddressText(candidateAddress) !== sameAddressText(contact.address);
}

/**
 * The same address wearing different punctuation is not a new address.
 *
 * Compared with a plain trim, "3820 rio grande blvd nw", "3820 Rio Grande Blvd
 * NW." and a stray double space each counted as a correction. Replacing an
 * address is not free: it writes the contact, records a change in the audit
 * trail that never happened, and sends the address back to Google to be
 * validated again. Four of ten cases measured did this.
 *
 * Only case, spacing and trailing punctuation are normalised. Nothing inside
 * the address is touched, so "Apt 3" and "Apt 4" stay different, which is the
 * distinction that matters.
 */
function sameAddressText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;\s]+$/, "");
}
