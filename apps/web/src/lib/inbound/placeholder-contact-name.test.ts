import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nameWorthLearning } from "./manual";

/**
 * Every texter was called "+1505..." forever.
 *
 * Inbound SMS names a new contact after the sender's number, because an SMS
 * carries no display name. That is a placeholder, but the contact patcher only
 * ever filled a blank field -- so the placeholder counted as a real name and
 * beat every later chance to learn a better one.
 *
 * Measured end to end: a customer texted "Hi, it's Thaddeus Brightwater" with
 * his email in the same sentence. The email was extracted and written to the
 * contact; the name was not. He then emailed, that message correctly attached
 * to the same contact rather than forking a second one, and the ingest handed
 * over the name outright -- and the card still read "+15055550137".
 *
 * Deliberately narrow: only a name identical to the contact's own number is
 * treated as absent, so a name the owner typed is never overwritten.
 */
const texter = {
  name: "+15055550137",
  normalizedPhone: "+15055550137",
  phone: "+15055550137",
};

describe("a contact named after its own number", () => {
  it("learns the real name when one arrives", () => {
    assert.equal(
      nameWorthLearning(texter, "Thaddeus Brightwater"),
      "Thaddeus Brightwater",
    );
  });

  it("matches the placeholder against either stored form of the number", () => {
    assert.equal(
      nameWorthLearning(
        { ...texter, name: "+1 505 555 0137", phone: "+1 505 555 0137" },
        "Caspian Vale",
      ),
      "Caspian Vale",
    );
  });

  it("still fills a genuinely empty name", () => {
    assert.equal(
      nameWorthLearning({ ...texter, name: null }, "Emeka Nwachukwu"),
      "Emeka Nwachukwu",
    );
  });
});

describe("what must not be touched", () => {
  it("never overwrites a name that is not the number", () => {
    // The owner may have typed this, or an email may have carried it. Either
    // way it is a real name and a later message does not get to replace it.
    assert.equal(
      nameWorthLearning({ ...texter, name: "Priya Raghunathan" }, "P. Raghu"),
      null,
    );
  });

  it("does not swap one rendering of the number for another", () => {
    assert.equal(nameWorthLearning(texter, "+15055550137"), null);
    assert.equal(
      nameWorthLearning({ ...texter, name: "+15055550137" }, "+1 505 555 0137"),
      null,
    );
  });

  it("ignores an empty or blank candidate", () => {
    assert.equal(nameWorthLearning(texter, ""), null);
    assert.equal(nameWorthLearning(texter, "   "), null);
  });

  it("leaves a contact with no number and no name to the blank rule", () => {
    const walkIn = { name: null, normalizedPhone: null, phone: null };

    assert.equal(nameWorthLearning(walkIn, "Sunniva Bergqvist"), "Sunniva Bergqvist");
    assert.equal(nameWorthLearning({ ...walkIn, name: "Sunniva" }, "S. B."), null);
  });
});

/**
 * Re-measured on candidates these tests did not invent: seven of fourteen.
 *
 * The comment above this function says digits are compared rather than strings,
 * precisely so a number cannot be stored as a name. It compared them exactly,
 * and the stored number carries a country code while what people type usually
 * does not -- so "5055550137" against a stored "+15055550137" is ten digits
 * against eleven, no match, and the contact gets "named" after their own phone
 * number anyway. The existing test compared two formats of the same eleven
 * digits and passed throughout.
 */
describe("what may be written into a contact's name", () => {
  const unnamed = {
    name: "+15055550137",
    normalizedPhone: "+15055550137",
    phone: "+1 505 555 0137",
  };

  it("learns a name that is actually a name", () => {
    for (const candidate of [
      "Sarah Whitlock",
      "sarah",
      "Sarah-Jane O'Connor",
      "Jose Maria Nunez",
      "O'Brien",
    ]) {
      assert.equal(nameWorthLearning(unnamed, candidate), candidate, candidate);
    }
  });

  it("refuses their own number however it is written", () => {
    for (const candidate of [
      "+15055550137",
      "+1 505 555 0137",
      "5055550137",
      "(505) 555-0137",
    ]) {
      assert.equal(nameWorthLearning(unnamed, candidate), null, candidate);
    }
  });

  it("refuses contact details belonging to anybody", () => {
    // A number that is not theirs is still not a name, and neither is an
    // email. Either one in the name field looks deliberate on the contact card.
    for (const candidate of ["+15055550199", "505-555-0199", "sarah@example.com"]) {
      assert.equal(nameWorthLearning(unnamed, candidate), null, candidate);
    }
  });

  it("never renames a contact who already has a real name", () => {
    assert.equal(
      nameWorthLearning(
        { name: "Sarah Whitlock", normalizedPhone: "+15055550137", phone: "+15055550137" },
        "Bob",
      ),
      null,
    );
  });
});
