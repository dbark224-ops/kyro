import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Repo-root-relative file access for source-scanning guard tests.
 *
 * These guards work by reading the codebase and asserting an absence -- no
 * hand-rolled date formatter, no unchecked write. That makes them silent when
 * they are wrong: a scan that finds no files passes just as cleanly as a scan
 * that finds no problems.
 *
 * Which is exactly what happened. The first two guards called `git ls-files
 * "apps/web/src/**"` with no cwd, so they matched 355 files when run from the
 * repo root and zero under `npm test`, which runs from apps/web. They had been
 * passing vacuously.
 *
 * Resolving against `git rev-parse --show-toplevel` makes them independent of
 * where they are invoked from, and repoFiles throws on an empty result so the
 * failure mode is a red test rather than a green one.
 */
let cachedRoot: string | null = null;

export function repoRoot() {
  cachedRoot ??= execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();

  return cachedRoot;
}

export function readRepoFile(relativePath: string) {
  return readFileSync(join(repoRoot(), relativePath), "utf8");
}

export function repoFiles(...patterns: string[]) {
  const files = execSync(
    `git ls-files ${patterns.map((pattern) => `"${pattern}"`).join(" ")}`,
    { cwd: repoRoot(), encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  if (files.length === 0) {
    throw new Error(
      `No files matched ${patterns.join(", ")} -- a guard that scans nothing passes for the wrong reason.`,
    );
  }

  return files;
}

/** Source files only: excludes tests, which are allowed to break the rules. */
export function repoSourceFiles(...patterns: string[]) {
  return repoFiles(...patterns).filter(
    (file) => !file.includes(".test.") && !file.includes(".spec."),
  );
}
