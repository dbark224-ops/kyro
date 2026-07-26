import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile, repoSourceFiles } from "../testing/repo-files";

/**
 * Dates must render in the workspace's timezone, everywhere.
 *
 * Nineteen files each grew their own date formatter, and twelve of them never
 * took a timezone, so they rendered in the server's -- UTC on Vercel. That is
 * not a bug you notice in review; it looks completely normal until someone
 * checks a timestamp against reality.
 *
 * A unit test cannot catch the twentieth copy. This scan can.
 */
/**
 * Not every `format*Time` function formats an instant. These four don't, and
 * each is listed with the reason it is exempt rather than silently skipped.
 */
const NOT_TIMESTAMP_FORMATTERS = new Map([
  ["formatRecordingTime", "an elapsed duration in ms, not a point in time"],
  ["formatDateParam", "converts a plain calendar day to a YYYY-MM-DD key"],
  ["formatTimeOfDay", 'parses a wall-clock "09:00" string, which has no date'],
]);

/**
 * apps/web/src/app/voice/voice-console.tsx is imported by nothing -- it is a
 * dead third copy of the voice console, superseded by realtime-voice-console
 * and vapi-voice-console. Exempt until it is deleted, not fixed in place.
 */
const DEAD_FILES = new Set(["apps/web/src/app/voice/voice-console.tsx"]);

function sourceFiles() {
  return repoSourceFiles("apps/web/src/**/*.ts", "apps/web/src/**/*.tsx");
}

describe("dates render in the workspace timezone", () => {
  it("has no date formatter that cannot be given a timezone", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      if (DEAD_FILES.has(file)) continue;

      // The shared formatters take their timezone inside an options object.
      if (file.endsWith("lib/time/format.ts")) continue;

      const source = readRepoFile(file);

      for (const match of source.matchAll(
        /(?:export )?function (format[A-Za-z]*(?:Date|Time)[A-Za-z]*)\(([^)]*)\)/g,
      )) {
        const [, name, params] = match;

        if (NOT_TIMESTAMP_FORMATTERS.has(name)) continue;
        if (/timeZone/.test(params)) continue;

        offenders.push(`${file} -> ${name}(${params.trim()})`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `these format a date without accepting a timezone, so they will render in the server's:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("builds no date formatter that ignores the timezone", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      // lib/time and lib/timezone are where this is allowed to live.
      if (file.includes("lib/time/") || file.includes("lib/timezone")) continue;
      if (DEAD_FILES.has(file)) continue;

      const source = readRepoFile(file);

      for (const match of source.matchAll(/new Intl\.DateTimeFormat\(/g)) {
        const start = match.index ?? 0;

        // A timezone can be set on the options object well before this line
        // (`options.timeZone = zone`), so judge the whole enclosing function,
        // not a fixed window after the call.
        const functionStart = source.lastIndexOf("\nfunction ", start);
        const body = source.slice(
          functionStart === -1 ? Math.max(0, start - 800) : functionStart,
          start + 400,
        );

        if (/timeZone/.test(body)) continue;

        // Formatting a synthetic date built from wall-clock parts -- these
        // render "09:00" as a label and have no instant to place in a zone.
        if (/new Date\(\d{4}, \d/.test(body)) continue;

        offenders.push(`${file}:${source.slice(0, start).split("\n").length}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `these build a date formatter without a timezone:\n  ${offenders.join("\n  ")}`,
    );
  });
});
