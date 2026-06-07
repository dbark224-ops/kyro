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

  it("normalizes business profile values", () => {
    const settings = normalizeWorkspaceGeneralSettings(
      {
        businessProfile: {
          brandAccentColor: "not-a-color",
          brandPrimaryColor: "#123abc",
          businessName: "  WFA Plumbing  ",
          emergencyJobsEnabled: true,
          logoWidthPx: "999",
          publicPhoneNumber: "  +61 7 4517 4330  ",
          staffCount: "4",
          travelRadiusKm: "32.4",
        },
      },
      {
        businessProfile: {
          brandAccentColor: "#ffffff",
        },
      },
    );

    assert.equal(settings.businessProfile.businessName, "WFA Plumbing");
    assert.equal(settings.businessProfile.brandAccentColor, "#ffffff");
    assert.equal(settings.businessProfile.brandPrimaryColor, "#123abc");
    assert.equal(settings.businessProfile.emergencyJobsEnabled, true);
    assert.equal(settings.businessProfile.logoWidthPx, 320);
    assert.equal(settings.businessProfile.publicPhoneNumber, "+61 7 4517 4330");
    assert.equal(settings.businessProfile.staffCount, 4);
    assert.equal(settings.businessProfile.travelRadiusKm, 32);
  });
});
