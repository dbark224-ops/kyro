import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Guards the assistant turn pipeline.
 *
 * Every assistant turn must end with `finalizeAssistantTurn`, which persists the
 * response, refreshes the thread summary, and compacts older context into
 * snapshots. Before 2026-07-25 those three steps were written out separately at
 * each of the four `runAssistantTurn` call sites and only the web one compacted,
 * so mobile and internal SMS/WhatsApp threads grew unbounded raw history.
 *
 * A unit test cannot catch a *new* turn path that forgets to compact, because
 * the omission is the absence of a call. This scans the source instead -- same
 * technique as scripts/check-db-columns.mjs.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir: string, acc: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, acc);
      continue;
    }

    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }

  return acc;
}

/** Files that invoke a full assistant turn, excluding the engine's own definition. */
function turnCallSites() {
  return walk(SRC)
    .filter((file) => {
      const source = readFileSync(file, "utf8");

      return (
        source.includes("runAssistantTurn(") &&
        !source.includes("export async function runAssistantTurn")
      );
    })
    .map((file) => relative(SRC, file).replace(/\\/g, "/"));
}

describe("assistant turn pipeline", () => {
  it("finds the known turn call sites", () => {
    const sites = turnCallSites();

    // Sanity check on the scanner itself: if this drops to zero the other
    // assertions would pass vacuously.
    assert.ok(
      sites.length >= 4,
      `expected at least 4 turn call sites, found ${sites.length}: ${sites.join(", ")}`,
    );
  });

  it("every turn call site finalizes the turn, so compaction always runs", () => {
    const missing = turnCallSites().filter((site) => {
      const source = readFileSync(join(SRC, site), "utf8");

      return !source.includes("finalizeAssistantTurn(");
    });

    assert.deepEqual(
      missing,
      [],
      `these run an assistant turn without finalizeAssistantTurn, so the thread ` +
        `never compacts: ${missing.join(", ")}`,
    );
  });

  it("no turn call site persists or summarizes outside finalizeAssistantTurn", () => {
    // Calling these directly is how the pipeline drifted apart the first time:
    // each site hand-rolled the tail and three of them omitted compaction.
    const offenders = turnCallSites().filter((site) => {
      const source = readFileSync(join(SRC, site), "utf8");

      return (
        source.includes("appendAssistantTurnMessage(") ||
        source.includes("updateAssistantThreadSummary(")
      );
    });

    assert.deepEqual(
      offenders,
      [],
      `these bypass finalizeAssistantTurn's tail: ${offenders.join(", ")}`,
    );
  });

  it("passes context snapshots into every turn rather than dropping them", () => {
    // getAssistantTurnContext always queries assistant_context_snapshots. Two
    // paths used to pay for that query and then omit the result, which the
    // engine silently accepted via a `= []` default. contextSnapshots is now a
    // required field, but this keeps the intent visible.
    const dropped = turnCallSites().filter((site) => {
      const source = readFileSync(join(SRC, site), "utf8");

      return (
        source.includes("getAssistantTurnContext(") &&
        !source.includes("contextSnapshots")
      );
    });

    assert.deepEqual(
      dropped,
      [],
      `these load context snapshots then discard them: ${dropped.join(", ")}`,
    );
  });
});
