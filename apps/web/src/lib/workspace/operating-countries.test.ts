import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOperatingCountry,
  operatingCountryForPhoneRegion,
  operatingCountryPhoneRegion,
} from "./operating-countries";

describe("operating countries", () => {
  it("accepts only supported launch countries", () => {
    assert.equal(isOperatingCountry("Australia"), true);
    assert.equal(isOperatingCountry("USA"), true);
    assert.equal(isOperatingCountry("United States"), false);
    assert.equal(isOperatingCountry("Germany"), false);
    assert.equal(isOperatingCountry(""), false);
  });

  it("maps operating countries to phone regions", () => {
    assert.equal(operatingCountryPhoneRegion("Australia"), "AU");
    assert.equal(operatingCountryPhoneRegion("New Zealand"), "NZ");
    assert.equal(operatingCountryPhoneRegion("United Kingdom"), "GB");
    assert.equal(operatingCountryPhoneRegion("USA"), "US");
    assert.equal(operatingCountryPhoneRegion("Canada"), "CA");
  });

  it("infers an existing workspace country from phone region", () => {
    assert.equal(operatingCountryForPhoneRegion("AU"), "Australia");
    assert.equal(operatingCountryForPhoneRegion("US"), "USA");
    assert.equal(operatingCountryForPhoneRegion("ZZ"), "");
  });
});
