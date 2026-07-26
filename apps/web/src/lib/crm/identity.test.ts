import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDialablePhoneNumber,
  normalizeCompanyName,
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
} from "./identity";

describe("CRM identity normalization", () => {
  it("normalizes email casing and whitespace", () => {
    assert.equal(
      normalizeContactEmail("  DAVE@Example.COM "),
      "dave@example.com",
    );
    assert.equal(normalizeContactEmail("   "), null);
  });

  it("normalizes common Australian phone variants", () => {
    assert.equal(
      normalizeContactPhoneForRegion("0474 783 952", "AU"),
      "+61474783952",
    );
    assert.equal(
      normalizeContactPhoneForRegion("+61 474 783 952", "AU"),
      "+61474783952",
    );
    assert.equal(
      normalizeContactPhoneForRegion("474-783-952", "AU"),
      "+61474783952",
    );
  });

  it("uses the workspace default region for bare local numbers", () => {
    assert.equal(
      normalizeContactPhoneForRegion("0402 158 840", "AU"),
      "+61402158840",
    );
    assert.equal(
      normalizeContactPhoneForRegion("415 555 0123", "US"),
      "+14155550123",
    );
    assert.equal(
      normalizeContactPhoneForRegion("020 7183 8750", "GB"),
      "+442071838750",
    );
  });

  it("normalizes explicit international prefixes regardless of region", () => {
    // An overseas contact reached by dialling out of the workspace's country.
    // The prefix says which country, so no guessing is involved.
    assert.equal(
      normalizeContactPhoneForRegion("00 86 10 6552 9988", "AU"),
      "+861065529988",
    );
    assert.equal(
      normalizeContactPhoneForRegion("011 81 3 1234 5678", "AU"),
      "+81312345678",
    );
    assert.equal(
      normalizeContactPhoneForRegion("0011 49 30 901820", "AU"),
      "+4930901820",
    );
    assert.equal(
      normalizeContactPhoneForRegion("+1 (303) 555-0199", "AU"),
      "+13035550199",
    );
  });

  it("stores a number it cannot read as typed, rather than guessing a country", () => {
    // A bare foreign local number has no marker saying which country it is. The
    // old behaviour searched every country until something validated, which
    // turned these into confident wrong answers. Now the digits are kept as a
    // stable key and the contact is flagged instead.
    assert.equal(
      normalizeContactPhoneForRegion("(303) 555-0199", "AU"),
      "3035550199",
    );
    assert.equal(
      normalizeContactPhoneForRegion("138 0013 8000", "AU"),
      "13800138000",
    );
    assert.equal(
      normalizeContactPhoneForRegion("020 7183 8750", "AU"),
      "02071838750",
    );
  });

  it("treats every spelling of one local number as the same contact", () => {
    // The requirement: with or without the country code, with or without the
    // leading zero, with or without a plus -- all one contact, not four.
    const spellings: Array<[string, string, string[]]> = [
      [
        "AU mobile",
        "AU",
        [
          "+61412345678",
          "+61 412 345 678",
          "61412345678",
          "0412345678",
          "0412 345 678",
          "412345678",
          "0061412345678",
        ],
      ],
      [
        "AU landline",
        "AU",
        ["+61293744000", "61293744000", "0293744000", "02 9374 4000"],
      ],
      [
        "US",
        "US",
        ["+14155550123", "14155550123", "4155550123", "(415) 555-0123"],
      ],
      [
        "GB mobile",
        "GB",
        ["+447911123456", "447911123456", "07911123456", "07911 123456"],
      ],
      [
        "NZ mobile",
        "NZ",
        ["+64211234567", "64211234567", "0211234567", "021 123 4567"],
      ],
      [
        "CA",
        "CA",
        ["+14165550123", "14165550123", "4165550123", "(416) 555-0123"],
      ],
    ];

    for (const [label, region, forms] of spellings) {
      const keys = new Set(
        forms.map((form) => normalizeContactPhoneForRegion(form, region)),
      );

      assert.equal(
        keys.size,
        1,
        `${label} should produce one key, got ${[...keys].join(" | ")}`,
      );
      assert.ok(
        [...keys][0]?.startsWith("+"),
        `${label} should normalize to E.164, got ${[...keys][0]}`,
      );
    }
  });

  it("only drops the plus for the workspace's own country code", () => {
    // `61412345678` is the AU number written without its plus, so it resolves.
    assert.equal(
      normalizeContactPhoneForRegion("61412345678", "AU"),
      "+61412345678",
    );
    // `4155550123` is a US number written without its plus. Accepting a bare
    // foreign code would read it as +41 (Switzerland) -- a confident wrong
    // answer. It is kept as typed and flagged instead.
    assert.equal(
      normalizeContactPhoneForRegion("4155550123", "AU"),
      "4155550123",
    );
  });

  it("normalizes company names for grouping", () => {
    assert.equal(
      normalizeCompanyName("  Brightside   Plumbing  "),
      "brightside plumbing",
    );
  });
});

describe("isDialablePhoneNumber", () => {
  it("rejects the number that dead-lettered a real send on 2026-07-25", () => {
    // +1575855239 is nine digits after the country code, one short of a US
    // number. It is kept as typed so the operator can see what was entered,
    // and reported undialable so Twilio is never asked to send to it.
    assert.equal(
      normalizeContactPhoneForRegion("+1575855239", "AU"),
      "1575855239",
    );
    assert.equal(isDialablePhoneNumber("+1575855239", "AU"), false);
  });

  it("accepts bare local numbers written in the workspace's own region", () => {
    assert.equal(isDialablePhoneNumber("0402 158 840", "AU"), true);
    assert.equal(isDialablePhoneNumber("415 555 0123", "US"), true);
    assert.equal(isDialablePhoneNumber("020 7183 8750", "GB"), true);
  });

  it("accepts each country's own local format under its own workspace region", () => {
    // Kyro is sold per country, so a workspace anywhere must be able to type
    // numbers the way its users actually write them.
    const cases: Array<[string, string]> = [
      ["02 9374 4000", "AU"],
      ["(416) 555-0123", "CA"],
      ["085 123 4567", "IE"],
      ["021 123 4567", "NZ"],
      ["9123 4567", "SG"],
      ["07911 123456", "GB"],
      ["082 123 4567", "ZA"],
    ];

    for (const [number, region] of cases) {
      assert.equal(
        isDialablePhoneNumber(number, region),
        true,
        `${number} should be dialable for a ${region} workspace`,
      );
    }
  });

  it("flags a number invalid in its own country instead of reinterpreting it", () => {
    // 07700 900123 is Ofcom's reserved fiction range: invalid in GB. The old
    // search-every-country fallback turned it into +917700900123, a real and
    // dialable Indian number, and reported it as fine. A GB plumber has no
    // Indian customers -- the number is simply wrong, and now says so.
    assert.equal(
      normalizeContactPhoneForRegion("07700900123", "GB"),
      "07700900123",
    );
    assert.equal(isDialablePhoneNumber("07700900123", "GB"), false);
  });

  it("accepts explicit international numbers regardless of workspace region", () => {
    assert.equal(isDialablePhoneNumber("+61402158840", "US"), true);
    assert.equal(isDialablePhoneNumber("+14155550123", "AU"), true);
  });

  it("rejects blanks, junk and numbers that are merely stored", () => {
    assert.equal(isDialablePhoneNumber(null), false);
    assert.equal(isDialablePhoneNumber(""), false);
    assert.equal(isDialablePhoneNumber("   "), false);
    assert.equal(isDialablePhoneNumber("call the office"), false);
    assert.equal(isDialablePhoneNumber("123", "AU"), false);
    assert.equal(isDialablePhoneNumber("00000000000", "AU"), false);
  });

  it("keeps extensions dialable -- the base number is what gets called", () => {
    assert.equal(isDialablePhoneNumber("0402 158 840 ext. 12", "AU"), true);
  });
});
