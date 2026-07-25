import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDialablePhoneNumber,
  normalizeCompanyName,
  normalizeContactEmail,
  normalizeContactPhone,
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
    assert.equal(normalizeContactPhone("0474 783 952"), "+61474783952");
    assert.equal(normalizeContactPhone("+61 474 783 952"), "+61474783952");
    assert.equal(normalizeContactPhone("474-783-952"), "+61474783952");
  });

  it("normalizes common US and UK phone variants", () => {
    assert.equal(normalizeContactPhone("+1 (303) 555-0199"), "+13035550199");
    assert.equal(normalizeContactPhone("(303) 555-0199"), "+13035550199");
    assert.equal(normalizeContactPhone("020 7183 8750"), "+442071838750");
    assert.equal(normalizeContactPhone("+44 20 7183 8750"), "+442071838750");
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

  it("normalizes explicit international prefixes for other countries", () => {
    assert.equal(normalizeContactPhone("00 86 10 6552 9988"), "+861065529988");
    assert.equal(normalizeContactPhone("011 81 3 1234 5678"), "+81312345678");
    assert.equal(normalizeContactPhone("0011 49 30 901820"), "+4930901820");
    assert.equal(normalizeContactPhone("138 0013 8000"), "+8613800138000");
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
    // number. normalizeContactPhoneForRegion happily returns it, Twilio
    // rejected it on every retry until the job dead-lettered.
    assert.equal(normalizeContactPhoneForRegion("+1575855239"), "+1575855239");
    assert.equal(isDialablePhoneNumber("+1575855239"), false);
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

  it("documents the limit: an invalid local number can resolve to another country", () => {
    // normalizeContactPhoneForRegion treats the workspace region as a strong
    // hint, not a constraint -- if a number is invalid there it keeps searching
    // other countries. 07700 900123 is Ofcom's reserved fiction range, invalid
    // in GB, and the search lands on a valid Indian number instead.
    //
    // That fallback is what lets a workspace hold foreign customers, so it is
    // deliberate, but it means this guard catches numbers no country can dial
    // rather than numbers wrong for this one. Recorded here so a future change
    // to the search order shows up as a failure instead of a surprise.
    assert.equal(
      normalizeContactPhoneForRegion("07700900123", "GB"),
      "+917700900123",
    );
    assert.equal(isDialablePhoneNumber("07700900123", "GB"), true);
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
