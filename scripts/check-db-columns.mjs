#!/usr/bin/env node
// Validates every `.from("table").select("a,b,c")` in the app against the real
// database schema, so a column that does not exist fails the build instead of
// throwing in production.
//
// This exists because of a real incident: lib/ai/triage.ts selected
// `channel_type` from `messages`, which only has `channel_id`. TypeScript could
// not catch it -- Supabase select strings are untyped, and even with generated
// database types the error only surfaces if the result's fields are read, which
// there they were not. Every inbound inquiry silently failed to get a reply for
// three days.
//
//   node scripts/check-db-columns.mjs
//
// Refresh the schema with: node scripts/refresh-schema-snapshot.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = [join(ROOT, "apps", "web", "src")];
const SNAPSHOT = join(ROOT, "scripts", "schema-snapshot.json");

/**
 * Splits a PostgREST select list on top-level commas only, so embedded
 * resources like `contacts(name,email)` stay in one piece.
 */
export function splitTopLevel(select) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const char of select) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Turns a select string into the columns it reads from `table`, plus any
 * embedded resources to check against their own table.
 *
 * Returns { columns, embeds, hasStar }. Anything it cannot confidently
 * interpret is left out rather than guessed at -- a false pass is much cheaper
 * here than a false failure that blocks a deploy.
 */
export function parseSelect(select) {
  const columns = [];
  const embeds = [];
  let hasStar = false;

  for (const part of splitTopLevel(select)) {
    if (part === "*") {
      hasStar = true;
      continue;
    }

    // `alias:target` -- validate the target, not the alias.
    const aliased = /^[a-z0-9_]+:(.*)$/is.exec(part);
    const body = aliased ? aliased[1].trim() : part;

    // Embedded resource: `table(cols)`, `table!inner(cols)`, `table!fk(cols)`.
    const embed = /^([a-z0-9_]+)(?:!\s*[a-z0-9_]+)?\s*\(([\s\S]*)\)$/i.exec(
      body,
    );

    if (embed) {
      embeds.push({ select: embed[2], table: embed[1] });
      continue;
    }

    // Plain column. Ignore anything with syntax we do not model (json paths,
    // casts, aggregates) rather than risk a false positive.
    if (/^[a-z0-9_]+$/i.test(body)) {
      columns.push(body);
    }
  }

  return { columns, embeds, hasStar };
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, acc);
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }

  return acc;
}

const FROM_SELECT =
  /\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)([\s\S]{0,400}?)\.select\(\s*(["'`])([\s\S]*?)\3/g;

export function findViolations(source, tables) {
  const violations = [];
  let match;

  FROM_SELECT.lastIndex = 0;

  while ((match = FROM_SELECT.exec(source))) {
    const [, table, between, , select] = match;

    // If another .from( appears in between, this .select belongs to a different
    // query and pairing them would be wrong.
    if (between.includes(".from(")) {
      continue;
    }

    const line = source.slice(0, match.index).split("\n").length;

    check(table, select, line);
  }

  function check(table, select, line) {
    const known = tables[table];

    // Unknown table: a view, an RPC result, or something outside the public
    // schema. Not our business to flag.
    if (!known) {
      return;
    }

    const { columns, embeds } = parseSelect(select);

    for (const column of columns) {
      if (!known.includes(column)) {
        violations.push({ column, line, table });
      }
    }

    for (const embed of embeds) {
      check(embed.table, embed.select, line);
    }
  }

  return violations;
}

function main() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const tables = snapshot.tables;
  const files = SCAN_DIRS.flatMap((dir) => walk(dir));
  const failures = [];
  let checked = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    if (!source.includes(".from(")) {
      continue;
    }

    checked += 1;

    for (const violation of findViolations(source, tables)) {
      failures.push({ ...violation, file: relative(ROOT, file) });
    }
  }

  if (failures.length === 0) {
    process.stdout.write(
      `check-db-columns: OK (${checked} files, ${Object.keys(tables).length} tables)\n`,
    );
    return;
  }

  process.stderr.write(
    `check-db-columns: ${failures.length} invalid column reference(s)\n\n`,
  );

  for (const failure of failures) {
    const suggestion = (tables[failure.table] ?? [])
      .filter((column) => column.includes(failure.column.split("_")[0]))
      .slice(0, 3);

    process.stderr.write(
      `  ${failure.file}:${failure.line}\n` +
        `    "${failure.column}" does not exist on "${failure.table}"\n` +
        (suggestion.length
          ? `    did you mean: ${suggestion.join(", ")}\n`
          : "") +
        "\n",
    );
  }

  process.stderr.write(
    "If the schema changed, refresh it:\n" +
      "  node scripts/refresh-schema-snapshot.mjs\n",
  );
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
