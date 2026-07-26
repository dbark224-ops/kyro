import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

function readAll() {
  const page = read("page.tsx");
  const sections = readdirSync(join(SETTINGS, "sections"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => read(join("sections", name)));

  return [page, ...sections];
}

describe("settings page sections", () => {
  it("still renders every section somewhere in the tree", () => {
    // A section may be rendered by the page or by another section -- the
    // pronunciation card, for instance, belongs to the voice section. What
    // matters is that nothing has fallen out of the tree entirely.
    const sources = readAll();

    for (const section of SECTIONS) {
      assert.ok(
        sources.some((source) => source.includes(`<${section}`)),
        `<${section}> is no longer rendered anywhere`,
      );
    }
  });

  it("has a definition or an import wherever it is rendered", () => {
    const sources = readAll();

    for (const section of SECTIONS) {
      const renderers = sources.filter((s) => s.includes(`<${section}`));

      for (const source of renderers) {
        const defined = new RegExp(`^(export )?function ${section}\\b`, "m").test(source);
        const imported = new RegExp(`\\b${section}\\b[^;]*?from "`, "s").test(source);

        assert.ok(
          defined || imported,
          `${section} is rendered somewhere that neither defines nor imports it`,
        );
      }
    }
  });

  it("keeps shared helpers in one place rather than re-copied per section", () => {
    const shared = read("shared.tsx");
    const consumers = readAll();

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
      for (const source of consumers) {
        assert.doesNotMatch(
          source,
          new RegExp(`^function ${helper}\\b`, "m"),
          `${helper} should not be redefined outside shared.tsx`,
        );
      }
    }
  });
});
