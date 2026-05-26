import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeSettingsUpdatePrompt,
  parseAssistantEditableSettingChanges,
} from "./settings-tools";

describe("assistant editable settings parsing", () => {
  it("parses timezone and manual-only email sync requests", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Change the timezone to Australia/Brisbane and set email sync to manual only.",
    );

    assert.deepEqual(parsed.settings, {
      syncMode: "manual_only",
      timeZone: "Australia/Brisbane",
    });
    assert.equal(parsed.generalSettings.timeZone, "Australia/Brisbane");
    assert.ok(parsed.labels.includes("workspace timezone to Australia/Brisbane"));
    assert.ok(parsed.labels.includes("inbound email sync to manual only"));
  });

  it("parses workspace display currency separately from quote currency", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Set the display currency to AUD.",
    );

    assert.equal(parsed.generalSettings.displayCurrency, "AUD");
    assert.equal(parsed.documentSettings.currency, undefined);
    assert.ok(parsed.labels.includes("display currency to AUD"));
    assert.ok(parsed.targetSections.includes("general"));
  });

  it("parses quiet-hours windows", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Enable quiet hours from 10pm to 4am and pause polling overnight.",
    );

    assert.equal(parsed.settings.quietHoursEnabled, true);
    assert.equal(parsed.settings.quietHoursMode, undefined);
    assert.equal(parsed.settings.quietHoursStart, "22:00");
    assert.equal(parsed.settings.quietHoursEnd, "04:00");
  });

  it("parses poll interval, lookback, fetch cap, and skipped summaries", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Set polling every 15 minutes, missed-mail lookback to 3 days, fetch cap 20, and turn skipped-mail summaries off.",
    );

    assert.equal(parsed.settings.pollIntervalMinutes, 15);
    assert.equal(parsed.settings.lookbackDays, 3);
    assert.equal(parsed.settings.maxMessagesPerSync, 20);
    assert.equal(parsed.settings.includeAwarenessEvents, false);
  });

  it("parses inbound action rules for email classification", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Set email action rules to promote quote requests and urgent job updates, but ignore newsletters.",
    );

    assert.equal(
      parsed.settings.actionInstructions,
      "promote quote requests and urgent job updates, but ignore newsletters",
    );
    assert.ok(parsed.targetSections.includes("integrations"));
  });

  it("parses explicit sender relevance rules", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Treat emails from client@example.com as relevant from now on.",
    );

    assert.deepEqual(parsed.senderRule, {
      action: "always_promote",
      match: "email",
      value: "client@example.com",
    });
    assert.ok(parsed.targetSections.includes("integrations"));
  });

  it("parses explicit sender domain relevance rules", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Always ignore emails from example.com.",
    );

    assert.deepEqual(parsed.senderRule, {
      action: "always_ignore",
      match: "domain",
      value: "example.com",
    });
    assert.ok(parsed.targetSections.includes("integrations"));
  });

  it("parses sender rule removal requests", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Remove the sender rule for client@example.com.",
    );

    assert.equal(parsed.senderRule, null);
    assert.deepEqual(parsed.senderRuleRemoval, {
      match: "email",
      value: "client@example.com",
    });
    assert.ok(parsed.targetSections.includes("integrations"));
    assert.equal(
      looksLikeSettingsUpdatePrompt("Remove the sender rule for client@example.com"),
      true,
    );
  });

  it("parses sender domain rule removal requests", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Stop ignoring sender domain example.com.",
    );

    assert.equal(parsed.senderRule, null);
    assert.deepEqual(parsed.senderRuleRemoval, {
      match: "domain",
      value: "example.com",
    });
    assert.ok(parsed.targetSections.includes("integrations"));
  });

  it("parses safe voice settings", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Switch the assistant voice to coral and set outbound pronunciation policy to strict.",
    );

    assert.equal(parsed.voiceSettings.openAiVoice, "coral");
    assert.equal(parsed.voiceSettings.outboundVoicePronunciationPolicy, "strict");
    assert.ok(parsed.labels.includes("assistant voice to coral"));
    assert.ok(parsed.targetSections.includes("voice"));
  });

  it("parses safe document template settings", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Set quote template direction to premium, minimal, and easy to scan. Set quote currency to AUD and quote validity to 21 days.",
    );

    assert.equal(
      parsed.documentSettings.quoteStyleDirection,
      "premium, minimal, and easy to scan",
    );
    assert.equal(parsed.documentSettings.currency, "AUD");
    assert.equal(parsed.generalSettings.displayCurrency, undefined);
    assert.equal(parsed.documentSettings.validityDays, 21);
    assert.ok(parsed.labels.includes("quote template direction"));
    assert.ok(parsed.targetSections.includes("documents"));
  });

  it("parses document payment terms and footer settings", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Update quote payment terms to 50% deposit before booking. Turn prepared by footer off.",
    );

    assert.equal(
      parsed.documentSettings.paymentTerms,
      "50% deposit before booking",
    );
    assert.equal(parsed.documentSettings.showPreparedBy, false);
    assert.ok(parsed.labels.includes("quote payment terms"));
  });

  it("recognises safe settings requests but ignores unrelated provider-control prompts", () => {
    assert.equal(
      looksLikeSettingsUpdatePrompt("Set email polling every 30 minutes"),
      true,
    );
    assert.equal(
      looksLikeSettingsUpdatePrompt("Switch the assistant voice to ballad"),
      true,
    );
    assert.equal(
      looksLikeSettingsUpdatePrompt("Set quote template direction to bold and concise"),
      true,
    );
    assert.equal(
      looksLikeSettingsUpdatePrompt("Set display currency to AUD"),
      true,
    );
    assert.equal(looksLikeSettingsUpdatePrompt("Disconnect Gmail now"), false);
  });
});
