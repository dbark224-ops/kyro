import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_INBOUND_EMAIL_SETTINGS,
  findInboundEmailSenderRule,
  normalizeInboundEmailSettings,
  normalizeInboundEmailDecisionRow,
  normalizeInboundEmailSyncAuditRow,
  removeInboundEmailSenderRule,
  senderRuleTargetFromEmail,
  senderRuleTargetFromInput,
  shouldRunInboundEmailSync,
  upsertInboundEmailSenderRule,
} from "./inbound-email-settings";

const automaticSettings = normalizeInboundEmailSettings({
  ...DEFAULT_INBOUND_EMAIL_SETTINGS,
  pollIntervalMinutes: 5,
  quietHoursEnabled: true,
  quietHoursEnd: "04:00",
  quietHoursMode: "paused",
  quietHoursStart: "22:00",
  syncMode: "automatic",
  timeZone: "UTC",
});

describe("inbound email sender rules", () => {
  it("normalizes sender rule targets from email addresses", () => {
    assert.equal(
      senderRuleTargetFromEmail("Person@Example.COM", "email"),
      "person@example.com",
    );
    assert.equal(
      senderRuleTargetFromEmail("Person@Example.COM", "domain"),
      "example.com",
    );
  });

  it("normalizes sender rule targets from settings input", () => {
    assert.equal(
      senderRuleTargetFromInput("https://www.example.com/newsletter", "domain"),
      "example.com",
    );
    assert.equal(
      senderRuleTargetFromInput("Person@Example.COM", "email"),
      "person@example.com",
    );
    assert.equal(senderRuleTargetFromInput("not an email", "email"), null);
  });

  it("upserts rules by sender target and matches email before domain", () => {
    const settings = normalizeInboundEmailSettings({
      ...DEFAULT_INBOUND_EMAIL_SETTINGS,
      senderRules: [
        {
          action: "always_ignore",
          match: "domain",
          value: "example.com",
        },
      ],
    });
    const updated = upsertInboundEmailSenderRule(settings, {
      action: "always_promote",
      createdAt: "2026-05-21T10:00:00.000Z",
      createdFromEventId: "evt_1",
      match: "email",
      value: "person@example.com",
    });

    assert.equal(updated.senderRules.length, 2);
    assert.equal(
      findInboundEmailSenderRule(updated.senderRules, "person@example.com")?.action,
      "always_promote",
    );
    assert.equal(
      findInboundEmailSenderRule(updated.senderRules, "other@example.com")?.action,
      "always_ignore",
    );
  });

  it("removes rules by exact target", () => {
    const settings = normalizeInboundEmailSettings({
      ...DEFAULT_INBOUND_EMAIL_SETTINGS,
      senderRules: [
        {
          action: "always_ignore",
          match: "domain",
          value: "example.com",
        },
        {
          action: "always_promote",
          match: "email",
          value: "person@example.com",
        },
      ],
    });
    const updated = removeInboundEmailSenderRule(settings, {
      match: "domain",
      value: "example.com",
    });

    assert.equal(updated.senderRules.length, 1);
    assert.equal(updated.senderRules[0]?.value, "person@example.com");
  });
});

describe("inbound email operational summaries", () => {
  it("normalizes sync audit rows into compact run history", () => {
    const item = normalizeInboundEmailSyncAuditRow({
      actor_type: "user",
      after: {
        checkedConnections: 1,
        duplicates: 5,
        errors: 0,
        fetchedMessages: 11,
        needsReconnect: 0,
        observedMessages: 6,
        promotedMessages: 0,
        skippedBySchedule: 0,
        trigger: "manual",
      },
      created_at: "2026-05-25T06:10:35.000Z",
      id: "audit-1",
    });

    assert.equal(item.trigger, "manual");
    assert.equal(item.fetchedMessages, 11);
    assert.equal(item.observedMessages, 6);
    assert.equal(item.duplicates, 5);
  });

  it("normalizes inbound decision events from stored event payloads", () => {
    const item = normalizeInboundEmailDecisionRow({
      created_at: "2026-05-25T06:10:34.000Z",
      id: "event-1",
      payload: {
        accountEmail: "inbox@example.com",
        classification: {
          category: "newsletter_or_automated",
          providerUsed: "heuristic",
          reason: "Automated mail.",
        },
        fromEmail: "sender@example.com",
        provider: "google",
        receivedAt: "2026-05-25T06:09:00.000Z",
        stage: "observed",
        subject: "Newsletter",
      },
      processed_at: "2026-05-25T06:10:35.000Z",
      status: "processed",
    });

    assert.equal(item.subject, "Newsletter");
    assert.equal(item.category, "newsletter_or_automated");
    assert.equal(item.providerUsed, "heuristic");
    assert.equal(item.stage, "observed");
  });
});

describe("shouldRunInboundEmailSync", () => {
  it("pauses scheduled polling during quiet hours", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-21T20:00:00.000Z",
        now: new Date("2026-05-21T23:15:00.000Z"),
        settings: automaticSettings,
      }),
      false,
    );
  });

  it("resumes on the first due scheduled poll after quiet hours end", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-21T20:00:00.000Z",
        now: new Date("2026-05-22T04:01:00.000Z"),
        settings: automaticSettings,
      }),
      true,
    );
  });

  it("does not run before the daytime interval is due", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-22T04:00:00.000Z",
        now: new Date("2026-05-22T04:03:00.000Z"),
        settings: automaticSettings,
      }),
      false,
    );
  });

  it("can keep the same polling interval overnight for emergency businesses", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: "2026-05-21T23:00:00.000Z",
        now: new Date("2026-05-21T23:10:00.000Z"),
        settings: {
          ...automaticSettings,
          quietHoursMode: "same_interval",
        },
      }),
      true,
    );
  });

  it("never runs scheduled polling when sync mode is not automatic", () => {
    assert.equal(
      shouldRunInboundEmailSync({
        lastSyncAt: null,
        now: new Date("2026-05-22T10:00:00.000Z"),
        settings: {
          ...automaticSettings,
          syncMode: "manual_only",
        },
      }),
      false,
    );
  });
});
