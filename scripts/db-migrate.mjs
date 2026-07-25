#!/usr/bin/env node
// Applies pending SQL migrations in supabase/migrations to a database.
//
//   npm run db:migrate                 # uses DATABASE_URL from .env
//   npm run db:migrate -- --dry-run    # show what would run, change nothing
//
// This replaces the old drizzle-kit migrate. That command read
// supabase/migrations/meta/_journal.json, which only ever listed 15 of the 46
// migration files, so the documented rebuild procedure silently rebuilt about a
// third of the database. Migrations here are hand-written SQL and Supabase's own
// ledger (supabase_migrations.schema_migrations) is the single source of truth.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

/**
 * Merges env files, earlier files winning, but only for keys with a real value.
 *
 * apps/web/.env.local declares DATABASE_URL as an empty string while the value
 * actually lives in .env, so "first file that exists wins" silently resolved to
 * empty. An empty declaration is treated as absent.
 */
function envFromFile() {
  const candidates = [
    join(ROOT, "apps", "web", ".env.local"),
    join(ROOT, ".env"),
  ];
  const merged = {};

  for (const file of candidates) {
    if (!existsSync(file)) {
      continue;
    }

    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);

      if (!match) {
        continue;
      }

      const value = match[2].trim().replace(/^["']|["']$/g, "");

      if (value && !merged[match[1]]) {
        merged[match[1]] = value;
      }
    }
  }

  return merged;
}

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const databaseUrl =
    process.env.DATABASE_URL || envFromFile().DATABASE_URL || "";

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env or export it before running.",
    );
  }

  const files = migrationFiles();

  process.stderr.write(
    `${files.length} migration file(s) in supabase/migrations\n`,
  );

  if (dryRun) {
    // Never print the connection string: it carries the database password.
    process.stderr.write(
      "Dry run - would run: supabase db push --db-url <DATABASE_URL>\n",
    );
    process.stderr.write(`Newest migration: ${files[files.length - 1]}\n`);
    return;
  }

  const isWindows = process.platform === "win32";

  execFileSync(
    isWindows ? "supabase.cmd" : "supabase",
    ["db", "push", "--db-url", databaseUrl, "--yes"],
    { encoding: "utf8", shell: isWindows, stdio: "inherit" },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
