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
