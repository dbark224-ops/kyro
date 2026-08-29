import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  URGENT_ESCALATION_TRIGGER_DEFINITIONS,
  normalizeWorkspaceGeneralSettings,
} from "./general-settings";

describe("workspace general settings", () => {
  it("normalizes display currency and timezone", () => {
    const settings = normalizeWorkspaceGeneralSettings({
      displayCurrency: "aud",
      timeZone: "Australia/Brisbane",
    });

    assert.equal(settings.displayCurrency, "AUD");
    assert.equal(settings.timeZone, "Australia/Brisbane");
    assert.equal(settings.exchangeRateProvider, "placeholder_static");
    assert.equal(typeof settings.usageMarkupRate, "number");
  });

  it("normalizes account-level usage markup", () => {
    const settings = normalizeWorkspaceGeneralSettings(
      {
        usageMarkupRate: "0.12",
      },
      {
        usageMarkupRate: 0.35,
      },
    );

    assert.equal(settings.usageMarkupRate, 0.12);
    assert.equal(
      normalizeWorkspaceGeneralSettings(
        { usageMarkupRate: "not-real" },
        { usageMarkupRate: 0.35 },
      ).usageMarkupRate,
      0.35,
    );
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

  it("keeps urgent escalation defaults ready for new workspaces", () => {
    const settings = normalizeWorkspaceGeneralSettings({});
    const defaultTriggerKeys = URGENT_ESCALATION_TRIGGER_DEFINITIONS.filter(
      (trigger) => trigger.defaultEnabled,
    ).map((trigger) => trigger.key);

    assert.equal(settings.businessProfile.urgentEscalation.enabled, true);
    assert.deepEqual(
      settings.businessProfile.urgentEscalation.triggerKeys,
      defaultTriggerKeys,
    );
    assert.deepEqual(
      settings.businessProfile.urgentEscalation.steps.map((step) => [
        step.channel,
        step.contactId,
        step.delayMinutes,
      ]),
      [
        ["email", "primary", 0],
        ["app_notification", "primary", 0],
        ["sms", "primary", 15],
        ["phone", "fallback", 60],
      ],
    );
  });

  it("allows a workspace to intentionally clear urgent triggers", () => {
    const settings = normalizeWorkspaceGeneralSettings({
      businessProfile: {
        urgentEscalation: {
          triggerKeys: [],
        },
      },
    });

    assert.deepEqual(settings.businessProfile.urgentEscalation.triggerKeys, []);
  });

  it("normalizes workplace contacts and escalation steps", () => {
    const settings = normalizeWorkspaceGeneralSettings({
      businessProfile: {
        urgentEscalation: {
          steps: [
            {
              channel: "phone",
              contactId: "owner",
              delayMinutes: "7",
              id: "owner-call",
            },
            {
              channel: "not-real",
              contactId: "fallback",
              delayMinutes: "999",
              id: "bad-channel",
            },
          ],
          triggerKeys: ["explicit_urgency", "not-real"],
        },
        workplaceContacts: [
          {
            email: " owner@example.com ",
            id: "owner",
            name: " Daryl ",
            preferredChannel: "phone",
            primaryEscalationContact: "true",
            receivesEscalations: "true",
            role: " Owner ",
          },
          {
            id: "empty",
          },
        ],
      },
    });

    assert.equal(settings.businessProfile.workplaceContacts.length, 1);
    assert.equal(settings.businessProfile.workplaceContacts[0]?.name, "Daryl");
    assert.equal(
      settings.businessProfile.workplaceContacts[0]?.preferredChannel,
      "phone",
    );
    assert.equal(
      settings.businessProfile.workplaceContacts[0]?.primaryEscalationContact,
      true,
    );
    assert.deepEqual(settings.businessProfile.urgentEscalation.triggerKeys, [
      "explicit_urgency",
    ]);
    assert.equal(settings.businessProfile.urgentEscalation.steps[0]?.delayMinutes, 7);
    assert.equal(settings.businessProfile.urgentEscalation.steps[1]?.channel, "sms");
    assert.equal(settings.businessProfile.urgentEscalation.steps[1]?.delayMinutes, 240);
  });
});

/**
 * The country they chose at signup is the country they get.
 *
 * It was asked for and could not be skipped -- the select is required, starts
 * empty, and all three entry points reject anything off the list -- and then
 * nothing used it. defaultPhoneRegion is a separate field only the settings
 * page writes, so it stayed at its "AU" default, and the currency falls back
 * to the region.
 *
 * A plumber in Auckland who chose New Zealand was therefore quoted in
 * Australian dollars, and a number typed as "021 123 4567" was stored as
 * Australian -- so it no longer matched that same person's real +64 when they
 * texted, which costs a duplicate contact and the existing-customer signal.
 */
describe("the country chosen at signup decides the region", () => {
  const withCountry = (operatingCountry: string, rest = {}) =>
    normalizeWorkspaceGeneralSettings({
      businessProfile: { operatingCountry },
      ...rest,
    });

  it("reads the region from the signup country", () => {
    assert.equal(withCountry("New Zealand").defaultPhoneRegion, "NZ");
    assert.equal(withCountry("United Kingdom").defaultPhoneRegion, "GB");
    assert.equal(withCountry("Canada").defaultPhoneRegion, "CA");
    assert.equal(withCountry("USA").defaultPhoneRegion, "US");
  });

  it("carries that through to the money", () => {
    // The fault this started as: A$ on a workspace that never chose Australia.
    assert.equal(withCountry("New Zealand").displayCurrency, "NZD");
    assert.equal(withCountry("USA").displayCurrency, "USD");
    assert.equal(withCountry("United Kingdom").displayCurrency, "GBP");
  });

  it("lets an explicit setting win over the inferred one", () => {
    // Somebody who deliberately changed it has a reason, and a business that
    // operates in one country and bills in another is theirs to configure.
    const settings = withCountry("New Zealand", { defaultPhoneRegion: "AU" });

    assert.equal(settings.defaultPhoneRegion, "AU");
  });

  it("changes nothing for a workspace that already stores a region", () => {
    // Both live workspaces do. This must not move them.
    for (const [country, region] of [
      ["Australia", "AU"],
      ["USA", "US"],
    ] as const) {
      assert.equal(
        withCountry(country, { defaultPhoneRegion: region })
          .defaultPhoneRegion,
        region,
      );
    }
  });

  it("still falls back to the default when no country was given", () => {
    // Nothing on the signup path can reach this, but normalize runs over old
    // rows too, and a guess is worse than the documented default.
    assert.equal(withCountry("").defaultPhoneRegion, "AU");
    assert.equal(
      normalizeWorkspaceGeneralSettings({}).defaultPhoneRegion,
      "AU",
    );
    assert.equal(
      withCountry("Republic of Somewhere").defaultPhoneRegion,
      "AU",
    );
  });
});
