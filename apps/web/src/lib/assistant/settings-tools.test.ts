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
    assert.ok(parsed.labels.includes("workspace timezone to Australia/Brisbane"));
    assert.ok(parsed.labels.includes("inbound email sync to manual only"));
  });

  it("parses quiet-hours windows and pause behaviour", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Enable quiet hours from 10pm to 4am and pause polling overnight.",
    );

    assert.equal(parsed.settings.quietHoursEnabled, true);
    assert.equal(parsed.settings.quietHoursMode, "paused");
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

  it("parses safe voice settings", () => {
    const parsed = parseAssistantEditableSettingChanges(
      "Switch the assistant voice to coral and set outbound pronunciation policy to strict.",
    );

    assert.equal(parsed.voiceSettings.openAiVoice, "coral");
    assert.equal(parsed.voiceSettings.outboundVoicePronunciationPolicy, "strict");
    assert.ok(parsed.labels.includes("assistant voice to coral"));
    assert.ok(parsed.targetSections.includes("voice"));
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
    assert.equal(looksLikeSettingsUpdatePrompt("Disconnect Gmail now"), false);
  });
});
