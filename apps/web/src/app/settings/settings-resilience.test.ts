import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SETTINGS = dirname(fileURLToPath(import.meta.url));
const loader = readFileSync(join(SETTINGS, "settings-page-loader.ts"), "utf8");

/**
 * Every section's data load sits in one Promise.all, which rejects the moment
 * any single one does. Before this, a Twilio outage did not just break the
 * Twilio card -- it blanked the whole Settings page, so you could not reach
 * your business hours either.
 */
describe("one failed load cannot take down Settings", () => {
  it("behaves like Promise.all: one rejection loses everything", async () => {
    // The failure mode being fixed, demonstrated rather than described.
    await assert.rejects(
      Promise.all([
        Promise.resolve("business hours"),
        Promise.reject(new Error("twilio is down")),
      ]),
      /twilio is down/,
    );
  });

  it("keeps the rest when each load carries its own fallback", async () => {
    const optionalLoad = <T,>(load: Promise<T>, fallback: T) =>
      load.catch(() => fallback);

    const [hours, twilio] = await Promise.all([
      optionalLoad(Promise.resolve("business hours"), null),
      optionalLoad(Promise.reject(new Error("twilio is down")), null),
    ]);

    assert.equal(hours, "business hours");
    assert.equal(twilio, null);
  });

  it("wraps every optional load in the real loader", () => {
    // Each guarded load resolves to the same value it produces when its section
    // is not being viewed, so a failure renders as "not loaded" rather than as
    // a crash.
    const guarded = loader.match(/optionalLoad\(/g) ?? [];

    assert.ok(
      guarded.length >= 18,
      `expected every optional load to be guarded, found ${guarded.length}`,
    );
  });

  it("reports a failure rather than swallowing it", () => {
    assert.match(loader, /console\.warn\(\s*"Settings section data failed to load"/);
    assert.match(loader, /workspaceId/);
  });

  it("still fails loudly when the workspace itself cannot be resolved", () => {
    // requireWorkspaceContext is deliberately not wrapped: without a workspace
    // there is no page to degrade into.
    assert.doesNotMatch(loader, /optionalLoad\([^)]*requireWorkspaceContext/);
    assert.match(loader, /await Promise\.all\(\[\s*\n\s*searchParams,\s*\n\s*requireWorkspaceContext\(\),/);
  });
});
