import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
