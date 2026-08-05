import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayCurrencyForRegion } from "./display-currency";
import { normalizeWorkspaceGeneralSettings } from "../workspace/general-settings";

/**
 * A business should never be quoted in somebody else's money.
 *
 * "AUD" was hardcoded in five places while the workspace setting said USD.
 * The visible symptom was a New Mexico dashboard reading "A$0"; the one that
 * mattered was the default currency on quote and invoice templates, which is
 * a number printed in front of a customer and the owner's to walk back.
 *
 * Kyro is single-country per workspace -- the same assumption the dialling
 * region is built on -- so the country is enough to know the currency.
 */
describe("currency follows the country", () => {
  it("knows the money for the countries Kyro serves", () => {
    assert.equal(displayCurrencyForRegion("US"), "USD");
    assert.equal(displayCurrencyForRegion("AU"), "AUD");
    assert.equal(displayCurrencyForRegion("NZ"), "NZD");
    assert.equal(displayCurrencyForRegion("GB"), "GBP");
    assert.equal(displayCurrencyForRegion("CA"), "CAD");
    assert.equal(displayCurrencyForRegion("IE"), "EUR");
    assert.equal(displayCurrencyForRegion("DE"), "EUR");
  });

  it("does not care about casing or padding", () => {
    assert.equal(displayCurrencyForRegion(" us "), "USD");
    assert.equal(displayCurrencyForRegion("au"), "AUD");
  });

  it("keeps USD for anywhere it has not been taught", () => {
    // Showing a guess would be worse than showing the previous default.
    for (const region of ["JP", "ZZ", "", "   ", null, undefined]) {
      assert.equal(displayCurrencyForRegion(region), "USD", String(region));
    }
  });
});

describe("and a workspace inherits it without being asked", () => {
  it("gives an Australian workspace Australian dollars", () => {
    const settings = normalizeWorkspaceGeneralSettings({
      defaultPhoneRegion: "AU",
    });

    assert.equal(settings.displayCurrency, "AUD");
  });

  it("gives a US workspace US dollars", () => {
    const settings = normalizeWorkspaceGeneralSettings({
      defaultPhoneRegion: "US",
    });

    assert.equal(settings.displayCurrency, "USD");
  });

  it("never overrides a currency somebody chose", () => {
    // Both live workspaces have a stored currency, so neither moves. An owner
    // who deliberately bills in USD from Australia keeps doing so.
    const settings = normalizeWorkspaceGeneralSettings({
      defaultPhoneRegion: "AU",
      displayCurrency: "USD",
    });

    assert.equal(settings.displayCurrency, "USD");
  });

  it("still honours an explicit fallback over the country", () => {
    const settings = normalizeWorkspaceGeneralSettings(
      { defaultPhoneRegion: "AU" },
      { displayCurrency: "GBP" },
    );

    assert.equal(settings.displayCurrency, "GBP");
  });
});
