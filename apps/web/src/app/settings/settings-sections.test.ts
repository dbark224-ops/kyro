import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SETTINGS = dirname(fileURLToPath(import.meta.url));

function read(name: string) {
  return readFileSync(join(SETTINGS, name), "utf8");
}

/**
 * The Settings screen has no behaviour tests, so breaking it up is verified by
 * typecheck, lint and build plus this: every section the page is supposed to
 * render is still reachable from it.
 *
 * It cannot prove a section still works. It can prove one has not silently
 * fallen out of the page during a move, which is the failure this refactor
 * could actually cause.
 */
const SECTIONS = [
  "CalendarSettingsDetail",
  "CommunicationSettingsDetail",
  "DeveloperMockInquirySettingsDetail",
  "DeveloperSettingsDetail",
  "EmailSyncHealthPanel",
  "EmptySettingsDetail",
  "GeneralSettingsDetail",
  "InboundEmailOperationsPanel",
  "KyroBillingSettingsDetail",
  "NotificationSettingsDetail",
  "PronunciationEntryCard",
  "UsageSettingsDetail",
  "VoiceSettingsDetail",
];

describe("settings page sections", () => {
  const page = read("page.tsx");

  it("still renders every section", () => {
    for (const section of SECTIONS) {
      assert.ok(
        page.includes(`<${section}`),
        `page.tsx should still render <${section}>`,
      );
    }
  });

  it("has a definition or an import for every section it renders", () => {
    for (const section of SECTIONS) {
      const defined = new RegExp(`^function ${section}\\b`, "m").test(page);
      const imported = new RegExp(`\\b${section}\\b[^;]*?from "`, "s").test(page);

      assert.ok(
        defined || imported,
        `${section} is rendered but neither defined nor imported`,
      );
    }
  });

  it("keeps shared helpers in one place rather than re-copied per section", () => {
    const shared = read("shared.tsx");

    for (const helper of [
      "SettingCardHeading",
      "formatLabel",
      "formatDate",
      "googlePermissionActive",
    ]) {
      assert.match(
        shared,
        new RegExp(`export (function|const|type) ${helper}\\b`),
        `${helper} should live in shared.tsx`,
      );
      assert.doesNotMatch(
        page,
        new RegExp(`^function ${helper}\\b`, "m"),
        `${helper} should not be redefined in page.tsx`,
      );
    }
  });
});
