import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeWorkspaceGeneralSettings } from "./general-settings";

describe("workspace general settings", () => {
  it("normalizes display currency and timezone", () => {
    const settings = normalizeWorkspaceGeneralSettings({
      displayCurrency: "aud",
      timeZone: "Australia/Brisbane",
    });

    assert.equal(settings.displayCurrency, "AUD");
    assert.equal(settings.timeZone, "Australia/Brisbane");
    assert.equal(settings.exchangeRateProvider, "placeholder_static");
  });

  it("falls back when currency or timezone are invalid", () => {
    const settings = normalizeWorkspaceGeneralSettings(
      {
        displayCurrency: "DOGE",
        timeZone: "Not/AZone",
      },
      {
        displayCurrency: "NZD",
        timeZone: "Pacific/Auckland",
      },
    );

    assert.equal(settings.displayCurrency, "NZD");
    assert.equal(settings.timeZone, "Pacific/Auckland");
  });
});
